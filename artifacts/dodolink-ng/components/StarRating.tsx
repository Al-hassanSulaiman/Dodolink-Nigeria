import React from 'react';
import { View, StyleSheet, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface StarRatingProps {
  rating: number;
  size?: number;
  onRatingChange?: (rating: number) => void;
  showText?: boolean;
}

export function StarRating({ rating, size = 16, onRatingChange, showText = true }: StarRatingProps) {
  const colors = useColors();
  const maxStars = 5;

  return (
    <View style={styles.container}>
      <View style={styles.stars}>
        {Array.from({ length: maxStars }).map((_, i) => {
          const starNum = i + 1;
          const isFilled = starNum <= Math.round(rating);
          
          return (
            <Pressable 
              key={i} 
              onPress={() => onRatingChange?.(starNum)}
              disabled={!onRatingChange}
              style={{ marginRight: 2 }}
            >
              <Feather 
                name="star" 
                size={size} 
                color={isFilled ? colors.accent : colors.muted} 
                style={isFilled ? styles.filled : undefined}
              />
            </Pressable>
          );
        })}
      </View>
      {showText && rating > 0 && (
        <Text style={[styles.text, { color: colors.foreground, fontSize: Math.max(12, size - 4) }]}>
          {rating.toFixed(1)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stars: {
    flexDirection: 'row',
  },
  filled: {
    fill: '#F59E0B',
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    marginLeft: 6,
  },
});
