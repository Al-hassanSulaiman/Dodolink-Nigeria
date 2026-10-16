import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { stagingWriteGuard, readProxyHopCount } from "./runtimeSafety";
import { getClerkProxyUrl } from "../middlewares/clerkProxyMiddleware";

describe("canonical Clerk proxy", () => {
  const req = { headers: { host: "staging.example.test" } };
  it("uses the registered primary proxy on staging without changing the upstream", () => {
    expect(getClerkProxyUrl(req, "https://example.test/api/__clerk"))
      .toBe("https://example.test/api/__clerk");
  });
  it("retains host-derived proxy behavior when no canonical URL is configured", () => {
    expect(getClerkProxyUrl(req, "")).toBe("https://staging.example.test/api/__clerk");
  });
  it.each([
    "http://example.test/api/__clerk",
    "https://user:password@example.test/api/__clerk",
    "https://example.test/api/__clerk?key=value",
    "https://example.test/api/__clerk#fragment",
    "https://example.test/api/stores",
  ])("rejects unsafe canonical URL %s", (url) => {
    expect(() => getClerkProxyUrl(req, url)).toThrow();
  });
});

describe("authentication-only staging writes", () => {
  function server(allowAuthentication: boolean) {
    const app = express();
    app.use("/api", stagingWriteGuard(true, allowAuthentication));
    app.use((_req, res) => res.json({ reached: true }));
    return app;
  }
  it("allows the Clerk proxy only with explicit permission", async () => {
    expect((await request(server(false)).post("/api/__clerk/v1/client")).status).toBe(503);
    expect((await request(server(true)).post("/api/__clerk/v1/client")).status).toBe(200);
  });
  it.each(["/api/stores", "/api/uploads/request-url", "/api/subscriptions/pay", "/api/__clerkevil"])(
    "never exempts business mutation %s", async (path) => {
      expect((await request(server(true)).post(path)).status).toBe(503);
    },
  );
});

describe("load-balancer client identity", () => {
  it("preserves Replit's one-hop default and requires an explicit Google setting", () => {
    expect(readProxyHopCount({})).toBe(1);
    expect(readProxyHopCount({ TRUST_PROXY_HOPS: "2" })).toBe(2);
    expect(() => readProxyHopCount({ TRUST_PROXY_HOPS: "true" })).toThrow();
  });
  it("ignores spoofed leftmost entries and does not rate-limit every client as the load balancer", async () => {
    const app = express();
    app.set("trust proxy", readProxyHopCount({ TRUST_PROXY_HOPS: "2" }));
    app.get("/", (req, res) => res.json({ ip: req.ip }));
    const result = await request(app).get("/")
      .set("X-Forwarded-For", "203.0.113.66, 198.51.100.25, 192.0.2.5");
    expect(result.body.ip).toBe("198.51.100.25");
  });
});
