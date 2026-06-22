// Push notification registration is not supported in Expo Go (SDK 53+).
// The backend infrastructure (push_tokens table + Expo push API) is in place.
// When building with `expo build` or EAS Build for production/TestFlight,
// replace this stub with the full implementation using expo-notifications.
export function usePushNotifications(_userId: string | null) {
  // no-op in Expo Go
}
