import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface ImagePlaceholderProps {
  name: string;
  size?: number;
  borderRadius?: number;
}

export function ImagePlaceholder({ name, size = 64, borderRadius = 8 }: ImagePlaceholderProps) {
  const colors = useColors();
  const initial = name ? name.charAt(0).toUpperCase() : '?';

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: colors.primary,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          { fontSize: size * 0.4, color: colors.primaryForeground },
        ]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  text: {
    fontFamily: 'Inter_700Bold',
  },
});
