import { Platform } from "react-native";

export function getApiBase(): string {
  // In production web builds, the app is served from the same domain as the
  // API (any domain pointed at the deployment), so the browser's own origin
  // is always correct. In development the web preview runs on the Expo dev
  // domain while the API lives on the workspace domain, so we must use the
  // baked-in EXPO_PUBLIC_DOMAIN there.
  if (
    !__DEV__ &&
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.location?.origin
  ) {
    return window.location.origin;
  }
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
}
