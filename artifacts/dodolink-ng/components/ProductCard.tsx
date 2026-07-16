import React from 'react';
import { StyleSheet, View, Text, Pressable, Image } from 'react-native';
import { Link } from 'expo-router';
import { Product } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { ImagePlaceholder } from './ImagePlaceholder';
import { getImageUrl } from '@/utils/storage';

export function ProductCard({ product }: { product: Product }) {
  const colors = useColors();
  const rawThumb = (product.imageUrls && product.imageUrls[0]) || product.imageUrl || null;
  const thumbnail = rawThumb ? getImageUrl(rawThumb) : null;

  return (
    <Link href={`/product/${product.id}`} asChild>
      <Pressable style={StyleSheet.flatten([styles.card, { backgroundColor: colors.card, borderColor: colors.border }])}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.imageContainer, { backgroundColor: colors.muted }]}>
            <ImagePlaceholder name={product.name} size={80} borderRadius={0} />
          </View>
        )}
        <View style={styles.content}>
          <Text style={[styles.storeName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {product.storeName}
          </Text>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={[styles.price, { color: colors.primary }]}>
            ₦{product.price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },
  image: {
    width: '100%',
    aspectRatio: 1,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 12,
  },
  storeName: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 4,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 8,
    lineHeight: 18,
  },
  price: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
});
