import { useMemo, useState } from "react";
import { useListStores, useListSupportMessages, getListSupportMessagesQueryKey, getListStoresQueryKey } from "@workspace/api-client-react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { type Href, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useActiveScreen } from "@/hooks/useActiveScreen";
import { getUnreadSupportMessageIds } from "@/utils/supportUnread";
import { useHomeFeed } from "@/hooks/useHomeFeed";
import { StoreRail } from "@/components/home/StoreRail";
import { HomeProductCard } from "@/components/home/HomeProductCard";
import { EmptyState } from "@/components/EmptyState";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn, userId } = useAuth();
  const active = useActiveScreen();
  const router = useRouter();
  const feed = useHomeFeed();
  const { stores, products, storeItems, productItems } = feed;
  const [pulling, setPulling] = useState(false);

  const { data: supportMessages, refetch: refetchSupport } = useListSupportMessages({
    query: {
      queryKey: [...getListSupportMessagesQueryKey(), userId ?? null],
      enabled: !!userId && active,
      refetchInterval: active ? 15000 : false,
      refetchIntervalInBackground: false,
      staleTime: 0,
    },
  });
  const supportUnread = userId ? getUnreadSupportMessageIds(supportMessages ?? []).length : 0;

  const { data: myStores } = useListStores({ ownerUserId: userId ?? "" }, {
    query: { enabled: !!userId, queryKey: getListStoresQueryKey({ ownerUserId: userId ?? "" }) },
  });
  const ownStoreIds = useMemo(() => new Set((myStores ?? []).map((s) => s.id)), [myStores]);
  const followsSomeone = storeItems.some((s) => s.isFollowing);

  const onRefresh = () => {
    setPulling(true);
    feed.refresh();
    if (userId) refetchSupport();
    setTimeout(() => setPulling(false), 600);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top + 8;

  const header = (
    <View>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.primary }]}>Dodolink NG</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your stores, their latest</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh feed" onPress={onRefresh} style={styles.iconBtn} testID="home-refresh">
            <Feather name="refresh-cw" size={19} color={colors.mutedForeground} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={supportUnread > 0 ? `Contact support, ${supportUnread} unread ${supportUnread === 1 ? "reply" : "replies"}` : "Contact support"} onPress={() => router.push("/support" as Href)} style={styles.iconBtn}>
            <Feather name="help-circle" size={20} color={colors.mutedForeground} />
            {supportUnread > 0 && (
              <View style={[styles.unread, { backgroundColor: colors.destructive }]}>
                <Text accessibilityLiveRegion="polite" style={[styles.unreadText, { color: colors.primaryForeground }]}>{supportUnread > 99 ? "99+" : supportUnread}</Text>
              </View>
            )}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={isSignedIn ? "Account settings" : "Sign in"} onPress={() => router.push(isSignedIn ? "/account" : "/(auth)/sign-in")} style={styles.iconBtn}>
            <Feather name={isSignedIn ? "settings" : "log-in"} size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <StoreRail
        stores={storeItems}
        isLoading={stores.isLoading}
        isError={stores.isError}
        hasNextPage={!!stores.hasNextPage}
        isFetchingNextPage={stores.isFetchingNextPage}
        isNextPageError={stores.isFetchNextPageError}
        onLoadMore={() => stores.fetchNextPage()}
        onRetry={() => stores.refetch()}
      />

      {!stores.isLoading && !followsSomeone && (
        <View style={[styles.nudge, { backgroundColor: colors.secondary }]}>
          <Feather name="user-plus" size={18} color={colors.secondaryForeground} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.nudgeTitle, { color: colors.secondaryForeground }]}>
              {isSignedIn ? "Follow the shops you buy from" : "Sign in to follow your favourite shops"}
            </Text>
            <Text style={[styles.nudgeBody, { color: colors.secondaryForeground }]}>
              Their new products will show up first. Meanwhile, here are popular stores across Nigeria.
            </Text>
          </View>
          {!isSignedIn && (
            <Pressable accessibilityRole="button" onPress={() => router.push("/(auth)/sign-in")} style={[styles.nudgeBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.nudgeBtnText, { color: colors.primaryForeground }]}>Sign in</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{followsSomeone ? "From stores you follow" : "Discover"}</Text>
        <Pressable onPress={() => router.push("/search")} accessibilityRole="link">
          <Text style={[styles.seeAll, { color: colors.primary }]}>Search</Text>
        </Pressable>
      </View>
      {products.isError && productItems.length === 0 && (
        <View style={styles.pad}>
          <Text accessibilityRole="alert" style={[styles.subtitle, { color: colors.foreground }]}>Couldn't load products. Check your connection.</Text>
          <Pressable onPress={() => products.refetch()} style={[styles.retry, { backgroundColor: colors.primary }]}>
            <Text style={[styles.nudgeBtnText, { color: colors.primaryForeground }]}>Try again</Text>
          </Pressable>
        </View>
      )}
      {products.isLoading && (
        <View style={styles.skelGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i} style={styles.gridItem}><View style={[styles.skelCard, { backgroundColor: colors.muted }]} /></View>
          ))}
        </View>
      )}
    </View>
  );

  const footer = productItems.length === 0 ? (
    !products.isLoading && !products.isError ? (
      <EmptyState title="No products yet" description="Check back soon for new arrivals." icon="box" />
    ) : null
  ) : (
    <View style={styles.footer}>
      {products.isFetchingNextPage ? (
        <ActivityIndicator color={colors.primary} />
      ) : products.isFetchNextPageError ? (
        <Pressable accessibilityRole="button" onPress={() => products.fetchNextPage()} style={[styles.loadMore, { borderColor: colors.destructive }]}>
          <Text style={[styles.seeAll, { color: colors.destructive }]}>Couldn't load more. Retry</Text>
        </Pressable>
      ) : products.hasNextPage ? (
        <Pressable accessibilityRole="button" onPress={() => products.fetchNextPage()} style={[styles.loadMore, { borderColor: colors.border }]}>
          <Text style={[styles.seeAll, { color: colors.primary }]}>Load more products</Text>
        </Pressable>
      ) : (
        <Text style={[styles.endText, { color: colors.mutedForeground }]}>You're all caught up. Pull or tap refresh for a new mix.</Text>
      )}
    </View>
  );

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 134 : 100 }}
      data={productItems}
      numColumns={2}
      keyExtractor={(p) => String(p.id)}
      columnWrapperStyle={styles.column}
      renderItem={({ item }) => (
        <View style={styles.gridItem}><HomeProductCard product={item} ownStoreIds={ownStoreIds} /></View>
      )}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      onEndReached={() => { if (products.hasNextPage && !products.isFetchingNextPage && !products.isFetchNextPageError) products.fetchNextPage(); }}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.primary} />}
    />
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, marginBottom: 14 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  unread: { position: "absolute", top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: 11, fontWeight: "700" },
  title: { fontFamily: "Inter_700Bold", fontSize: 26 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 2 },
  nudge: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 16, marginTop: 14, padding: 14, borderRadius: 14 },
  nudgeTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  nudgeBody: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2, lineHeight: 17 },
  nudgeBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  nudgeBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginVertical: 16 },
  sectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 19 },
  seeAll: { fontFamily: "Inter_500Medium", fontSize: 14 },
  column: { paddingHorizontal: 8 },
  gridItem: { width: "50%", paddingHorizontal: 8 },
  skelGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 },
  skelCard: { height: 220, borderRadius: 12, marginBottom: 16 },
  pad: { paddingHorizontal: 16, gap: 12, marginBottom: 16 },
  retry: { alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20 },
  footer: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 16 },
  loadMore: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 22, borderWidth: 1.5 },
  endText: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" },
});
