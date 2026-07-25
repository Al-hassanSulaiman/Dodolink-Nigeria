import { useState, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, Image, Pressable, Dimensions } from 'react-native';
import { useLocalSearchParams, Link, Stack } from 'expo-router';
import { 
  useGetProduct, 
  useGetStore, 
  useStartConversation,
  getGetProductQueryKey,
  getGetStoreQueryKey,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { getImageUrl } from '@/utils/storage';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = parseInt(id, 10);
  const colors = useColors();
  const { userId, userName } = useUserIdentity();
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const { data: product, isLoading: productLoading, refetch: refetchProduct } = useGetProduct(productId, {
    query: { enabled: !!productId, queryKey: getGetProductQueryKey(productId) }
  });

  const { data: store, isLoading: storeLoading } = useGetStore(product?.storeId || 0, {
    query: { enabled: !!product?.storeId, queryKey: getGetStoreQueryKey(product?.storeId || 0) }
  });

  const startConversation = useStartConversation({
    mutation: {
      onSuccess: (data) => {
        router.push(`/chat/${data.id}`);
      }
    }
  });

  const handleChat = () => {
    if (!product || !userId || !userName) return;
    startConversation.mutate({ data: {
      customerId: userId,
      customerName: userName,
      storeId: product.storeId,
      initialMessage: `Hi, I'm interested in ${product.name}.`
    }});
  };

  const handleScroll = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / SCREEN_WIDTH);
    setActiveImageIndex(index);
  };

  const isOwner = !!userId && !!store && store.ownerUserId === userId;
  const refreshing = productLoading || storeLoading;

  if ((productLoading || storeLoading) && !product) return <LoadingScreen message="Loading product..." />;
  if (!product) return null;

  // Build image list: prefer imageUrls array, fall back to single imageUrl
  const images: string[] =
    product.imageUrls && product.imageUrls.length > 0
      ? product.imageUrls
      : product.imageUrl
      ? [product.imageUrl]
      : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: product.name }} />
      <ScrollView 
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchProduct} />}
      >
        {/* Image gallery */}
        {images.length > 0 ? (
          <View style={styles.galleryContainer}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
            >
              {images.map((img, index) => (
                <Image
                  key={index}
                  source={{ uri: getImageUrl(img) }}
                  style={[styles.galleryImage, { width: SCREEN_WIDTH }]}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
            {/* Dot indicators — only show when there are multiple images */}
            {images.length > 1 && (
              <View style={styles.dotsContainer}>
                {images.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i === activeImageIndex ? colors.foreground : colors.mutedForeground },
                      i === activeImageIndex && styles.dotActive,
                    ]}
                  />
                ))}
              </View>
            )}
            {/* Image counter badge */}
            {images.length > 1 && (
              <View style={[styles.counterBadge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
                <Text style={styles.counterText}>
                  {activeImageIndex + 1} / {images.length}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: colors.muted }]}>
            <ImagePlaceholder name={product.name} size={120} borderRadius={0} />
          </View>
        )}

        <View style={styles.details}>
          <Text style={[styles.category, { color: colors.mutedForeground }]}>{product.category}</Text>
          <Text style={[styles.name, { color: colors.foreground }]}>{product.name}</Text>
          <Text style={[styles.price, { color: colors.primary }]}>
            ₦{product.price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
          </Text>
          
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Description</Text>
          <Text style={[styles.description, { color: colors.foreground }]}>{product.description}</Text>

          {store && (
            <Link href={`/store/${store.id}`} asChild>
              <Pressable style={StyleSheet.flatten([styles.storeCard, { backgroundColor: colors.card, borderColor: colors.border }])}>
                {store.imageUrl ? (
                  <Image source={{ uri: getImageUrl(store.imageUrl) }} style={styles.storeImage} />
                ) : (
                  <ImagePlaceholder name={store.name} size={40} borderRadius={20} />
                )}
                <View style={styles.storeInfo}>
                  <View style={styles.storeNameRow}>
                    <Text style={[styles.storeName, { color: colors.foreground }]}>{store.name}</Text>
                    {store.verificationStatus === 'verified' && (
                      <View style={[styles.verifiedBadge, { backgroundColor: colors.primary }]}>
                        <Feather name="check-circle" size={10} color="#fff" />
                        <Text style={styles.verifiedBadgeText}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.storeLocation, { color: colors.mutedForeground }]}>{store.location}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              </Pressable>
            </Link>
          )}
        </View>
      </ScrollView>

      {!isOwner && (
        <View style={[styles.bottomBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <Pressable 
            style={[styles.chatButton, { backgroundColor: colors.primary }]}
            onPress={handleChat}
            disabled={startConversation.isPending}
          >
            <Feather name="message-circle" size={20} color={colors.primaryForeground} style={styles.chatIcon} />
            <Text style={[styles.chatButtonText, { color: colors.primaryForeground }]}>
              {startConversation.isPending ? 'Starting chat...' : 'Chat with Seller'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 100,
  },
  galleryContainer: {
    position: 'relative',
  },
  galleryImage: {
    aspectRatio: 1,
  },
  imagePlaceholder: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.5,
  },
  dotActive: {
    opacity: 1,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  counterBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  details: {
    padding: 16,
  },
  category: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  name: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    marginBottom: 8,
  },
  price: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    marginBottom: 8,
  },
  description: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 32,
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  storeImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  storeInfo: {
    flex: 1,
    marginLeft: 12,
  },
  storeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  storeName: {
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
  verifiedBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#fff',
  },
  storeLocation: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  chatButton: {
    flexDirection: 'row',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatIcon: {
    marginRight: 8,
  },
  chatButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
});
