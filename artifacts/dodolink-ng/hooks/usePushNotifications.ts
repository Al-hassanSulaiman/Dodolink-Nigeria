import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { registerPushToken } from '@workspace/api-client-react';

// expo-notifications throws at import time in Expo Go on SDK 53+.
// We lazy-require it only in real device/EAS builds.
type NotificationsModule = typeof import('expo-notifications');

const FALLBACK_EXPO_PROJECT_ID = '3e4ed22b-8363-4fff-9ee7-be8921e99e55';

export type PushRegistrationState =
  | { status: 'idle' | 'registering' | 'registered' }
  | { status: 'permission-denied'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

type GetAuthToken = () => Promise<string | null>;

function getNotificationsModule(): NotificationsModule {
  return require('expo-notifications') as NotificationsModule;
}

function getErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized|authentication/i.test(raw)) {
    return 'Your sign-in session was not ready. Tap Try again.';
  }
  if (/firebase|fcm|apns|credential|push token/i.test(raw)) {
    return 'This build could not connect to the phone notification service. Tap Try again.';
  }
  if (/network|fetch|timeout|offline/i.test(raw)) {
    return 'Check your internet connection, then tap Try again.';
  }
  return 'Dodolink could not connect notifications on this phone. Tap Try again.';
}

export function usePushNotifications(
  userId: string | null,
  getAuthToken: GetAuthToken,
) {
  const notifListener = useRef<{ remove(): void } | null>(null);
  const responseListener = useRef<{ remove(): void } | null>(null);
  const registrationInFlight = useRef(false);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<PushRegistrationState>({ status: 'idle' });

  const retry = useCallback(() => {
    setState({ status: 'registering' });
    setRetryKey((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setState({ status: 'idle' });
      return;
    }

    if (Platform.OS === 'web') return;

    if (Constants.appOwnership === 'expo') {
      setState({
        status: 'unsupported',
        message: 'Push notifications require the installed Dodolink app, not Expo Go.',
      });
      return;
    }

    let active = true;
    let N: NotificationsModule;

    try {
      N = getNotificationsModule();
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
    } catch (error) {
      console.error('[PushNotifications] Native notifications module failed to load:', error);
      setState({
        status: 'unsupported',
        message: 'Notifications are unavailable in this installation. Install the latest Dodolink update.',
      });
      return;
    }

    const registerDevice = async () => {
      if (registrationInFlight.current) return;
      registrationInFlight.current = true;
      if (active) setState({ status: 'registering' });

      try {
        const authToken = await getAuthToken();
        if (!authToken) {
          throw new Error('Authentication token is not ready');
        }

        const expoProjectId =
          Constants.easConfig?.projectId ??
          Constants.expoConfig?.extra?.eas?.projectId ??
          FALLBACK_EXPO_PROJECT_ID;

        if (Platform.OS === 'android') {
          await N.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: N.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#1B5E20',
            sound: 'default',
          });
        }

        const { status: existing } = await N.getPermissionsAsync();
        let finalStatus = existing;

        if (existing !== 'granted') {
          const { status } = await N.requestPermissionsAsync();
          finalStatus = status;
        }

        if (!active) return;

        if (finalStatus !== 'granted') {
          setState({
            status: 'permission-denied',
            message: 'Notifications are turned off for Dodolink. Enable them in your phone settings to receive messages.',
          });
          return;
        }

        const tokenData = await N.getExpoPushTokenAsync({ projectId: expoProjectId });
        if (active && tokenData?.data) {
          await registerPushToken({ userId, token: tokenData.data });
          console.info('[PushNotifications] Device token registered.');
          setState({ status: 'registered' });
        } else if (active) {
          throw new Error('Push token service returned no token');
        }
      } catch (err) {
        console.error('[PushNotifications] Device token registration failed:', err);
        if (active) {
          setState({ status: 'error', message: getErrorMessage(err) });
        }
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
  }, [getAuthToken, retryKey, userId]);

  return { state, retry };
}
