import { StyleSheet, View, Text, ScrollView, RefreshControl, Image, Pressable } from 'react-native';
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

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = parseInt(id, 10);
  const colors = useColors();
  const { userId, userName } = useUserIdentity();

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

  const refreshing = productLoading || storeLoading;

  if ((productLoading || storeLoading) && !product) return <LoadingScreen message="Loading product..." />;
  if (!product) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: product.name }} />
      <ScrollView 
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchProduct} />}
      >
        {product.imageUrl ? (
          <Image source={{ uri: getImageUrl(product.imageUrl) }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.imageContainer, { backgroundColor: colors.muted }]}>
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
                  <Text style={[styles.storeName, { color: colors.foreground }]}>{store.name}</Text>
                  <Text style={[styles.storeLocation, { color: colors.mutedForeground }]}>{store.location}</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              </Pressable>
            </Link>
          )}
        </View>
      </ScrollView>

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
  storeName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
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
