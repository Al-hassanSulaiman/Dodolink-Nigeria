import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/expo';
import { customFetch } from '@workspace/api-client-react';
import { RequireAccount } from '@/components/RequireAccount';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { showAlert } from '@/utils/alerts';

interface BlockedUser { userId: string; name: string }

/** People you blocked. Unblocking brings their stores and chats back. */
export default function BlockedUsersScreen() {
  const colors = useColors();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery<BlockedUser[]>({
    queryKey: ['blocked-users', userId ?? 'anonymous'],
    queryFn: ({ signal }) => customFetch<BlockedUser[]>('/api/blocks', { method: 'GET', signal }),
    enabled: !!userId,
  });

  const unblock = async (id: string) => {
    setBusyId(id);
    try {
      await customFetch(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await queryClient.invalidateQueries();
    } catch {
      showAlert('Could not unblock', 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const content = (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Blocked users' }} />
      {isLoading ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> :
        isError ? <EmptyState icon="alert-circle" title="Could not load" description="Check your connection and try again." /> :
        <FlatList
          data={data ?? []}
          keyExtractor={item => item.userId}
          onRefresh={refetch}
          refreshing={false}
          ListEmptyComponent={<EmptyState icon="slash" title="Nobody blocked" description="People you block will show up here." />}
          renderItem={({ item }) => (
            <View style={[styles.row, { borderColor: colors.border }]}>
              <Text style={{ flex: 1, color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 16 }} numberOfLines={1}>{item.name}</Text>
              <Button title={busyId === item.userId ? '…' : 'Unblock'} variant="outline" disabled={busyId === item.userId} onPress={() => unblock(item.userId)} />
            </View>
          )}
        />}
    </View>
  );
  return <RequireAccount>{content}</RequireAccount>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});
