import { useFonts } from "expo-font";
import { ClerkProvider, ClerkLoaded, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PushNotificationSetup } from "@/components/PushNotificationSetup";
import { WebMcpRegistration } from "@/components/WebMcpRegistration";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import {
  useAndroidNotificationChannelBootstrap,
  usePushNotifications,
} from "@/hooks/usePushNotifications";
import { getApiBase } from "@/utils/apiBase";

setBaseUrl(getApiBase());

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

const queryClient = new QueryClient();

function PushNotificationsGate() {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();

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
      <Stack.Screen name="chat/[conversationId]" options={{ title: "Chat", headerShown: true }} />
      <Stack.Screen name="my-store/create" options={{ title: "Create Store", headerShown: true }} />
      <Stack.Screen name="my-store/add-product" options={{ title: "Add Product", headerShown: true }} />
    </Stack>
  );
}

export default function RootLayout() {
  useAndroidNotificationChannelBootstrap();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
    Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
    Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
    Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <WebMcpRegistration />
              <PushNotificationsGate />
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
