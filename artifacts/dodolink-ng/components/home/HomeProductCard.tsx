import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { HomeProduct } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { ProductCard } from "@/components/ProductCard";
import { FollowButton } from "@/components/FollowButton";
import { getImageUrl } from "@/utils/storage";

export function HomeProductCard({ product, ownStoreIds }: { product: HomeProduct; ownStoreIds: Set<number> }) {
  const colors = useColors();
  const isOwn = ownStoreIds.has(product.storeId);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${product.storeName}`}
        onPress={() => router.push(`/store/${product.storeId}`)}
        style={styles.storeRow}
      >
        {product.storeImageUrl ? (
          <Image source={{ uri: getImageUrl(product.storeImageUrl) }} style={[styles.avatar, { backgroundColor: colors.muted }]} />
        ) : (
          <View style={[styles.avatar, styles.initial, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.initialText, { color: colors.secondaryForeground }]}>{product.storeName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.storeName, { color: colors.foreground }]}>{product.storeName}</Text>
          <Text style={[styles.tag, { color: product.isFollowing ? colors.primary : colors.accent }]}>
            {isOwn ? "Your store" : product.isFollowing ? "Following" : "Suggested"}
          </Text>
        </View>
      </Pressable>
      <ProductCard product={product} />
      {!isOwn && !product.isFollowing && (
        <View style={styles.follow}>
          <FollowButton storeId={product.storeId} isFollowing={false} compact returnTo="/" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  storeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  initial: { alignItems: "center", justifyContent: "center" },
  initialText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  storeName: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  tag: { fontFamily: "Inter_500Medium", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" },
  follow: { marginTop: -8, marginBottom: 16, alignItems: "flex-start" },
});
