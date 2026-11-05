/**
 * Newest app build available in the stores, per platform. Raise a number here
 * (and deploy) only AFTER that build is live in the App Store / Google Play,
 * and the in-app "update available" pop-up starts showing for older builds.
 * Equal to the current build numbers on purpose: no pop-up until you bump them.
 */
export const LATEST_APP_BUILD = { ios: 20, android: 12 } as const;

export const STORE_URL = {
  ios: "https://apps.apple.com/app/id6801929226",
  android: "https://play.google.com/store/apps/details?id=com.dodolink.ng",
} as const;
