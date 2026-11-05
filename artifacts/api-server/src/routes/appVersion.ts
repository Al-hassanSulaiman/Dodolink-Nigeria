import { Router, type IRouter } from "express";
import { LATEST_APP_BUILD, STORE_URL } from "../lib/appVersion";

const router: IRouter = Router();

// Public on purpose: the app asks this before anyone signs in.
router.get("/app-version", (req, res): void => {
  const platform = req.query.platform;
  if (platform !== "ios" && platform !== "android") {
    res.status(400).json({ error: "platform must be ios or android" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ latestBuild: LATEST_APP_BUILD[platform], storeUrl: STORE_URL[platform] });
});

export default router;
