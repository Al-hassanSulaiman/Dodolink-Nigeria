/**
 * Copy a snapshot to the private Google Cloud target. Dry-run unless --apply.
 * No source writes, secret logging, or overwrite of differing destination data.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pipeline } from "node:stream/promises";
import { Storage, type File, type FileMetadata } from "@google-cloud/storage";
import { objectStorageClient, ObjectStorageService } from "../src/lib/objectStorage";

// Storage and the app can depend on different google-auth-library majors.
// Use Storage's own auth implementation rather than mixing incompatible clients.
const storageRequire = createRequire(import.meta.resolve("@google-cloud/storage"));
const { OAuth2Client } = storageRequire("google-auth-library");

const PROJECT = "project-3a919f28-1462-4a1d-a2c";
const PROJECT_NUMBER = "729481009477";
const DESTINATION = "dodolink-media-729481009477-afs1";
const args = process.argv.slice(2);
if (args.some((arg) => !["--apply", "--dry-run", "--source-path-digests"].includes(arg))) {
  throw new Error("Unsupported migration option.");
}
if (args.includes("--apply") && (args.includes("--dry-run") || args.includes("--source-path-digests"))) {
  throw new Error("Choose either --apply or --dry-run.");
}
const apply = args.includes("--apply");

type Job = {
  file: File;
  metadata: FileMetadata;
  destination: string;
};

function splitStoragePath(raw: string) {
  const normalized = raw.replace(/^\/+|\/+$/g, "");
  const separator = normalized.indexOf("/");
  if (separator < 1) throw new Error("A configured source path is invalid.");
  return {
    bucket: normalized.slice(0, separator),
    prefix: `${normalized.slice(separator + 1)}/`,
  };
}

function contentMetadata(source: FileMetadata) {
  return {
    contentType: source.contentType,
    cacheControl: source.cacheControl,
    contentDisposition: source.contentDisposition,
    contentEncoding: source.contentEncoding,
    contentLanguage: source.contentLanguage,
    metadata: source.metadata ?? {},
  };
}

function canonicalMetadata(metadata: FileMetadata) {
  const values = contentMetadata(metadata);
  return JSON.stringify({
    ...values,
    metadata: Object.fromEntries(
      Object.entries(values.metadata).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function sameBytes(left: FileMetadata, right: FileMetadata) {
  return Boolean(
    left.crc32c &&
      right.crc32c &&
      left.crc32c === right.crc32c &&
      String(left.size) === String(right.size),
  );
}

async function collectJobs(rawPath: string, destinationRoot: string) {
  const { bucket, prefix } = splitStoragePath(rawPath);
  if (bucket === DESTINATION) {
    throw new Error("The source and destination must be different buckets.");
  }
  const [files] = await objectStorageClient.bucket(bucket).getFiles({ prefix });
  const jobs: Job[] = [];
  for (const file of files) {
    if (file.name.endsWith("/")) continue;
    const [metadata] = await file.getMetadata();
    if (!metadata.crc32c || !metadata.generation || metadata.size === undefined) {
      throw new Error("Source integrity metadata is incomplete.");
    }
    jobs.push({
      file: objectStorageClient
        .bucket(bucket)
        .file(file.name, { generation: metadata.generation }),
      metadata,
      destination: `${destinationRoot}/${file.name.slice(prefix.length)}`,
    });
  }
  return jobs;
}

async function main() {
  if (!process.env.REPL_ID) {
    throw new Error("Run this helper in the source Replit workspace.");
  }
  const sourceService = new ObjectStorageService();
  const roots = [
    { path: sourceService.getPrivateObjectDir(), target: "private" },
    ...sourceService.getPublicObjectSearchPaths().map((path, index) => ({
      path,
      target: `public/${index}`,
    })),
  ];
  const jobs: Job[] = [];
  for (const root of roots) {
    const group = await collectJobs(root.path, root.target);
    jobs.push(...group);
    console.log(JSON.stringify({
      phase: "inventory",
      group: root.target,
      objects: group.length,
      bytes: group.reduce((sum, job) => sum + Number(job.metadata.size), 0),
    }));
  }
  if (new Set(jobs.map((job) => job.destination)).size !== jobs.length) {
    throw new Error("Destination object names overlap.");
  }
  if (!apply) {
    if (args.includes("--source-path-digests")) {
      console.log(JSON.stringify({
        sourcePathDigests: jobs
          .filter((job) => job.destination.startsWith("private/"))
          .map((job) => createHash("md5")
            .update(`/objects/${job.destination.slice("private/".length)}`)
            .digest("hex")),
      }));
    }
    console.log(JSON.stringify({ mode: "dry-run", objects: jobs.length, writes: 0 }));
    return;
  }

  // Use CLI-managed OAuth without displaying, persisting, or logging the token.
  const accessToken = execFileSync(
    "gcloud",
    ["auth", "print-access-token", "--project", PROJECT, "--quiet"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: accessToken });
  const destinationStorage = new Storage({ projectId: PROJECT, authClient });
  const bucket = destinationStorage.bucket(DESTINATION);
  const [bucketMetadata] = await bucket.getMetadata();
  if (
    String(bucketMetadata.projectNumber) !== PROJECT_NUMBER ||
    bucketMetadata.location?.toLowerCase() !== "africa-south1" ||
    bucketMetadata.iamConfiguration?.publicAccessPrevention !== "enforced"
  ) {
    throw new Error("Destination project, region, or privacy guardrail does not match.");
  }

  let copied = 0;
  let unchanged = 0;
  let metadataUpdated = 0;
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const destination = bucket.file(job.destination);
      const [exists] = await destination.exists();
      if (exists) {
        const [existing] = await destination.getMetadata();
        if (!sameBytes(job.metadata, existing)) {
          throw new Error("Destination contains different bytes; no overwrite was attempted.");
        }
        if (canonicalMetadata(existing) !== canonicalMetadata(job.metadata)) {
          await destination.setMetadata(contentMetadata(job.metadata), {
            ifMetagenerationMatch: existing.metageneration,
          });
          metadataUpdated++;
        } else {
          unchanged++;
        }
      } else {
        await pipeline(
          job.file.createReadStream(),
          destination.createWriteStream({
            resumable: true,
            validation: "crc32c",
            metadata: contentMetadata(job.metadata),
            preconditionOpts: { ifGenerationMatch: 0 },
          }),
        );
        copied++;
      }
      const [verified] = await destination.getMetadata();
      if (
        !sameBytes(job.metadata, verified) ||
        canonicalMetadata(job.metadata) !== canonicalMetadata(verified)
      ) {
        throw new Error("Destination bytes or content/ACL metadata failed verification.");
      }
    }
  }
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(3, jobs.length) }, worker),
  );
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("Media copy did not fully verify; retain the source and retry safely.");
  }
  console.log(JSON.stringify({
    mode: "apply",
    objects: jobs.length,
    copied,
    unchanged,
    metadataUpdated,
    verified: jobs.length,
    sourceWrites: 0,
  }));
}

main().catch((error: unknown) => {
  // SDK errors can contain source paths or request credentials. Do not log them.
  const code = (error as { code?: unknown })?.code;
  console.error(JSON.stringify({
    status: "failed",
    errorCode: typeof code === "number" ? code : "migration_guardrail_or_request_failure",
    sourceDeleted: false,
  }));
  process.exitCode = 1;
});
