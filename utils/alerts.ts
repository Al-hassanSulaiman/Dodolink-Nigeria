import { Alert, Platform } from 'react-native';

/**
 * Cross-platform alert. React Native's Alert.alert is a no-op on web,
 * so on web we fall back to window.alert.
 */
export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
  } else {
    Alert.alert(title, message);
  }
}

/**
 * Cross-platform confirm dialog. On web uses window.confirm,
 * on native uses Alert.alert with Cancel/Confirm buttons.
 */
export function confirmAlert(options: {
  title: string;
  message?: string;
  confirmText?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const { title, message, confirmText = 'OK', destructive, onConfirm } = options;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(message ? `${title}\n\n${message}` : title)) {
      onConfirm();
    }
  } else {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: confirmText,
        style: destructive ? 'destructive' : 'default',
        onPress: onConfirm,
      },
    ]);
  }
}
