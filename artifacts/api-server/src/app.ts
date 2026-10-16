import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { resolveClerkPublishableKey } from "./lib/clerkConfiguration";
import { mountWebFrontends } from "./lib/webFrontends";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { preventDeletedAccountWrites } from "./lib/accountDeletion";
import { runtimeSafety, stagingWriteGuard, stagingAuthenticationGuard, readProxyHopCount } from "./lib/runtimeSafety";

const app: Express = express();

// Replit uses one hop. Google's external load balancer appends both the client
// and load-balancer IP, requiring two. Never trust attacker-supplied leftmost
// X-Forwarded-For entries or use blanket trust; rate limiting depends on req.ip.
app.set("trust proxy", readProxyHopCount(process.env));

// Cloud-only static hosting. Never change Replit's existing artifact routing.
if (process.env.WEB_FRONTEND_DIR) {
  mountWebFrontends(app, process.env.WEB_FRONTEND_DIR);
}

app.use("/api", stagingAuthenticationGuard(process.env));

// Before the auth proxy and every API handler: staging cannot trigger external
// effects or modify the production snapshot through a public mutation route.
app.use("/api", stagingWriteGuard(
  runtimeSafety.staging, process.env.MIGRATION_ALLOW_AUTH === "true",
));
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
    publishableKey: resolveClerkPublishableKey(
      getClerkProxyHost(req) ?? "",
      process.env,
    ),
  })),
);

app.use("/api", preventDeletedAccountWrites, router);

export default app;
