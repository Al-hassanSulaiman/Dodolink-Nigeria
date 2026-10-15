import express, { type Express, type RequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

export function mountWebFrontends(app: Express, directory: string) {
  const root = path.resolve(directory);
  const customer = path.join(root, "app");
  const admin = path.join(root, "admin");
  for (const folder of [customer, admin]) {
    if (!existsSync(path.join(folder, "index.html"))) {
      throw new Error("Cloud web frontend build is incomplete.");
    }
  }
  const fallback = (folder: string): RequestHandler => (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) { next(); return; }
    // Missing JS/images must never receive an HTML document.
    if (path.extname(req.path)) { res.sendStatus(404); return; }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(folder, "index.html"));
  };
  app.get(/^\/admin$/, (_req, res) => { res.redirect(308, "/admin/"); });
  app.use("/admin", express.static(admin, { index: false }), fallback(admin));
  app.use((req, res, next) => {
    if (/^\/api(?:\/|$)/.test(req.path)) { next(); return; }
    express.static(customer, { index: false })(req, res, error => {
      if (error) { next(error); return; }
      fallback(customer)(req, res, next);
    });
  });
}
