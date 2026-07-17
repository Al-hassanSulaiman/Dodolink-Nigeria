import { useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, Pressable, Alert, Image } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import {
  useGetStore,
  useListStoreProducts,
  useListStoreReviews,
  useCreateReview,
  useUpdateStore,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { StoreAvatar } from '@/components/StoreAvatar';
import { getImageUrl } from '@/utils/storage';
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

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCacNumber, setEditCacNumber] = useState('');

  const { data: store, isLoading: storeLoading, refetch: refetchStore } = useGetStore(storeId, {
    query: { enabled: !!storeId }
  });

  const { data: products } = useListStoreProducts(storeId, {
    query: { enabled: !!storeId }
  });

  const { data: reviews } = useListStoreReviews(storeId, {
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

  const updateStore = useUpdateStore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['listStores'] });
        queryClient.invalidateQueries({ queryKey: ['getStore', storeId] });
        setIsEditing(false);
      },
      onError: () => {
        Alert.alert('Save failed', 'Could not update the store. Please try again.');
      }
    }
  });

  const isOwner = !!userId && !!store && store.ownerUserId === userId;

  const handleStartEdit = () => {
    if (!store) return;
    setEditName(store.name);
    setEditDescription(store.description);
    setEditLocation(store.location);
    setEditCategory(store.category);
    setEditPhone(store.phone);
    setEditCacNumber(store.cacNumber ?? '');
    setIsEditing(true);
  };

  const handleSave = () => {
    updateStore.mutate({
      storeId,
      data: {
        name: editName.trim() || store!.name,
        description: editDescription.trim(),
        location: editLocation.trim(),
        category: editCategory.trim(),
        phone: editPhone.trim(),
        cacNumber: editCacNumber.trim() || null,
      }
    });
  };

  const handleSubmitReview = () => {
    if (!rating || !userId || !userName) return;
    createReview.mutate({ storeId, data: {
      rating,
      comment,
      reviewerId: userId,
      reviewerName: userName
    }});
  };

  const onRefresh = () => { refetchStore(); };

  if (storeLoading && !store) return <LoadingScreen message="Loading store..." />;
  if (!store) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: isEditing ? 'Edit Store' : store.name,
          headerRight: isOwner ? () => (
            isEditing ? (
              <View style={styles.headerButtons}>
                <Pressable onPress={() => setIsEditing(false)} hitSlop={8} style={styles.headerBtn}>
                  <Feather name="x" size={20} color={colors.mutedForeground} />
                </Pressable>
                <Pressable onPress={handleSave} hitSlop={8} style={styles.headerBtn} disabled={updateStore.isPending}>
                  <Feather name="check" size={20} color={colors.primary} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={handleStartEdit} hitSlop={8} style={styles.headerBtn}>
                <Feather name="edit-2" size={18} color={colors.mutedForeground} />
              </Pressable>
            )
          ) : undefined,
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={storeLoading} onRefresh={onRefresh} />}
      >
        <View style={[styles.banner, { backgroundColor: colors.primary }]} />

        <View style={styles.header}>
          <View style={[styles.avatarContainer, { borderColor: colors.background }]}>
            {isOwner ? (
              <StoreAvatar store={store} size={80} editable />
            ) : store.imageUrl ? (
              <Image source={{ uri: getImageUrl(store.imageUrl) }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <ImagePlaceholder name={store.name} size={80} borderRadius={40} />
            )}
          </View>

          <View style={styles.headerInfo}>
            {isEditing ? (
              <Input
                value={editName}
                onChangeText={setEditName}
                placeholder="Store name"
                style={styles.editNameInput}
              />
            ) : (
              <Text style={[styles.name, { color: colors.foreground }]}>{store.name}</Text>
            )}
            <View style={styles.statsRow}>
              <StarRating rating={store.avgRating || 0} size={14} />
              <Text style={[styles.reviewsCount, { color: colors.mutedForeground }]}>
                ({store.totalReviews} reviews)
              </Text>
            </View>
            {isEditing ? (
              <Input
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Location"
                style={styles.editInlineInput}
              />
            ) : (
              <Text style={[styles.location, { color: colors.mutedForeground }]}>
                <Feather name="map-pin" size={12} /> {store.location}
              </Text>
            )}
          </View>
        </View>

        {isEditing ? (
          <View style={styles.section}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Description</Text>
            <Input
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Tell customers about your store..."
              multiline
              style={styles.textArea}
            />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            <Input
              value={editCategory}
              onChangeText={setEditCategory}
              placeholder="e.g. Food & Drinks, Fashion..."
            />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone</Text>
            <Input
              value={editPhone}
              onChangeText={setEditPhone}
              placeholder="+234..."
              keyboardType="phone-pad"
            />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>CAC Registration Number (optional)</Text>
            <Input
              value={editCacNumber}
              onChangeText={setEditCacNumber}
              placeholder="e.g. RC-1234567"
              autoCapitalize="characters"
            />
            <Button
              title={updateStore.isPending ? 'Saving...' : 'Save Changes'}
              onPress={handleSave}
              disabled={updateStore.isPending}
              style={styles.saveBtn}
            />
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={[styles.description, { color: colors.foreground }]}>{store.description}</Text>
            {store.cacNumber ? (
              <View style={[styles.cacRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Feather name="shield" size={14} color={colors.primary} />
                <Text style={[styles.cacLabel, { color: colors.mutedForeground }]}>CAC Reg:</Text>
                <Text style={[styles.cacValue, { color: colors.foreground }]}>{store.cacNumber}</Text>
              </View>
            ) : null}
          </View>
        )}

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

        {!isEditing && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Reviews</Text>

            {store.verificationStatus !== 'verified' ? (
              <View style={[styles.unverifiedNotice, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="lock" size={16} color={colors.mutedForeground} />
                <Text style={[styles.unverifiedText, { color: colors.mutedForeground }]}>
                  Reviews are only available for verified stores.
                </Text>
              </View>
            ) : (
              <>
                {!isOwner && (
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
                      title={createReview.isPending ? 'Submitting...' : 'Submit Review'}
                      onPress={handleSubmitReview}
                      disabled={rating === 0 || createReview.isPending}
                    />
                  </View>
                )}

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
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 40 },
  banner: { height: 120, width: '100%' },
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBtn: {
    padding: 4,
  },
  editNameInput: {
    marginBottom: 4,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  editInlineInput: {
    marginTop: 4,
    fontSize: 14,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 4,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  saveBtn: {
    marginTop: 20,
  },
  unverifiedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  unverifiedText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    flex: 1,
  },
  cacRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  cacLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  cacValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
