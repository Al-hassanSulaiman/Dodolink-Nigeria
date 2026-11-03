import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { getImageUrl } from '@/utils/storage';
import { useFollowList, type FollowListKind, type FollowListItem, type FollowerItem, type FollowingItem } from '@/hooks/useFollowLists';

const TITLES: Record<FollowListKind, string> = {
  'store-followers': 'Followers',
  'store-following': 'Following',
  'my-following': 'Following',
};
const EMPTY: Record<FollowListKind, string> = {
  'store-followers': 'No followers yet.',
  'store-following': 'Not following any stores yet.',
  'my-following': "You aren't following any stores yet.",
};

function isFollowing(item: FollowListItem): item is FollowingItem {
  return 'id' in item;
}

export default function FollowListScreen() {
  const params = useLocalSearchParams<{ kind?: string; storeId?: string }>();
  const kind: FollowListKind = (['store-followers', 'store-following', 'my-following'] as const)
    .find(k => k === params.kind) ?? 'my-following';
  const storeId = Number.parseInt(String(params.storeId ?? ''), 10) || undefined;
  const colors = useColors();
  const { isSignedIn, isLoaded } = useAuth();
  const list = useFollowList(kind, storeId);
  const items = list.data?.pages.flatMap(page => page.items) ?? [];

  const header = <Stack.Screen options={{ title: TITLES[kind] }} />;

  if (isLoaded && !isSignedIn) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        {header}
        <Text style={[styles.message, { color: colors.foreground }]}>Sign in to see this list.</Text>
        <Button title="Sign in" onPress={() => router.push({ pathname: '/(auth)/sign-in', params: { returnTo: '/' } })} />
      </View>
    );
  }
  if (list.isLoading) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}>{header}<ActivityIndicator color={colors.primary} /></View>;
  }
  if (list.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        {header}
        <Text style={[styles.message, { color: colors.foreground }]}>Could not load this list.</Text>
        <Button title="Try again" onPress={() => list.refetch()} />
      </View>
    );
  }

  const open = (item: FollowListItem) => {
    const id = isFollowing(item) ? item.id : item.storeId;
    if (id) router.push({ pathname: '/store/[id]', params: { id: String(id) } });
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(item, index) => (isFollowing(item) ? `s${item.id}` : `u${index}`)}
        contentContainerStyle={items.length === 0 ? styles.flex : undefined}
        ListEmptyComponent={<EmptyState icon="users" title={EMPTY[kind]} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }}
        ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={colors.primary} /> : null}
        renderItem={({ item }) => {
          const name = item.name;
          const rawImage = item.imageUrl;
          // getImageUrl leaves full web addresses alone and resolves storage paths.
          const uri = rawImage ? getImageUrl(rawImage) : null;
          const tappable = isFollowing(item) || !!(item as FollowerItem).storeId;
          return (
            <Pressable
              onPress={() => open(item)}
              disabled={!tappable}
              accessibilityRole={tappable ? 'button' : undefined}
              accessibilityLabel={tappable ? `Open ${name}` : name}
              style={[styles.row, { borderBottomColor: colors.border }]}
            >
              {uri
                ? <Image source={{ uri }} style={styles.avatar} contentFit="cover" />
                : <View style={[styles.avatar, styles.initial, { backgroundColor: colors.muted }]}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold', fontSize: 18 }}>{name.charAt(0).toUpperCase()}</Text>
                  </View>}
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>{name}</Text>
                {isFollowing(item) && !!item.category && <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 13 }}>{item.category}</Text>}
              </View>
              {isFollowing(item) && item.verificationStatus === 'verified' && <Feather name="check-circle" size={16} color={colors.primary} />}
              {tappable && <Feather name="chevron-right" size={18} color={colors.mutedForeground} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  message: { fontSize: 16, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
