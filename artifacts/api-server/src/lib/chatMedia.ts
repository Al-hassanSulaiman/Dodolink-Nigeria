import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { validateStoredMedia } from "./mediaLimits";

const objectStorage = new ObjectStorageService();

/** Same checks the store chat applies to an attached photo or video (real type and size). */
export async function checkChatMedia(mediaUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let objectPath: string | null = null;
  if (mediaUrl.startsWith("/objects/")) {
    objectPath = mediaUrl;
  } else {
    try {
      const pathname = new URL(mediaUrl).pathname;
      const idx = pathname.indexOf("/objects/");
      if (idx !== -1) objectPath = pathname.slice(idx);
    } catch {
      objectPath = null;
    }
  }
  if (!objectPath) return { ok: false, error: "Invalid media URL" };
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const check = await validateStoredMedia(file);
    return check.ok ? { ok: true } : { ok: false, error: check.reason };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return { ok: false, error: "Media file not found. Please upload it again." };
    throw err;
  }
}
