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
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {store.name}
            </Text>
            {store.verificationStatus === 'verified' && (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.primary }]}>
                <Feather name="check-circle" size={10} color="#fff" />
                <Text style={styles.verifiedText}>Verified</Text>
              </View>
            )}
          </View>
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 2,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  verifiedText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#fff',
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
