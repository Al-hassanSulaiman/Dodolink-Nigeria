import { publishableKeyFromHost } from "@clerk/shared/keys";

export function resolveClerkPublishableKey(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (env.CLERK_AUTH_MODE === "external") {
    if (!env.CLERK_PUBLISHABLE_KEY) throw new Error("External Clerk publishable key is required.");
    // A personal production key belongs to one Clerk instance. Never derive a
    // different instance from a Cloud Run hostname or an untrusted host header.
    return env.CLERK_PUBLISHABLE_KEY;
  }
  return publishableKeyFromHost(host, env.CLERK_PUBLISHABLE_KEY);
}
