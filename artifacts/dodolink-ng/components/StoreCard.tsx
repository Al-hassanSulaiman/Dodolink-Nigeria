import React from 'react';
import { StyleSheet, View, Text, Pressable, Image } from 'react-native';
import { Link } from 'expo-router';
import { Store } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ImagePlaceholder } from './ImagePlaceholder';
import { getImageUrl } from '@/utils/storage';
import { Feather } from '@expo/vector-icons';

export function StoreCard({ store }: { store: Store }) {
  const colors = useColors();
  
  return (
    <Link href={`/store/${store.id}`} asChild>
      <Pressable style={StyleSheet.flatten([styles.card, { backgroundColor: colors.card, borderColor: colors.border }])}>
        {store.imageUrl ? (
          <Image source={{ uri: getImageUrl(store.imageUrl) }} style={styles.image} resizeMode="cover" />
        ) : (
          <ImagePlaceholder name={store.name} size={64} borderRadius={32} />
        )}
        <View style={styles.content}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {store.name}
          </Text>
          <View style={styles.metaRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.location, { color: colors.mutedForeground }]} numberOfLines={1}>
              {store.location}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Feather name="star" size={12} color={colors.accent} />
            <Text style={[styles.rating, { color: colors.foreground }]}>
              {store.avgRating ? store.avgRating.toFixed(1) : 'New'}
            </Text>
            <Text style={[styles.reviews, { color: colors.mutedForeground }]}>
              ({store.totalReviews})
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  image: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  content: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  location: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginLeft: 4,
  },
  rating: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginLeft: 4,
  },
  reviews: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginLeft: 4,
  },
});
