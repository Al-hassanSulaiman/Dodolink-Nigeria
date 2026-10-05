import { useAuth } from '@clerk/expo';
import { router, usePathname } from 'expo-router';
import { View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui';
import type { ReactNode } from 'react';

export function RequireAccount({ children }: { children?: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const path = usePathname();
  const colors = useColors();
  // Keep browsing available even while the authentication service is loading.
  if (isLoaded && isSignedIn) return <>{children}</>;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: 24, gap: 16 }}>
      <Text style={{ color: colors.foreground, fontSize: 24, fontFamily: 'Inter_600SemiBold' }}>Sign in for this feature</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>You can browse stores and products without an account. Sign in to chat, manage your store, or use account settings.</Text>
      <Button title="Sign in" onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { returnTo: path } })} />
      <Button title="Create account" onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { returnTo: path } })} />
      <Button title="Keep browsing" onPress={() => router.replace('/(tabs)')} />
    </View>
  );
}
