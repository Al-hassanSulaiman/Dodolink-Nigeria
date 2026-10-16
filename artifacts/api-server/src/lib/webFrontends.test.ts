import express from "express";
import request from "supertest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mountWebFrontends } from "./webFrontends";

const directory = mkdtempSync(path.join(tmpdir(), "dodolink-frontends-"));
for (const folder of ["app", "admin"]) {
  mkdirSync(path.join(directory, folder, "assets"), { recursive: true });
  writeFileSync(path.join(directory, folder, "index.html"), `<html>${folder}</html>`);
  writeFileSync(path.join(directory, folder, "assets", "bundle.js"), `/* ${folder} */`);
}
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const app = express();
mountWebFrontends(app, directory);
app.get("/api/healthz", (_req, res) => { res.json({ status: "ok" }); });

describe("combined Cloud Run web routing", () => {
  it.each(["/", "/store/17"])("serves the customer app at %s", async route => {
    expect((await request(app).get(route)).text).toContain("<html>app</html>");
  });
  it("redirects the admin base to its canonical slash path", async () => {
    expect((await request(app).get("/admin")).headers.location).toBe("/admin/");
  });
  it.each(["/admin/", "/admin/stores"])("serves admin routes at %s", async route => {
    expect((await request(app).get(route)).text).toContain("<html>admin</html>");
  });
  it("serves admin assets from the admin build", async () => {
    expect((await request(app).get("/admin/assets/bundle.js")).text).toBe("/* admin */");
  });
  it("does not turn missing assets into successful HTML", async () => {
    expect((await request(app).get("/admin/assets/missing.js")).status).toBe(404);
  });
  it("never shadows API routes", async () => {
    expect((await request(app).get("/api/healthz")).body).toEqual({ status: "ok" });
    expect((await request(app).get("/api/missing")).status).toBe(404);
  });
});
