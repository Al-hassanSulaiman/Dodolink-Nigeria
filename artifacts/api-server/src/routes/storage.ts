import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireUser } from "../lib/auth";
import { db } from "@workspace/db";
import { mediaUploadsTable, accountDeletionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ACCOUNT_DELETION_LOCK_NAMESPACE } from "../lib/accountDeletion";
import { rateLimit } from "../lib/rateLimit";

const uploadUrlLimit = rateLimit({ name: "upload-url", max: 30, windowMs: 60 * 1000 });

import {
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  validateStoredMedia,
} from "../lib/mediaLimits";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", uploadUrlLimit, async (req: Request, res: Response) => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  const isImage = ALLOWED_IMAGE_TYPES.has(contentType);
  const isVideo = ALLOWED_VIDEO_TYPES.has(contentType);
  if (!isImage && !isVideo) {
    res.status(400).json({ error: "Unsupported file type. Only images and videos are allowed." });
    return;
  }
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (size > maxBytes) {
    res.status(400).json({
      error: `File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))}MB for ${isVideo ? "videos" : "images"}.`,
    });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    // Signing can finish after a deletion request began. Register under the
    // same per-account lock as deletion, and never return a late upload link.
    const registered = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACCOUNT_DELETION_LOCK_NAMESPACE}, hashtext(${userId}))`);
      const [job] = await tx.select({ userId: accountDeletionsTable.userId })
        .from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId));
      if (job) return false;
      await tx.insert(mediaUploadsTable).values({ path: objectPath, userId });
      return true;
    });
    if (!registered) {
      res.status(403).json({ error: "Account deletion is in progress. Uploads are disabled." });
      return;
    }

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  // Note: auth is intentionally not enforced here. React Native's Image
  // component cannot send auth headers, so requiring a session would break
  // every product photo and chat image in the app. Object paths are UUIDs
  // (not guessable), which provides sufficient obscurity for v1.
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // Enforce media constraints on the actual stored object. Presigned PUT
    // URLs can't carry size/type conditions, so this is the real gate: a
    // mislabeled or oversized upload can never be retrieved through the app.
    const mediaCheck = await validateStoredMedia(objectFile);
    if (!mediaCheck.ok) {
      res.status(403).json({ error: mediaCheck.reason });
      return;
    }

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    // Detect opaque attachment types without streaming the whole video.
    // Keep the same existence/media checks above for HEAD and GET.
    if (req.method === "HEAD") {
      const [metadata] = await objectFile.getMetadata();
      res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
      if (metadata.size !== undefined) res.setHeader("Content-Length", String(metadata.size));
      res.status(200).end();
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
