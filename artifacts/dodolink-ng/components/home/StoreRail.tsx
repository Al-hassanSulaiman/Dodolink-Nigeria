import { useRef } from "react";
import type { PointerEvent } from "react";
import { ActivityIndicator, FlatList, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import type { HomeStore } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { getImageUrl } from "@/utils/storage";

const SIZE = 72;

export function truncateName(name: string, max = 11) {
  return name.length > max ? `${name.slice(0, max)}..` : name;
}

function Circle({ store, shouldSuppress }: { store: HomeStore; shouldSuppress: () => boolean }) {
  const colors = useColors();
  const ring = store.isFollowing ? colors.primary : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${store.name}, ${store.isFollowing ? "following" : "suggested store"}`}
      onPress={() => { if (!shouldSuppress()) router.push(`/store/${store.id}`); }}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.ring, { borderColor: ring }]}>
        {store.imageUrl ? (
          <Image source={{ uri: getImageUrl(store.imageUrl) }} style={[styles.img, { backgroundColor: colors.muted }]} />
        ) : (
          <View style={[styles.img, styles.initial, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.initialText, { color: colors.secondaryForeground }]}>{store.name.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {!store.isFollowing && (
          <View style={[styles.badge, { backgroundColor: colors.foreground, borderColor: colors.background }]}>
            <Feather name="user-plus" size={11} color={colors.background} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>{truncateName(store.name)}</Text>
    </Pressable>
  );
}

interface Props {
  stores: HomeStore[];
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isNextPageError: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
}

export function StoreRail({ stores, isLoading, isError, hasNextPage, isFetchingNextPage, isNextPageError, onLoadMore, onRetry }: Props) {
  const colors = useColors();
  const listRef = useRef<FlatList<HomeStore>>(null);
  const offset = useRef(0);
  const pointer = useRef({ id: -1, x: 0, start: 0, dragging: false, suppressUntil: 0 });
  const shouldSuppress = () => Date.now() < pointer.current.suppressUntil;

  // Web mouse dragging via explicit DOM pointer tracking (RN-web PanResponder misses drags
  // over nested Pressables/images). Touch pointers keep native horizontal scrolling.
  const webDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !e.isPrimary || e.button !== 0) return;
    pointer.current = { id: e.pointerId, x: e.clientX, start: offset.current, dragging: false, suppressUntil: 0 };
  };
  const webMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (p.id !== e.pointerId) return;
    const dx = e.clientX - p.x;
    if (!p.dragging && Math.abs(dx) > 6) {
      p.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (p.dragging) {
      e.preventDefault();
      listRef.current?.scrollToOffset({ offset: Math.max(0, p.start - dx), animated: false });
    }
  };
  const webEnd = (e: PointerEvent<HTMLDivElement>) => {
    const p = pointer.current;
    if (p.id !== e.pointerId) return;
    if (p.dragging) p.suppressUntil = Date.now() + 400;
    p.id = -1;
    p.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (isLoading && stores.length === 0) {
    return (
      <View style={styles.row}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={styles.item}>
            <View style={[styles.skelCircle, { backgroundColor: colors.muted }]} />
            <View style={[styles.skelLine, { backgroundColor: colors.muted }]} />
          </View>
        ))}
      </View>
    );
  }

  if (isError && stores.length === 0) {
    return (
      <Pressable onPress={onRetry} accessibilityRole="button" style={[styles.errorBox, { borderColor: colors.border }]}>
        <Feather name="alert-triangle" size={16} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>Couldn't load stores. Tap to retry.</Text>
      </Pressable>
    );
  }

  if (stores.length === 0) {
    return <Text style={[styles.errorText, { color: colors.mutedForeground, paddingHorizontal: 16 }]}>No stores to show yet.</Text>;
  }

  const footer = (
    <View style={styles.item}>
      {isFetchingNextPage ? (
        <View style={[styles.more, { borderColor: colors.border }]}><ActivityIndicator color={colors.primary} /></View>
      ) : hasNextPage || isNextPageError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isNextPageError ? "Retry loading more stores" : "Load more stores"}
          onPress={onLoadMore}
          style={({ pressed }) => [styles.more, { borderColor: isNextPageError ? colors.destructive : colors.border }, pressed && { opacity: 0.6 }]}
        >
          <Feather name={isNextPageError ? "rotate-cw" : "chevrons-right"} size={22} color={isNextPageError ? colors.destructive : colors.primary} />
        </Pressable>
      ) : (
        <View style={[styles.more, { borderColor: colors.border, borderStyle: "dashed" }]}>
          <Feather name="check" size={18} color={colors.mutedForeground} />
        </View>
      )}
      <Text numberOfLines={1} style={[styles.name, { color: colors.mutedForeground }]}>
        {isFetchingNextPage ? "Loading" : isNextPageError ? "Retry" : hasNextPage ? "More" : "All caught up"}
      </Text>
    </View>
  );

  const list = (
      <FlatList
        ref={listRef}
        horizontal
        data={stores}
        keyExtractor={(s) => String(s.id)}
        renderItem={({ item }) => <Circle store={item} shouldSuppress={shouldSuppress} />}
        showsHorizontalScrollIndicator={Platform.OS === "web"}
        contentContainerStyle={styles.row}
        onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.x; }}
        scrollEventThrottle={16}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage && !isNextPageError) onLoadMore(); }}
        onEndReachedThreshold={0.6}
        ListFooterComponent={footer}
      />
  );

  if (Platform.OS !== "web") return list;
  return (
    <div
      style={{ touchAction: "pan-x pan-y", userSelect: "none", cursor: "grab" }}
      onPointerDownCapture={webDown}
      onPointerMoveCapture={webMove}
      onPointerUpCapture={webEnd}
      onPointerCancel={webEnd}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => { if (shouldSuppress()) { e.preventDefault(); e.stopPropagation(); } }}
    >
      {list}
    </div>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", paddingHorizontal: 12, gap: 6, paddingVertical: 4 },
  item: { width: SIZE + 14, alignItems: "center" },
  ring: { width: SIZE + 8, height: SIZE + 8, borderRadius: (SIZE + 8) / 2, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
  img: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  initial: { alignItems: "center", justifyContent: "center" },
  initialText: { fontFamily: "Inter_700Bold", fontSize: 26 },
  badge: { position: "absolute", bottom: -2, right: 2, width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: "Inter_500Medium", fontSize: 12, marginTop: 6, maxWidth: SIZE + 12 },
  more: { width: SIZE + 8, height: SIZE + 8, borderRadius: (SIZE + 8) / 2, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  skelCircle: { width: SIZE + 8, height: SIZE + 8, borderRadius: (SIZE + 8) / 2 },
  skelLine: { width: 50, height: 10, borderRadius: 5, marginTop: 8 },
  errorBox: { marginHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderWidth: 1, borderRadius: 12 },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 14 },
});
