// Generate a credential-free Cloud Build context from the compiled API only.
import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(apiRoot, "../..");
const context = path.join(workspace, "generated-artifacts/gcp-runtime");
const require = createRequire(path.join(apiRoot, "package.json"));
await mkdir(context, { recursive: true, mode: 0o700 });
const dependencies = {};
for (const name of ["@google-cloud/cloud-sql-connector", "@google-cloud/storage", "nodemailer"]) {
  let directory = path.dirname(require.resolve(name));
  while (true) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      if (manifest.name === name) {
        dependencies[name] = manifest.version;
        break;
      }
    } catch {}
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate runtime manifest: ${name}`);
    directory = parent;
  }
}
await writeFile(path.join(context, "package.json"), JSON.stringify({
  name: "dodolink-cloud-runtime", version: "1.0.0", private: true,
  type: "module", dependencies,
}, null, 2) + "\n");
await cp(path.join(apiRoot, "dist"), path.join(context, "dist"), { recursive: true });
await cp(path.join(workspace, "infra/gcp/runtime.Dockerfile"), path.join(context, "Dockerfile"));
// Run npm outside the workspace package, solely to lock the generated image's
// three external dependencies. Never import .env files or workspace secrets.
execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: context, stdio: "inherit",
});
// Replit's package firewall is unreachable from Cloud Build. Keep package
// versions and integrity hashes, but resolve public npm tarballs publicly.
const lockPath = path.join(context, "package-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
for (const entry of Object.values(lock.packages)) {
  if (!entry.resolved) continue;
  const url = new URL(entry.resolved);
  if (url.username || url.password || url.search) {
    throw new Error("Credential-bearing dependency URL is not deployable.");
  }
  if (url.hostname === "package-firewall.replit.internal" && url.pathname.startsWith("/npm/")) {
    entry.resolved = `https://registry.npmjs.org${url.pathname.slice(4)}`;
  } else if (url.hostname !== "registry.npmjs.org") {
    throw new Error("Unexpected dependency registry in deployment lockfile.");
  }
}
await writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n");
const entries = await readdir(context);
const allowed = new Set(["package.json", "package-lock.json", "Dockerfile", "dist"]);
if (entries.some(entry => !allowed.has(entry))) {
  throw new Error("Unexpected build-context entry; refusing upload.");
}
process.stdout.write("Prepared credential-free backend image context.\n");
