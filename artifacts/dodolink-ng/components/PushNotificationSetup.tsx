import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PushRegistrationState } from '@/hooks/usePushNotifications';

// The "turn on notifications" reminder is shown once per install. Without this
// it re-opened every time the app returned to the foreground.
const DENIED_PROMPT_SEEN_KEY = 'dodolink.push.deniedPromptSeen.v1';

interface PushNotificationSetupProps {
  state: PushRegistrationState;
  onRetry: () => void;
}

export function PushNotificationSetup({
  state,
  onRetry,
}: PushNotificationSetupProps) {
  const [dismissed, setDismissed] = useState(false);
  const [showSlowRegistration, setShowSlowRegistration] = useState(false);
  // null = still reading storage; the denied reminder waits for the answer.
  const [deniedPromptSeen, setDeniedPromptSeen] = useState<boolean | null>(null);
  const registering = state.status === 'registering';
  const permissionDenied = state.status === 'permission-denied';

  useEffect(() => {
    AsyncStorage.getItem(DENIED_PROMPT_SEEN_KEY)
      .then(value => setDeniedPromptSeen(value === '1'))
      .catch(() => setDeniedPromptSeen(true));
  }, []);

  const markDeniedPromptSeen = () => {
    setDeniedPromptSeen(true);
    AsyncStorage.setItem(DENIED_PROMPT_SEEN_KEY, '1').catch(() => {});
  };

  const dismiss = () => {
    setDismissed(true);
    if (permissionDenied) markDeniedPromptSeen();
  };

  const needsAttention =
    (permissionDenied && deniedPromptSeen === false) ||
    state.status === 'unsupported' ||
    state.status === 'error' ||
    (registering && showSlowRegistration);

  useEffect(() => {
    if (needsAttention) setDismissed(false);
  }, [needsAttention, state.status]);

  useEffect(() => {
    if (!registering) {
      setShowSlowRegistration(false);
      return;
    }

    const timer = setTimeout(() => setShowSlowRegistration(true), 3_000);
    return () => clearTimeout(timer);
  }, [registering, state.status === 'registering' ? state.stage : null]);

  if (!needsAttention || dismissed) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Text style={styles.iconText}>!</Text>
          </View>
          <Text style={styles.title}>
            {permissionDenied
              ? 'Turn on message notifications'
              : registering
                ? 'Connecting message notifications'
                : 'Notifications need attention'}
          </Text>
          <Text style={styles.message}>{state.message}</Text>

          <Pressable
            accessibilityRole="button"
            style={styles.primaryButton}
            onPress={
              permissionDenied
                ? () => {
                    markDeniedPromptSeen();
                    void Linking.openSettings();
                  }
                : onRetry
            }
          >
            <Text style={styles.primaryButtonText}>
              {permissionDenied ? 'Open phone settings' : 'Try again now'}
            </Text>
          </Pressable>

          {permissionDenied && (
            <Pressable accessibilityRole="button" style={styles.retryButton} onPress={onRetry}>
              <Text style={styles.retryButtonText}>I enabled it — check again</Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            style={styles.laterButton}
            onPress={dismiss}
          >
            <Text style={styles.laterButtonText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(8, 24, 15, 0.62)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  icon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: '#E8F5E9',
  },
  iconText: {
    color: '#1B5E20',
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  title: {
    color: '#15331F',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 27,
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    marginBottom: 22,
    color: '#54685B',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    minHeight: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B5E20',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  retryButton: {
    width: '100%',
    minHeight: 46,
    marginTop: 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F5E9',
  },
  retryButtonText: {
    color: '#1B5E20',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  laterButton: {
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  laterButtonText: {
    color: '#6B7D70',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
});