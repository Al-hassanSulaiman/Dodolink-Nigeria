import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./securityHeaders";

describe("securityHeaders", () => {
  it("adds protective headers and hides X-Powered-By", async () => {
    const app = express();
    app.use(securityHeaders);
    app.get("/", (_req, res) => { res.send("ok"); });
    const res = await request(app).get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["strict-transport-security"]).toContain("max-age");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
