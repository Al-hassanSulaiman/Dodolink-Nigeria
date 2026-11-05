import { useState } from 'react';
import { StyleSheet, View, Text, FlatList, Pressable, Image, Modal, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { useActiveScreen } from '@/hooks/useActiveScreen';
import { LoadingScreen } from '@/components/Loading';
import { EmptyState } from '@/components/EmptyState';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { RequireAccount } from '@/components/RequireAccount';
import { getImageUrl } from '@/utils/storage';
import { showAlert } from '@/utils/alerts';
import {
  useDeliveryAgents, useDeliveryInbox, useDeliveryStates, useMyDeliveryCompany, coverageLine, deliveryTypeLabel, ratingLine,
  type DeliveryAgent,
} from '@/hooks/useDelivery';

type TypeFilter = '' | 'intrastate' | 'interstate';

function TypeBadge({ agent }: { agent: DeliveryAgent }) {
  const colors = useColors();
  return (
    <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
      <Text style={[styles.badgeText, { color: colors.secondaryForeground }]}>{deliveryTypeLabel[agent.deliveryType]}</Text>
    </View>
  );
}

export default function DeliveryScreen() {
  const colors = useColors();
  const { userId } = useUserIdentity();
  const active = useActiveScreen();
  const queryClient = useQueryClient();
  const [type, setType] = useState<TypeFilter>('');
  const [state, setState] = useState('');
  const [pickingState, setPickingState] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);

  const agents = useDeliveryAgents(type, state);
  const states = useDeliveryStates();
  const inbox = useDeliveryInbox(active ? 10000 : false);
  const myCompany = useMyDeliveryCompany();

  if (!userId) return <RequireAccount />;

  const openChat = async (agent: DeliveryAgent) => {
    if (opening !== null) return;
    setOpening(agent.id);
    try {
      const conv = await customFetch<{ id: number }>('/api/delivery/conversations/start', {
        method: 'POST', body: JSON.stringify({ agentId: agent.id }),
      });
      router.push(`/delivery-chat/${conv.id}` as never);
    } catch (err) {
      const message = (err as { data?: { error?: string } })?.data?.error ?? 'Could not open this chat. Please try again.';
      showAlert('Delivery', message);
    } finally {
      setOpening(null);
    }
  };

  const chips: Array<{ key: TypeFilter; label: string }> = [
    { key: '', label: 'All' }, { key: 'intrastate', label: 'Intrastate' }, { key: 'interstate', label: 'Interstate' },
  ];
  const myChats = inbox.data ?? [];

  const header = (
    <View>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Delivery</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Chat with a delivery company to move your goods.</Text>
      </View>

      {myCompany.data ? (
        <Pressable onPress={() => router.push('/delivery-subscription' as never)} style={[styles.subCard, { backgroundColor: colors.secondary }]}>
          <Feather name="credit-card" size={18} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.secondaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>
            {myCompany.data.name}: your subscription
          </Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}

      {myChats.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your delivery chats</Text>
          {myChats.map(chat => (
            <Pressable key={chat.id} onPress={() => router.push(`/delivery-chat/${chat.id}` as never)} style={[styles.row, { borderBottomColor: colors.border }]}>
              {chat.imageUrl
                ? <Image source={{ uri: getImageUrl(chat.imageUrl) }} style={[styles.avatar, { backgroundColor: colors.muted }]} />
                : <ImagePlaceholder name={chat.title} size={44} borderRadius={22} />}
              <View style={styles.rowInfo}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
                  {chat.title}{chat.role === 'agent' ? '  (customer)' : ''}
                </Text>
                {chat.lastMessage ? (
                  <Text style={{ color: chat.unread > 0 ? colors.foreground : colors.mutedForeground, fontFamily: chat.unread > 0 ? 'Inter_600SemiBold' : 'Inter_400Regular', fontSize: 14 }} numberOfLines={1}>
                    {chat.lastMessage}
                  </Text>
                ) : null}
              </View>
              {chat.unread > 0 ? (
                <View style={[styles.unread, { backgroundColor: colors.primary }]}>
                  <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_700Bold', fontSize: 12 }}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
                </View>
              ) : <Feather name="chevron-right" size={20} color={colors.mutedForeground} />}
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Delivery companies</Text>
        <View style={styles.chipRow}>
          {chips.map(chip => {
            const selected = type === chip.key;
            return (
              <Pressable key={chip.key} onPress={() => setType(chip.key)} style={[styles.chip, { backgroundColor: selected ? colors.primary : colors.secondary }]}>
                <Text style={{ color: selected ? colors.primaryForeground : colors.secondaryForeground, fontFamily: 'Inter_500Medium', fontSize: 13 }}>{chip.label}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setPickingState(true)} style={[styles.chip, { backgroundColor: state ? colors.primary : colors.secondary }]}>
            <Text style={{ color: state ? colors.primaryForeground : colors.secondaryForeground, fontFamily: 'Inter_500Medium', fontSize: 13 }}>
              {state || 'Any state'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  if (agents.isLoading && !agents.data) return <LoadingScreen message="Loading delivery companies..." />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={agents.data ?? []}
        keyExtractor={a => a.id.toString()}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          agents.isError ? (
            <EmptyState icon="alert-circle" title="Could not load" description="Check your connection and pull to try again." />
          ) : (
            <EmptyState icon="truck" title="No delivery companies yet" description={type || state ? 'None match this filter. Try another.' : 'Delivery companies will appear here soon.'} />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openChat(item)} style={[styles.row, styles.agentRow, { borderBottomColor: colors.border }]}>
            {item.imageUrl
              ? <Image source={{ uri: getImageUrl(item.imageUrl) }} style={[styles.avatar, { backgroundColor: colors.muted }]} />
              : <ImagePlaceholder name={item.name} size={44} borderRadius={22} />}
            <View style={styles.rowInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <TypeBadge agent={item} />
              </View>
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>{ratingLine(item)}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13 }} numberOfLines={2}>
                Delivers: {coverageLine(item) || 'Ask in chat'}
              </Text>
              {item.bio ? <Text style={{ color: colors.mutedForeground, fontSize: 13 }} numberOfLines={2}>{item.bio}</Text> : null}
            </View>
            {opening === item.id ? <ActivityIndicator /> : <Feather name="message-circle" size={22} color={colors.primary} />}
          </Pressable>
        )}
      />

      <Modal visible={pickingState} animationType="slide" onRequestClose={() => setPickingState(false)}>
        <View style={[styles.container, { backgroundColor: colors.background, paddingTop: 56 }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Choose a state</Text>
            <Pressable onPress={() => setPickingState(false)} hitSlop={12}><Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 16 }}>Close</Text></Pressable>
          </View>
          <FlatList
            data={['', ...(states.data ?? [])]}
            keyExtractor={s => s || 'any'}
            renderItem={({ item }) => (
              <Pressable onPress={() => { setState(item); setPickingState(false); queryClient.invalidateQueries({ queryKey: ['delivery', 'agents'] }); }} style={[styles.stateRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: item === state ? 'Inter_700Bold' : 'Inter_400Regular' }}>{item || 'Any state'}</Text>
                {item === state ? <Feather name="check" size={18} color={colors.primary} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  subCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 12 },
  header: { paddingTop: 60, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  subtitle: { fontSize: 14, marginTop: 4 },
  section: { paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  agentRow: { paddingHorizontal: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  rowInfo: { flex: 1, marginLeft: 12, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 16, flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
});
