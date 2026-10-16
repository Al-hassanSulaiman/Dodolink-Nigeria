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

const FETCH_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 30_000;

/**
 * React Native does not provide AbortSignal.timeout in production Android/iOS
 * builds. Use AbortController directly, with a Promise.race fallback for older
 * runtimes, so uploads still have a bounded wait without crashing first.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  if (typeof AbortController === "undefined") {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fetch(url, init),
        new Promise<Response>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readLocalFile(uri: string): Promise<Blob> {
  const fileRes = await fetchWithTimeout(
    uri,
    {},
    FETCH_TIMEOUT_MS,
    "Reading the selected file took too long. Please choose it again.",
  );
  if (!fileRes.ok) throw new Error("Could not read the selected file. Please choose it again.");
  const blob = await fileRes.blob();
  if (blob.size === 0) throw new Error("The selected file is empty. Please choose another file.");
  return blob;
}

async function uploadBlob(
  uploadURL: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const uploadRes = await fetchWithTimeout(
    uploadURL,
    {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    },
    UPLOAD_TIMEOUT_MS,
    "Uploading the file took too long. Check your connection and try again.",
  );
  if (!uploadRes.ok) throw new Error("Could not upload the file. Check your connection and try again.");
}

export async function uploadImageToStorage(imageUri: string): Promise<string> {
  const blob = await readLocalFile(imageUri);
  const size = blob.size;
  const contentType = blob.type || "image/jpeg";
  const name = `product-${Date.now()}.jpg`;

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });
  await uploadBlob(uploadURL, blob, contentType);
  return objectPath;
}

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function uploadMediaToStorage(
  uri: string,
  mimeType: string,
  prefix: "chat-img" | "chat-vid"
): Promise<string> {
  const blob = await readLocalFile(uri);
  const size = blob.size;

  const maxBytes = mimeType.startsWith('video/') || prefix === 'chat-vid' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    throw new Error(`File is too large. Maximum size is ${maxBytes / (1024 * 1024)} MB.`);
  }

  const ext = mimeType.startsWith("video/") ? "mp4" : "jpg";
  const name = `${prefix}-${Date.now()}.${ext}`;
  const contentType = mimeType || (prefix === "chat-vid" ? "video/mp4" : "image/jpeg");

  const { uploadURL, objectPath } = await requestUploadUrl({ name, size, contentType });
  await uploadBlob(uploadURL, blob, contentType);
  return objectPath;
}
