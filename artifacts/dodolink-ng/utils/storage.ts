import { requestUploadUrl as apiRequestUploadUrl } from "@workspace/api-client-react";
import { getApiBase } from "./apiBase";

export function getImageUrl(objectPath: string): string {
  if (objectPath.startsWith("http")) return objectPath;
  return `${getApiBase()}/api/storage${objectPath}`;
}

export async function requestUploadUrl(opts: {
  name: string;
  size: number;
  contentType: string;
}): Promise<{ uploadURL: string; objectPath: string }> {
  // Uses the generated API client so the auth token is attached automatically.
  const res = await apiRequestUploadUrl(opts);
  return { uploadURL: res.uploadURL, objectPath: res.objectPath };
}

export async function uploadImageToStorage(imageUri: string): Promise<string> {
  const fileRes = await fetch(imageUri);
  const blob = await fileRes.blob();
  const size = blob.size;
  const contentType = blob.type || "image/jpeg";
  const name = `product-${Date.now()}.jpg`;

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });

  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadRes.ok) throw new Error("Failed to upload image to storage");
  return objectPath;
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB

export async function uploadMediaToStorage(
  uri: string,
  mimeType: string,
  prefix: "chat-img" | "chat-vid"
): Promise<string> {
  const fileRes = await fetch(uri);
  const blob = await fileRes.blob();
  const size = blob.size;

  if (size > MAX_MEDIA_BYTES) {
    throw new Error("File is too large. Maximum size is 50 MB.");
  }

  const ext = mimeType.startsWith("video/") ? "mp4" : "jpg";
  const name = `${prefix}-${Date.now()}.${ext}`;
  const contentType = mimeType || (prefix === "chat-vid" ? "video/mp4" : "image/jpeg");

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });

  const uploadRes = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadRes.ok) throw new Error("Failed to upload media to storage");
  return objectPath;
}
