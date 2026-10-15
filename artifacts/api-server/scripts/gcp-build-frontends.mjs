// Called by the managed validation runner for the memory-intensive Expo export.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const key = process.env.DODOLINK_CLERK_PRODUCTION_PUBLISHABLE_KEY?.trim();
if (!key?.startsWith("pk_live_")) throw new Error("Personal Clerk production publishable key is required.");
const environment = {
  ...process.env,
  NODE_ENV: "production",
  CI: "1",
  EXPO_NO_DOTENV: "1",
  EXPO_PUBLIC_DOMAIN: "dodolink.com.ng",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: key,
  // Personal Clerk uses its configured public hostname directly. Old native
  // binaries' proxy paths remain a separate cutover-compatibility check.
  EXPO_PUBLIC_CLERK_PROXY_URL: "",
  CLERK_PROXY_URL: "",
  VITE_CLERK_PROXY_URL: "",
  VITE_CLERK_AUTH_MODE: "external",
  VITE_CLERK_PUBLISHABLE_KEY: key,
  PORT: "22133",
  BASE_PATH: "/admin/",
  NODE_OPTIONS: "--max-old-space-size=2560",
};
execFileSync("pnpm", ["--filter", "@workspace/admin-dashboard", "run", "build"], {
  cwd: workspace, env: environment, stdio: "inherit",
});
execFileSync("pnpm", ["exec", "expo", "export", "--platform", "web",
  "--output-dir", "../../generated-artifacts/gcp-web/app"], {
  cwd: path.join(workspace, "artifacts/dodolink-ng"), env: environment, stdio: "inherit",
});
