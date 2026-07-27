import type { File } from "@google-cloud/storage";

/**
 * Media constraints enforced server-side. The Replit signing sidecar cannot
 * bind size/content-type conditions into presigned PUT URLs, so client-claimed
 * metadata at request-url time is advisory only. Real enforcement happens:
 *  1. When media is attached to a message (validateStoredMedia on real GCS metadata)
 *  2. When objects are served via GET /storage/objects/* (same check)
 * A file that lies about its type/size can be uploaded, but it can never be
 * attached or retrieved through the app, making the bypass useless.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/3gpp",
]);

export function isAllowedMediaType(contentType: string | undefined | null): boolean {
  if (!contentType) return false;
  return ALLOWED_IMAGE_TYPES.has(contentType) || ALLOWED_VIDEO_TYPES.has(contentType);
}

/**
 * Validate an already-uploaded object against real GCS metadata
 * (not client claims). Returns a reason string on failure.
 */
export async function validateStoredMedia(
  file: File,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string | undefined) ?? undefined;
  const size = Number(metadata.size ?? 0);

  if (!isAllowedMediaType(contentType)) {
    return { ok: false, reason: "Unsupported file type. Only images and videos are allowed." };
  }
  const isVideo = ALLOWED_VIDEO_TYPES.has(contentType!);
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    return {
      ok: false,
      reason: `File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))}MB for ${isVideo ? "videos" : "images"}.`,
    };
  }
  return { ok: true };
}
