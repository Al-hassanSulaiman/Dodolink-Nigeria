import { useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { router } from 'expo-router';
import { registerPushToken } from '@workspace/api-client-react';

// expo-notifications throws at import time in Expo Go on SDK 53+.
// We lazy-require it only in real device/EAS builds.
type NotificationsModule = typeof import('expo-notifications');

const isExpoGo = Constants.appOwnership === 'expo';
const expoProjectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;

let N: NotificationsModule | null = null;
if (!isExpoGo) {
  try {
    N = require('expo-notifications') as NotificationsModule;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch { /* ignore in any other unsupported env */ }
}

export function usePushNotifications(userId: string | null) {
  const notifListener = useRef<{ remove(): void } | null>(null);
  const responseListener = useRef<{ remove(): void } | null>(null);
  const registrationInFlight = useRef(false);

  useEffect(() => {
    if (!userId || Platform.OS === 'web' || !N) return;

    let active = true;

    const registerDevice = async () => {
      if (registrationInFlight.current) return;
      registrationInFlight.current = true;

      try {
        if (typeof expoProjectId !== 'string' || !expoProjectId) {
          console.warn('[PushNotifications] Missing Expo project ID; token registration skipped.');
          return;
        }

        const { status: existing } = await N!.getPermissionsAsync();
        let finalStatus = existing;

        if (existing !== 'granted') {
          const { status } = await N!.requestPermissionsAsync();
          finalStatus = status;
        }

        if (!active) return;

        if (finalStatus !== 'granted') {
          // Show a one-time alert so users know how to enable notifications
          Alert.alert(
            'Notifications are off',
            'Enable notifications in Settings to get messages and alerts from Dodolink.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }

        if (Platform.OS === 'android') {
          await N!.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: N!.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#1B5E20',
            sound: 'default',
          });
        }

        const tokenData = await N!.getExpoPushTokenAsync({ projectId: expoProjectId });
        if (active && tokenData?.data) {
          await registerPushToken({ userId, token: tokenData.data });
          console.info('[PushNotifications] Device token registered.');
        }
      } catch (err) {
        // The next foreground event retries registration, so a temporary
        // network or authentication failure does not disable notifications
        // for the rest of the session.
        console.warn('[PushNotifications] Device token registration failed:', err);
      } finally {
        registrationInFlight.current = false;
      }
    };

    void registerDevice();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerDevice();
    });

    notifListener.current = N.addNotificationReceivedListener(() => {});
    responseListener.current = N.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      const conversationId = data?.conversationId;
      if (conversationId != null) {
        router.push(`/chat/${conversationId}`);
      }
    });

    return () => {
      active = false;
      appStateSubscription.remove();
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [userId]);
}
