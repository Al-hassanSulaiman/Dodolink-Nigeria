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

const app: Express = express();

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
app.use(express.json());
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

app.use("/api", router);

export default app;
