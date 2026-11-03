import { PassThrough, type Readable } from "node:stream";

/**
 * Amazon S3 support for the object storage layer.
 *
 * The rest of the API server was written against the small part of the Google
 * Cloud Storage `File`/`Bucket` API listed below. This module offers the same
 * surface on top of S3, so no route, deletion or media-validation code has to
 * change. It is used ONLY when STORAGE_PROVIDER=s3. Without that variable the
 * existing Google Cloud Storage code runs exactly as before.
 *
 *   bucket(name).file(key) -> exists(), getMetadata(), setMetadata(),
 *                             createReadStream(), delete()
 *
 * The AWS SDK is loaded lazily (and by a non-literal module name) so that:
 *  - the Google Cloud Run image does not need the AWS packages installed, and
 *  - TypeScript and the lockfile do not depend on them.
 * The AWS image installs them (see infra/aws/runtime.Dockerfile).
 */

const CLIENT_MODULE: string = "@aws-sdk/client-s3";
const PRESIGNER_MODULE: string = "@aws-sdk/s3-request-presigner";

// S3 metadata keys are HTTP header names, so ":" is not allowed. The ACL key
// the app uses with Google ("custom:aclPolicy") is stored under a plain name.
const GCS_ACL_KEY = "custom:aclPolicy";
const S3_ACL_KEY = "aclpolicy";

export function isS3Provider(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env.STORAGE_PROVIDER;
  if (value === undefined || value === "" || value === "gcs") return false;
  if (value === "s3") return true;
  throw new Error('STORAGE_PROVIDER must be "gcs" or "s3".');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface S3Sdk {
  client: any;
  commands: any;
  presign: (client: any, command: any, options: { expiresIn: number }) => Promise<string>;
}

let sdkPromise: Promise<S3Sdk> | null = null;

export function loadS3Sdk(): Promise<S3Sdk> {
  sdkPromise ??= (async () => {
    const s3 = await import(/* @vite-ignore */ CLIENT_MODULE);
    const presigner = await import(/* @vite-ignore */ PRESIGNER_MODULE);
    // Credentials come from the ECS task role automatically; nothing is stored here.
    const client = new s3.S3Client({ region: process.env.AWS_REGION });
    return { client, commands: s3, presign: presigner.getSignedUrl };
  })();
  return sdkPromise;
}

/** Test hook: replace the SDK with a fake. */
export function setS3SdkForTests(sdk: S3Sdk | null): void {
  sdkPromise = sdk ? Promise.resolve(sdk) : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function toS3Metadata(metadata: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const s3Key = key === GCS_ACL_KEY ? S3_ACL_KEY : key.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    // Values must be header-safe; encode them and decode again when reading.
    out[s3Key] = encodeURIComponent(String(value));
  }
  return out;
}

export function fromS3Metadata(metadata: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    out[key === S3_ACL_KEY ? GCS_ACL_KEY : key] = safeDecode(value);
  }
  return out;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export interface S3FileMetadata {
  name: string;
  bucket: string;
  contentType?: string;
  size: string;
  metadata: Record<string, string>;
}

export class S3ObjectFile {
  constructor(
    private readonly bucketName: string,
    readonly name: string,
  ) {}

  private async send(build: (commands: any) => unknown): Promise<any> {
    const sdk = await loadS3Sdk();
    return sdk.client.send(build(sdk.commands));
  }

  private head(): Promise<any> {
    return this.send(c => new c.HeadObjectCommand({ Bucket: this.bucketName, Key: this.name }));
  }

  async exists(): Promise<[boolean]> {
    try {
      await this.head();
      return [true];
    } catch (error) {
      if (isNotFound(error)) return [false];
      throw error;
    }
  }

  async getMetadata(): Promise<[S3FileMetadata]> {
    const head = await this.head();
    return [{
      name: this.name,
      bucket: this.bucketName,
      contentType: head.ContentType,
      size: String(head.ContentLength ?? 0),
      metadata: fromS3Metadata(head.Metadata),
    }];
  }

  /** Merges custom metadata, like Google's setMetadata. Content is not re-uploaded by the client. */
  async setMetadata(update: { metadata?: Record<string, string> }): Promise<[unknown]> {
    const head = await this.head();
    const merged = { ...(head.Metadata ?? {}), ...toS3Metadata(update.metadata ?? {}) };
    const copySource = `${this.bucketName}/${this.name.split("/").map(encodeURIComponent).join("/")}`;
    await this.send(c => new c.CopyObjectCommand({
      Bucket: this.bucketName,
      Key: this.name,
      CopySource: copySource,
      MetadataDirective: "REPLACE",
      Metadata: merged,
      ContentType: head.ContentType,
      CacheControl: head.CacheControl,
      ContentDisposition: head.ContentDisposition,
      ContentEncoding: head.ContentEncoding,
      ContentLanguage: head.ContentLanguage,
    }));
    return [{}];
  }

  createReadStream(): Readable {
    const out = new PassThrough();
    this.send(c => new c.GetObjectCommand({ Bucket: this.bucketName, Key: this.name }))
      .then(response => {
        const body = response.Body as Readable;
        body.on("error", (error: Error) => out.destroy(error));
        body.pipe(out);
      })
      .catch(error => out.destroy(error));
    return out;
  }

  /** S3 delete is already idempotent, so `ignoreNotFound` needs no special handling. */
  async delete(_options?: { ignoreNotFound?: boolean }): Promise<[unknown]> {
    await this.send(c => new c.DeleteObjectCommand({ Bucket: this.bucketName, Key: this.name }));
    return [{}];
  }
}

/** Looks like `new Storage()` for the two calls the app makes: bucket(name).file(key). */
export function createS3StorageClient() {
  return {
    bucket: (bucketName: string) => ({
      file: (key: string) => new S3ObjectFile(bucketName, key),
    }),
  };
}

export async function presignS3(
  bucketName: string,
  key: string,
  method: "GET" | "PUT" | "DELETE" | "HEAD",
  ttlSec: number,
): Promise<string> {
  const sdk = await loadS3Sdk();
  const input = { Bucket: bucketName, Key: key };
  const command =
    method === "PUT" ? new sdk.commands.PutObjectCommand(input)
    : method === "DELETE" ? new sdk.commands.DeleteObjectCommand(input)
    : method === "HEAD" ? new sdk.commands.HeadObjectCommand(input)
    : new sdk.commands.GetObjectCommand(input);
  return sdk.presign(sdk.client, command, { expiresIn: ttlSec });
}

/**
 * Turns an S3 URL (such as the upload link we just signed) into the same
 * "/bucket/key" form that the Google code derives from storage.googleapis.com
 * URLs. Returns null when the URL is not an S3 URL.
 */
export function s3UrlToObjectPath(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const pathname = safeDecode(url.pathname);
  const virtualHosted = /^(.+?)\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$/.exec(url.hostname);
  if (virtualHosted) return `/${virtualHosted[1]}${pathname}`;
  if (/^s3([.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)) return pathname;
  return null;
}
