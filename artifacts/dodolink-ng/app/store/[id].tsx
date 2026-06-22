import { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, Image, Pressable } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { 
  useGetStore, 
  useGetStoreStats, 
  useListStoreProducts,
  useListStoreReviews,
  useCreateReview
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { ProductCard } from '@/components/ProductCard';
import { StarRating } from '@/components/StarRating';
import { EmptyState } from '@/components/EmptyState';
import { Feather } from '@expo/vector-icons';
import { Input, Button } from '@/components/ui';
import { useQueryClient } from '@tanstack/react-query';

export default function StoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const storeId = parseInt(id, 10);
  const colors = useColors();
  const { userId, userName } = useUserIdentity();
  const queryClient = useQueryClient();

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const { data: store, isLoading: storeLoading, refetch: refetchStore } = useGetStore(storeId, {
    query: { enabled: !!storeId }
  });

  const { data: stats, isLoading: statsLoading } = useGetStoreStats(storeId, {
    query: { enabled: !!storeId }
  });

  const { data: products, isLoading: productsLoading } = useListStoreProducts(storeId, {
    query: { enabled: !!storeId }
  });

  const { data: reviews, isLoading: reviewsLoading } = useListStoreReviews(storeId, {
    query: { enabled: !!storeId }
  });

  const createReview = useCreateReview({
    mutation: {
      onSuccess: () => {
        setRating(0);
        setComment('');
        refetchStore();
      }
    }
  });

  const handleSubmitReview = () => {
    if (!rating || !userId || !userName) return;
    createReview.mutate({ storeId, data: {
      rating,
      comment,
      reviewerId: userId,
      reviewerName: userName
    }});
  };

  const refreshing = storeLoading || productsLoading;
  const onRefresh = () => {
    refetchStore();
  };

  if (storeLoading && !store) return <LoadingScreen message="Loading store..." />;
  if (!store) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: store.name }} />
      <ScrollView 
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={[styles.banner, { backgroundColor: colors.primary }]} />
        <View style={styles.header}>
          <View style={[styles.avatarContainer, { borderColor: colors.background }]}>
            {store.imageUrl ? (
              <Image source={{ uri: store.imageUrl }} style={styles.avatar} />
            ) : (
              <ImagePlaceholder name={store.name} size={80} borderRadius={40} />
            )}
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.name, { color: colors.foreground }]}>{store.name}</Text>
            <View style={styles.statsRow}>
              <StarRating rating={store.avgRating || 0} size={14} />
              <Text style={[styles.reviewsCount, { color: colors.mutedForeground }]}>
                ({store.totalReviews} reviews)
              </Text>
            </View>
            <Text style={[styles.location, { color: colors.mutedForeground }]}>
              <Feather name="map-pin" size={12} /> {store.location}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.description, { color: colors.foreground }]}>{store.description}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Products</Text>
          {products && products.length > 0 ? (
            <View style={styles.grid}>
              {products.map(product => (
                <View key={product.id} style={styles.gridItem}>
                  <ProductCard product={product} />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState icon="box" title="No products" description="This store hasn't added any products yet." />
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reviews</Text>
          
          <View style={[styles.reviewForm, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.formTitle, { color: colors.foreground }]}>Leave a Review</Text>
            <StarRating rating={rating} onRatingChange={setRating} size={24} showText={false} />
            <Input
              placeholder="Write your comment..."
              value={comment}
              onChangeText={setComment}
              multiline
              style={styles.reviewInput}
            />
            <Button 
              title={createReview.isPending ? "Submitting..." : "Submit Review"} 
              onPress={handleSubmitReview}
              disabled={rating === 0 || createReview.isPending}
            />
          </View>

          {reviews && reviews.length > 0 ? (
            reviews.map(review => (
              <View key={review.id} style={[styles.reviewItem, { borderBottomColor: colors.border }]}>
                <View style={styles.reviewHeader}>
                  <Text style={[styles.reviewerName, { color: colors.foreground }]}>{review.reviewerName}</Text>
                  <StarRating rating={review.rating} size={12} showText={false} />
                </View>
                {review.comment ? (
                  <Text style={[styles.reviewComment, { color: colors.foreground }]}>{review.comment}</Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={[styles.noReviews, { color: colors.mutedForeground }]}>No reviews yet.</Text>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
  },
  banner: {
    height: 120,
    width: '100%',
  },
  header: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    marginTop: -40,
    marginBottom: 16,
  },
  avatarContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  name: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  reviewsCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginLeft: 8,
  },
  location: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -8,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 8,
  },
  reviewForm: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
  },
  formTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 12,
  },
  reviewInput: {
    height: 80,
    marginTop: 12,
    marginBottom: 12,
    textAlignVertical: 'top',
  },
  reviewItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  reviewerName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  reviewComment: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  noReviews: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 16,
  },
});
