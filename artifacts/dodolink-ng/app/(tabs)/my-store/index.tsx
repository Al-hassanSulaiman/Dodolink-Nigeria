import { useCallback, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl, Image, Pressable } from 'react-native';
import { confirmAlert, showAlert } from '@/utils/alerts';
import { useAuth } from '@clerk/expo';
import * as WebBrowser from 'expo-web-browser';

const PRIVACY_URL = 'https://dodolink.com.ng/admin/privacy';
const TERMS_URL = 'https://dodolink.com.ng/admin/terms';
import { useListStores, useListStoreProducts, useDeleteProduct, getListProductsQueryKey, getListStoresQueryKey, getListStoreProductsQueryKey } from '@workspace/api-client-react';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { StoreAvatar } from '@/components/StoreAvatar';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { getImageUrl } from '@/utils/storage';
import { useQueryClient } from '@tanstack/react-query';
import { RequireAccount } from '@/components/RequireAccount';

function ProductThumb({ uri, name }: { uri: string | null; name: string }) {
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return <Image source={{ uri }} style={styles.productThumb} resizeMode="cover" onError={() => setErr(true)} />;
  }
  return <ImagePlaceholder name={name} size={52} borderRadius={8} />;
}

export default function MyStoreScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const { userId, isReady } = useUserIdentity();

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    await signOut();
    queryClient.clear();
    router.replace('/(tabs)');
  };
  const queryClient = useQueryClient();

  const { data: stores, isLoading, isError: storesError, refetch } = useListStores(
    { ownerUserId: userId ?? undefined },
    { query: { enabled: !!userId, queryKey: getListStoresQueryKey({ ownerUserId: userId ?? undefined }) } }
  );

  const myStore = stores?.find(s => s.ownerUserId === userId);

  const { data: products, isLoading: productsLoading, isError: productsError, refetch: refetchProducts } = useListStoreProducts(
    myStore?.id ?? 0,
    { query: { enabled: !!myStore?.id, queryKey: getListStoreProductsQueryKey(myStore?.id ?? 0) } }
  );

  // Tabs stay mounted: returning from Add/Edit isn't a browser window-focus event.
  useFocusEffect(useCallback(() => {
    if (userId) void refetch({ cancelRefetch: false });
    if (myStore?.id) void refetchProducts({ cancelRefetch: false });
  }, [userId, myStore?.id, refetch, refetchProducts]));

  const deleteProduct = useDeleteProduct({
    mutation: {
      onSuccess: () => {
        refetchProducts();
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      },
      onError: () => {
        showAlert('Delete failed', 'Could not delete the product. Please try again.');
      },
    }
  });

  const handleDeleteProduct = (productId: number, productName: string) => {
    confirmAlert({
      title: 'Delete Product',
      message: `Remove "${productName}" from your store? This cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
      onConfirm: () => deleteProduct.mutate({ productId }),
    });
  };

  const refreshing = isLoading || productsLoading;
  const onRefresh = () => {
    refetch();
    refetchProducts();
  };

  if (!userId) return <RequireAccount />;
  if (!isReady || (isLoading && !stores)) return <LoadingScreen message="Loading dashboard..." />;

  if (storesError) {
    return (
      <View style={StyleSheet.flatten([styles.container, { backgroundColor: colors.background }])}>
        <View style={StyleSheet.flatten([styles.header, { borderBottomColor: colors.border }])}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Store</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Feather name="wifi-off" size={48} color="#9CA3AF" />
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.foreground, marginTop: 16, textAlign: 'center' }}>
            Couldn't load your store
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.mutedForeground, marginTop: 8, textAlign: 'center' }}>
            Check your connection and try again.
          </Text>
          <Button title="Retry" onPress={() => refetch()} style={{ marginTop: 20 }} />
        </View>
      </View>
    );
  }

  if (!myStore) {
    return (
      <View style={StyleSheet.flatten([styles.container, { backgroundColor: colors.background }])}>
        <View style={StyleSheet.flatten([styles.header, { borderBottomColor: colors.border }])}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Store</Text>
          <Pressable onPress={handleSignOut} hitSlop={8} style={styles.signOutBtn}>
            <Feather name="log-out" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <EmptyState
          icon="shopping-bag"
          title="Start Selling on Dodolink"
          description="Create your store to reach customers across Nigeria. It's free and easy."
          action={<Button title="Create Store" onPress={() => router.push('/my-store/create')} />}
        />
        <View style={styles.legalRow}>
          <Pressable
            style={styles.privacyRow}
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
            hitSlop={8}
          >
            <Feather name="shield" size={14} color="#6B7280" />
            <Text style={styles.privacyText}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalSep}>·</Text>
          <Pressable
            style={styles.privacyRow}
            onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
            hitSlop={8}
          >
            <Feather name="file-text" size={14} color="#6B7280" />
            <Text style={styles.privacyText}>Terms of Service</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={StyleSheet.flatten([styles.container, { backgroundColor: colors.background }])}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={StyleSheet.flatten([styles.header, { borderBottomColor: colors.border }])}>
        <View style={styles.headerLeft}>
          <StoreAvatar store={myStore} size={44} editable />
          <Text style={[styles.title, { color: colors.foreground }]}>Dashboard</Text>
        </View>
        <Pressable onPress={handleSignOut} hitSlop={8} style={styles.signOutBtn}>
          <Feather name="log-out" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.content}>
        {/* Store info card */}
        <View style={StyleSheet.flatten([styles.card, { backgroundColor: colors.card, borderColor: colors.border }])}>
          <Text style={[styles.storeName, { color: colors.foreground }]}>{myStore.name}</Text>
          <Text style={[styles.storeDetails, { color: colors.mutedForeground }]}>
            {myStore.location} • {myStore.category}
          </Text>
          <View style={styles.actions}>
            <Button
              title="View Public Profile"
              variant="outline"
              onPress={() => router.push(`/store/${myStore.id}`)}
            />
          </View>
        </View>

        {/* Subscription card */}
        <Pressable
          style={StyleSheet.flatten([styles.card, styles.subCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }])}
          onPress={() => router.push('/my-store/subscription')}
        >
          <View style={styles.subCardLeft}>
            <Feather name="credit-card" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.subCardTitle, { color: colors.foreground }]}>Subscription</Text>
              <Text style={[styles.subCardBody, { color: colors.mutedForeground }]}>
                {myStore.subscriptionStatus === 'active'
                  ? 'Active — renews in 30 days'
                  : myStore.subscriptionStatus === 'past_due'
                  ? '⚠️ Payment overdue'
                  : 'Manage your subscription plan'}
              </Text>
            </View>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>

        {/* Products section */}
        <View style={StyleSheet.flatten([styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }])}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Products</Text>
            <Pressable
              style={StyleSheet.flatten([styles.addBtn, { backgroundColor: colors.primary }])}
              onPress={() => router.push({ pathname: '/my-store/add-product', params: { storeId: myStore.id } })}
            >
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>

          {productsLoading ? (
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading products…</Text>
          ) : productsError && !products ? (
            <View style={{ padding: 16, gap: 12 }}>
              <Text style={{ color: colors.foreground }}>Couldn't load your products. Please try again.</Text>
              <Button title="Retry products" onPress={() => refetchProducts()} />
            </View>
          ) : !products || products.length === 0 ? (
            <EmptyState
              icon="box"
              title="No products yet"
              description="Add your first product to start selling."
            />
          ) : (
            products.map(product => {
              const thumbnail = product.imageUrls && product.imageUrls[0]
                ? getImageUrl(product.imageUrls[0])
                : product.imageUrl ? getImageUrl(product.imageUrl) : null;

              return (
                <View
                  key={product.id}
                  style={StyleSheet.flatten([styles.productRow, { borderBottomColor: colors.border }])}
                >
                  <ProductThumb uri={thumbnail} name={product.name} />

                  <View style={styles.productInfo}>
                    <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text style={[styles.productPrice, { color: colors.primary }]}>
                      ₦{product.price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                    </Text>
                    <View style={StyleSheet.flatten([
                      styles.stockBadge,
                      { backgroundColor: product.inStock ? colors.primary + '22' : colors.muted }
                    ])}>
                      <Text style={[
                        styles.stockText,
                        { color: product.inStock ? colors.primary : colors.mutedForeground }
                      ]}>
                        {product.inStock ? 'In Stock' : 'Sold Out'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.productActions}>
                    <Pressable
                      style={StyleSheet.flatten([styles.iconBtn, { backgroundColor: colors.muted }])}
                      onPress={() => router.push({
                        pathname: '/my-store/edit-product',
                        params: { productId: product.id }
                      })}
                      hitSlop={8}
                    >
                      <Feather name="edit-2" size={15} color={colors.foreground} />
                    </Pressable>
                    <Pressable
                      style={StyleSheet.flatten([styles.iconBtn, { backgroundColor: colors.destructive + '22', marginTop: 6 }])}
                      onPress={() => handleDeleteProduct(product.id, product.name)}
                      hitSlop={8}
                    >
                      <Feather name="trash-2" size={15} color={colors.destructive} />
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.legalRow}>
          <Pressable
            style={styles.privacyRow}
            onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)}
            hitSlop={8}
          >
            <Feather name="shield" size={14} color="#6B7280" />
            <Text style={styles.privacyText}>Privacy Policy</Text>
          </Pressable>
          <Text style={styles.legalSep}>·</Text>
          <Pressable
            style={styles.privacyRow}
            onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)}
            hitSlop={8}
          >
            <Feather name="file-text" size={14} color="#6B7280" />
            <Text style={styles.privacyText}>Terms of Service</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  signOutBtn: {
    padding: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  storeName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    marginBottom: 4,
  },
  storeDetails: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#fff',
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  productThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  productPrice: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    marginBottom: 4,
  },
  stockBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stockText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  productActions: {
    alignItems: 'center',
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  subCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  subCardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 2,
  },
  subCardBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: 8,
    marginTop: 8,
  },
  legalSep: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#6B7280',
    marginHorizontal: 4,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  privacyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#6B7280',
    textDecorationLine: 'underline',
  },
});
