import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import {
  registerPushToken,
  reportPushRegistrationDiagnostic,
} from '@workspace/api-client-react';

// expo-notifications throws at import time in Expo Go on SDK 53+.
// We lazy-require it only in real device/EAS builds.
type NotificationsModule = typeof import('expo-notifications');

const FALLBACK_EXPO_PROJECT_ID = '3e4ed22b-8363-4fff-9ee7-be8921e99e55';
const NATIVE_STAGE_TIMEOUT_MS = 10_000;
const PERMISSION_TIMEOUT_MS = 60_000;
const AUTH_TIMEOUT_MS = 15_000;
const EXPO_TOKEN_TIMEOUT_MS = 20_000;
const API_TIMEOUT_MS = 15_000;
const DIAGNOSTIC_TIMEOUT_MS = 5_000;

export type PushRegistrationStage =
  | 'started'
  | 'channel'
  | 'permission'
  | 'auth-token'
  | 'expo-token'
  | 'server-registration'
  | 'completed';

export type PushRegistrationState =
  | { status: 'idle' | 'registered' }
  | { status: 'registering'; stage: PushRegistrationStage; message: string }
  | { status: 'permission-denied'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

type GetAuthToken = () => Promise<string | null>;

function describePermission(
  permission: Awaited<ReturnType<NotificationsModule['getPermissionsAsync']>>,
): string {
  if (Platform.OS !== 'ios') return permission.status;
  const ios = permission.ios;
  return [
    permission.status,
    `ios=${ios?.status ?? 'unknown'}`,
    `alert=${ios?.allowsAlert ?? false}`,
    `sound=${ios?.allowsSound ?? false}`,
    `badge=${ios?.allowsBadge ?? false}`,
  ].join(',');
}

function getNotificationsModule(): NotificationsModule {
  return require('expo-notifications') as NotificationsModule;
}

function ensureAndroidMessagesChannel(N: NotificationsModule) {
  return N.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: N.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1B5E20',
    sound: 'default',
  });
}

class PushRegistrationTimeoutError extends Error {
  readonly stage: PushRegistrationStage | 'diagnostic';

