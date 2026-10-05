import { useFonts } from "expo-font";
import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { Platform, AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PushNotificationSetup } from "@/components/PushNotificationSetup";
import { WebMcpRegistration } from "@/components/WebMcpRegistration";
import { setAuthTokenGetter, setBaseUrl, setRequestTimeout, setPublicReadAuthEnabled } from "@workspace/api-client-react";
import {
  useAndroidNotificationChannelBootstrap,
  usePushNotifications,
} from "@/hooks/usePushNotifications";
import { getApiBase } from "@/utils/apiBase";

setBaseUrl(getApiBase());
setRequestTimeout(30000);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

// Clerk proxy URL: baked into the bundle by scripts/build.js at deploy time.
// On web in production, rebase the proxy path onto the current origin so the
// app works on any domain pointed at the deployment (e.g. dodolink.com.ng),
// mirroring getApiBase(). Native bundles keep the full baked URL.
function getClerkProxyUrl(): string | undefined {
  const baked = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || "";
  if (!baked) return undefined;
  if (Platform.OS === "web" && !__DEV__ && typeof window !== "undefined") {
    try {
      return window.location.origin + new URL(baked).pathname;
    } catch {
      return baked;
    }
  }
  return baked;
}
const proxyUrl = getClerkProxyUrl();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      gcTime: 30 * 60 * 1000,
      retry: (count, error) => count < 1 && ![400, 401, 403, 404].includes((error as { status?: number }).status ?? 0),
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

function PushNotificationsGate() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  setPublicReadAuthEnabled(!!isSignedIn);
  const previousUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const current = isSignedIn ? userId : null;
    if (previousUser.current !== undefined && previousUser.current !== current) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    previousUser.current = current;
  }, [isLoaded, isSignedIn, userId]);

  // Push registration happens at the root, before the tab layout is guaranteed
  // to mount. Set the bearer-token getter here so saving a device token never
  // fails with an unauthenticated request immediately after sign-in.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  const { state, retry } = usePushNotifications(
    isLoaded && isSignedIn ? userId : null,
    getToken,
  );

  return <PushNotificationSetup state={state} onRetry={retry} />;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back", headerTintColor: "#1B5E20" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="store/[id]" options={{ title: "Store", headerShown: true }} />
      <Stack.Screen name="product/[id]" options={{ title: "Product", headerShown: true }} />
      <Stack.Screen name="chat" options={{ headerShown: false }} />
      <Stack.Screen name="my-store" options={{ headerShown: false }} />
      <Stack.Screen name="account" options={{ title: "Account settings" }} />
    </Stack>
  );
}

export default function RootLayout() {
  useAndroidNotificationChannelBootstrap();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => focusManager.setFocused(state === 'active'));
    return () => subscription.remove();
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
  });

  useEffect(() => {
    if (Platform.OS === "web" || fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Browser font downloads must not delay public browsing on slow connections.
  // Native fonts are bundled with the app, not downloaded on each launch.
  if (Platform.OS !== "web" && !fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <WebMcpRegistration />
              <PushNotificationsGate />
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
    </ClerkProvider>
  );
}
