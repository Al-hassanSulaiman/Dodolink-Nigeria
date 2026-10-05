import { useAuth } from "@clerk/expo";
import { Redirect, Stack, router, useLocalSearchParams, type Href } from "expo-router";
import React, { useRef } from "react";
import { View } from "react-native";
import { LoadingScreen } from "@/components/Loading";
import { Button } from "@/components/ui";

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const destination = useRef("/(tabs)");
  if (typeof returnTo === "string" &&
    /^\/(store\/|product\/|chat\/|my-store(?:\/|$)|support$|account$)/.test(returnTo)) {
    destination.current = returnTo;
  }

  if (!isLoaded) return (
    <View style={{ flex: 1, paddingBottom: 24 }}>
      <LoadingScreen message="Loading sign-in..." />
      <Button title="Keep browsing" onPress={() => router.replace("/(tabs)")} />
    </View>
  );
  if (isSignedIn) return <Redirect href={destination.current as Href} />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
