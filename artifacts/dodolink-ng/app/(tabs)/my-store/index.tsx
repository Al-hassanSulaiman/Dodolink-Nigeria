import { useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, RefreshControl } from 'react-native';
import { useListStores } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui';
import { router } from 'expo-router';

export default function MyStoreScreen() {
  const colors = useColors();
  const { userId, isReady } = useUserIdentity();

  // Find stores owned by this user
  // The API doesn't have a direct /users/:id/stores endpoint, so we filter listStores
  const { data: stores, isLoading, refetch } = useListStores({}, {
    query: { enabled: !!userId }
  });

  const myStore = stores?.find(s => s.ownerUserId === userId);

  if (!isReady || isLoading) return <LoadingScreen message="Loading dashboard..." />;

  if (!myStore) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Store</Text>
        </View>
        <EmptyState 
          icon="shopping-bag" 
          title="Start Selling on Dodolink" 
          description="Create your store to reach customers across Nigeria. It's free and easy."
          action={
            <Button 
              title="Create Store" 
              onPress={() => router.push('/my-store/create')} 
            />
          }
        />
      </View>
    );
  }

  // If user has a store, show dashboard.
  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Dashboard</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.storeName, { color: colors.foreground }]}>{myStore.name}</Text>
          <Text style={[styles.storeDetails, { color: colors.mutedForeground }]}>{myStore.location} • {myStore.category}</Text>
          <View style={styles.actions}>
            <Button 
              title="View Public Profile" 
              variant="outline" 
              onPress={() => router.push(`/store/${myStore.id}`)} 
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 16 }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Manage Products</Text>
          <Button 
            title="Add New Product" 
            onPress={() => router.push({ pathname: '/my-store/add-product', params: { storeId: myStore.id } })} 
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  content: {
    padding: 16,
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
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    marginBottom: 16,
  },
});
