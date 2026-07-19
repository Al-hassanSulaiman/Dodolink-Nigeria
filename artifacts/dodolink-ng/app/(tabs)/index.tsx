import { useListProducts, useListStores } from "@workspace/api-client-react";
import { StyleSheet, View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { ProductCard } from "@/components/ProductCard";
import { StoreCard } from "@/components/StoreCard";
import { LoadingScreen } from "@/components/Loading";
import { EmptyState } from "@/components/EmptyState";
import { type Href, Link, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";

export default function HomeScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const router = useRouter();
  const { data: products, isLoading: isLoadingProducts, refetch: refetchProducts } = useListProducts({ limit: 6 });
  const { data: stores, isLoading: isLoadingStores, refetch: refetchStores } = useListStores({ limit: 3 });

  const refreshing = isLoadingProducts || isLoadingStores;
  const onRefresh = () => {
    refetchProducts();
    refetchStores();
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/(auth)/sign-in" as Href);
  };

  if (isLoadingProducts && !products) {
    return <LoadingScreen message="Loading Dodolink..." />;
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.primary }]}>Dodolink NG</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Connecting Nigerian businesses to customers</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push("/support" as Href)} hitSlop={8} style={styles.signOutBtn}>
            <Feather name="help-circle" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={handleSignOut} hitSlop={8} style={styles.signOutBtn}>
            <Feather name="log-out" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Featured Products</Text>
          <Link href="/search" style={StyleSheet.flatten([styles.seeAll, { color: colors.primary }])}>See All</Link>
        </View>

        {products && products.length > 0 ? (
          <View style={styles.grid}>
            {products.map(product => (
              <View key={product.id} style={styles.gridItem}>
                <ProductCard product={product} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState title="No products yet" description="Check back later for new arrivals." icon="box" />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Top Stores</Text>
        </View>

        {stores && stores.length > 0 ? (
          stores.map(store => (
            <StoreCard key={store.id} store={store} />
          ))
        ) : (
          <EmptyState title="No stores found" description="Be the first to create a store." icon="shopping-bag" />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  headerLeft: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signOutBtn: {
    paddingTop: 4,
    paddingLeft: 8,
  },
  title: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
  },
  seeAll: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
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
});