  constructor(stage: PushRegistrationStage | 'diagnostic') {
    super(`${stage} timed out`);
    this.name = 'PushRegistrationTimeoutError';
    this.stage = stage;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: PushRegistrationStage | 'diagnostic',
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new PushRegistrationTimeoutError(stage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getErrorCode(error: unknown): string {
  if (error instanceof PushRegistrationTimeoutError) {
    return `${error.stage}-timeout`;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'request-aborted';
  }

  const raw = error instanceof Error ? error.message : String(error);
  if (/401|unauthorized|authentication/i.test(raw)) return 'authentication-error';
  if (/firebase|fcm/i.test(raw)) return 'firebase-error';
  if (/apns/i.test(raw)) return 'apns-error';
  if (/network|fetch|offline/i.test(raw)) return 'network-error';
  return 'registration-error';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof PushRegistrationTimeoutError) {
    if (error.stage === 'auth-token') {
      return 'Your sign-in session took too long to prepare notifications. Tap Try again.';
    }
    if (error.stage === 'expo-token') {
      return 'Your phone took too long to connect to the notification service. Check your connection, then tap Try again.';
    }
    if (error.stage === 'server-registration') {
      return 'Dodolink could not finish saving this phone for notifications. Tap Try again.';
    }
    return 'Your phone did not finish setting up notifications. Tap Try again.';
  }

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

export function useAndroidNotificationChannelBootstrap() {
  useEffect(() => {
    if (Platform.OS !== 'android' || Constants.appOwnership === 'expo') return;

    try {
      const N = getNotificationsModule();
      void withTimeout(
        ensureAndroidMessagesChannel(N),
        NATIVE_STAGE_TIMEOUT_MS,
        'channel',
      ).catch((error) => {
        console.error('[PushNotifications] Android channel bootstrap failed:', error);
      });
    } catch (error) {
      console.error('[PushNotifications] Android notification module bootstrap failed:', error);
    }
  }, []);
}

export function usePushNotifications(
  userId: string | null,
  getAuthToken: GetAuthToken,
) {
  const notifListener = useRef<{ remove(): void } | null>(null);
  const responseListener = useRef<{ remove(): void } | null>(null);
  const registrationInFlight = useRef(false);
  const attemptSequence = useRef(0);
  const getAuthTokenRef = useRef(getAuthToken);
  const requestControllers = useRef<Set<AbortController>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<PushRegistrationState>({ status: 'idle' });

  useEffect(() => {
    getAuthTokenRef.current = getAuthToken;
  }, [getAuthToken]);

  const retry = useCallback(() => {
    setState({
      status: 'registering',
      stage: 'started',
      message: 'Starting message notifications…',
    });
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
      const sequence = ++attemptSequence.current;
      const attemptId = `${Date.now().toString(36)}-${sequence.toString(36)}`;
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const appVersion = Constants.expoConfig?.version ?? 'unknown';
      const buildVersion =
        Constants.nativeBuildVersion ??
        (Platform.OS === 'android'
          ? String(Constants.expoConfig?.android?.versionCode ?? 'unknown')
          : Constants.expoConfig?.ios?.buildNumber ?? 'unknown');
      let authToken: string | null = null;
      let currentStage: PushRegistrationStage = 'started';

      const isCurrent = () => active && attemptSequence.current === sequence;
      const setStage = (stage: PushRegistrationStage, message: string) => {
        currentStage = stage;
        if (isCurrent()) {
          setState({ status: 'registering', stage, message });
        }
      };
      const createController = () => {
        const controller = new AbortController();
        requestControllers.current.add(controller);
        return controller;
      };
      const releaseController = (controller: AbortController) => {
        requestControllers.current.delete(controller);
      };
      const reportStage = async (
        stage: PushRegistrationStage,
        outcome: 'started' | 'success' | 'denied' | 'timeout' | 'error',
        extra?: { permissionStatus?: string; errorCode?: string },
      ) => {
        if (!authToken) return;
        const controller = createController();
        try {
          await withTimeout(
            reportPushRegistrationDiagnostic(
              {
                attemptId,
                stage,
                outcome,
                platform,
                appVersion,
                buildVersion,
                ...extra,
              },
              {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${authToken}` },
              },
            ),
            DIAGNOSTIC_TIMEOUT_MS,
            'diagnostic',
            () => controller.abort(),
          );
        } catch (error) {
          console.warn('[PushNotifications] Diagnostic could not be sent:', getErrorCode(error));
        } finally {
          releaseController(controller);
        }
      };

      try {
        setStage('channel', 'Preparing Android notification settings…');
        if (Platform.OS === 'android') {
          await withTimeout(
            ensureAndroidMessagesChannel(N),
            NATIVE_STAGE_TIMEOUT_MS,
            'channel',
          );
        }
        if (!isCurrent()) return;

        setStage('auth-token', 'Connecting notifications to your account…');
        authToken = await withTimeout(
          getAuthTokenRef.current(),
          AUTH_TIMEOUT_MS,
          'auth-token',
        );
        if (!authToken) {
          throw new Error('Authentication token is not ready');
        }
        if (!isCurrent()) return;

        void reportStage('started', 'started');
        void reportStage('channel', 'success');
        void reportStage('auth-token', 'success');

        setStage('permission', 'Checking notification permission…');
        const permission = await withTimeout(
          N.getPermissionsAsync(),
          NATIVE_STAGE_TIMEOUT_MS,
          'permission',
        );
        let finalPermission = permission;
        let finalStatus = permission.status;
        if (permission.status !== 'granted') {
          const requested = await withTimeout(
            N.requestPermissionsAsync({
              ios: {
                allowAlert: true,
                allowBadge: true,
                allowSound: true,
              },
            }),
            PERMISSION_TIMEOUT_MS,
            'permission',
          );
          finalPermission = requested;
          finalStatus = requested.status;
        }
        if (!isCurrent()) return;

        const iosAlertsDisabled =
          Platform.OS === 'ios' && finalPermission.ios?.allowsAlert === false;
        if (finalStatus !== 'granted' || iosAlertsDisabled) {
          void reportStage('permission', 'denied', {
            permissionStatus: describePermission(finalPermission),
          });
          setState({
            status: 'permission-denied',
            message: 'Notifications are turned off for Dodolink. Enable them in your phone settings to receive messages.',
          });
          return;
        }

        void reportStage('permission', 'success', {
          permissionStatus: describePermission(finalPermission),
        });

        const expoProjectId =
          Constants.easConfig?.projectId ??
          Constants.expoConfig?.extra?.eas?.projectId ??
          FALLBACK_EXPO_PROJECT_ID;

        setStage('expo-token', 'Connecting this phone to the notification service…');
        const tokenData = await withTimeout(
          N.getExpoPushTokenAsync({ projectId: expoProjectId }),
          EXPO_TOKEN_TIMEOUT_MS,
          'expo-token',
        );
        if (!isCurrent()) return;
        if (!tokenData?.data) {
          throw new Error('Push token service returned no token');
        }
        void reportStage('expo-token', 'success');

        setStage('server-registration', 'Saving notification access for this phone…');
        const controller = createController();
        try {
          await withTimeout(
            registerPushToken(
              { userId, token: tokenData.data, attemptId },
              {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${authToken}` },
              },
            ),
            API_TIMEOUT_MS,
            'server-registration',
            () => controller.abort(),
          );
        } finally {
          releaseController(controller);
        }
        if (!isCurrent()) return;

        void reportStage('server-registration', 'success');
        void reportStage('completed', 'success');
        console.info('[PushNotifications] Device token registered.');
        setState({ status: 'registered' });
      } catch (err) {
        console.error('[PushNotifications] Device token registration failed:', err);
        if (authToken) {
          void reportStage(
            currentStage,
            err instanceof PushRegistrationTimeoutError ? 'timeout' : 'error',
            { errorCode: getErrorCode(err) },
          );
        }
        if (isCurrent()) {
          setState({ status: 'error', message: getErrorMessage(err) });
        }
      } finally {
        if (attemptSequence.current === sequence) {
          registrationInFlight.current = false;
        }
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
      attemptSequence.current += 1;
      registrationInFlight.current = false;
      requestControllers.current.forEach((controller) => controller.abort());
      requestControllers.current.clear();
      appStateSubscription.remove();
      notifListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [retryKey, userId]);

  return { state, retry };
}
