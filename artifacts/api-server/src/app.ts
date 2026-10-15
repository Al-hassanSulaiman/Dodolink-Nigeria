import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { preventDeletedAccountWrites } from "./lib/accountDeletion";
import { runtimeSafety, stagingWriteGuard } from "./lib/runtimeSafety";

const app: Express = express();

// Trust exactly one proxy hop (the Replit / deployment reverse proxy) so that
// req.ip reflects the real visitor address from X-Forwarded-For rather than
// the proxy's internal socket address. express-rate-limit relies on req.ip.
app.set("trust proxy", 1);

// Before the auth proxy and every API handler: staging cannot trigger external
// effects or modify the production snapshot through a public mutation route.
app.use("/api", stagingWriteGuard(runtimeSafety.staging));
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Only trust our own web origins with credentials. Native mobile apps send no
// Origin header, so they are unaffected. Reflecting arbitrary origins with
// credentials would let any website make authenticated calls as a logged-in
// visitor.
const ALLOWED_ORIGIN_HOSTS = new Set(
  [
    "dodolink.com.ng",
    "www.dodolink.com.ng",
    process.env.REPLIT_DEV_DOMAIN,
    process.env.REPLIT_EXPO_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
  ].filter((h): h is string => !!h),
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) { callback(null, true); return; } // same-origin / native apps
      try {
        const { hostname } = new URL(origin);
        callback(null, ALLOWED_ORIGIN_HOSTS.has(hostname) || hostname === "localhost");
      } catch {
        callback(null, false);
      }
    },
  }),
);
// Keep the raw request bytes so the Paystack webhook can verify its
// HMAC signature against exactly what was sent.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains (e.g. dodolink.com.ng and
// the replit.app domain). Falls back to CLERK_PUBLISHABLE_KEY when the host
// doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", preventDeletedAccountWrites, router);

export default app;
