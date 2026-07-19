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
