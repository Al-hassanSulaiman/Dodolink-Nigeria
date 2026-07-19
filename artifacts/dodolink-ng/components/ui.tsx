import React from 'react';
import { View, Pressable, StyleSheet, Text, TextInput, TextInputProps, StyleProp, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface ButtonProps {
  onPress: () => void;
  title: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ onPress, title, variant = 'primary', disabled, style }: ButtonProps) {
  const colors = useColors();
  
  let backgroundColor = colors.primary;
  let textColor = colors.primaryForeground;
  let borderColor = 'transparent';

  if (variant === 'secondary') {
    backgroundColor = colors.secondary;
    textColor = colors.secondaryForeground;
  } else if (variant === 'outline') {
    backgroundColor = 'transparent';
    textColor = colors.primary;
    borderColor = colors.border;
  } else if (variant === 'ghost') {
    backgroundColor = 'transparent';
    textColor = colors.primary;
  }

  if (disabled) {
    backgroundColor = colors.muted;
    textColor = colors.mutedForeground;
    borderColor = 'transparent';
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          borderWidth: variant === 'outline' ? 1 : 0,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { color: textColor }]}>{title}</Text>
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const colors = useColors();
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.mutedForeground}
      style={[
        styles.input,
        {
          backgroundColor: colors.background,
          borderColor: colors.input,
          color: colors.foreground,
        },
        props.style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
});
