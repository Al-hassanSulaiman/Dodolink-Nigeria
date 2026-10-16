import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
  getFile: vi.fn(),
  download: vi.fn(),
  validate: vi.fn(),
}));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = mocks.getFile;
    downloadObject = mocks.download;
  },
  ObjectNotFoundError: class extends Error {},
}));
vi.mock("../lib/mediaLimits", () => ({ validateStoredMedia: mocks.validate }));
import router from "./storage";
import { ObjectNotFoundError } from "../lib/objectStorage";

const app = express();
app.use((req, _res, next) => {
  req.log = { warn: vi.fn(), error: vi.fn() } as unknown as typeof req.log;
  next();
});
app.use(router);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.metadata.mockResolvedValue([{ contentType: "video/mp4", size: "5000" }]);
  mocks.getFile.mockResolvedValue({ getMetadata: mocks.metadata });
  mocks.validate.mockResolvedValue({ ok: true });
});
afterAll(() => pool.end());

describe("attachment type detection via HEAD", () => {
  it("returns real video metadata without downloading or streaming the body", async () => {
    const response = await request(app).head("/storage/objects/uploads/opaque-id");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(response.headers["content-length"]).toBe("5000");
    expect(response.text ?? "").toBe("");
    expect(mocks.validate).toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("returns actual photo types instead of assuming every attachment is JPEG", async () => {
    mocks.metadata.mockResolvedValue([{ contentType: "image/png", size: "100" }]);
    const response = await request(app).head("/storage/objects/uploads/photo");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not bypass media size/type restrictions", async () => {
    mocks.validate.mockResolvedValue({ ok: false, reason: "File too large" });
    expect((await request(app).head("/storage/objects/uploads/oversized")).status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("preserves missing-file handling", async () => {
    mocks.getFile.mockRejectedValue(new ObjectNotFoundError());
    expect((await request(app).head("/storage/objects/uploads/missing")).status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
