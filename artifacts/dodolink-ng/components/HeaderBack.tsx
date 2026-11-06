import { Pressable } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Our own back button for screens opened from the tabs. The built-in iPhone one
 * can stop responding after a pop-up or photo viewer was shown on the screen;
 * this one always works and falls back to Home if there is nothing to go back to.
 */
export function HeaderBack() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={14}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ paddingRight: 14, paddingVertical: 6 }}
    >
      <Feather name="chevron-left" size={28} color={colors.foreground} />
    </Pressable>
  );
}
