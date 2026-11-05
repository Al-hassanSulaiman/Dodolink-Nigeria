import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import appVersionRouter from "./appVersion";
import { LATEST_APP_BUILD } from "../lib/appVersion";

const app = express().use(appVersionRouter);

describe("GET /app-version", () => {
  it("returns the newest build and store link for each platform", async () => {
    const ios = await request(app).get("/app-version?platform=ios");
    expect(ios.status).toBe(200);
    expect(ios.body.latestBuild).toBe(LATEST_APP_BUILD.ios);
    expect(ios.body.storeUrl).toMatch(/apps\.apple\.com/);
    const android = await request(app).get("/app-version?platform=android");
    expect(android.body.storeUrl).toMatch(/com\.dodolink\.ng/);
  });
  it("rejects an unknown platform", async () => {
    expect((await request(app).get("/app-version?platform=web")).status).toBe(400);
    expect((await request(app).get("/app-version")).status).toBe(400);
  });
});
