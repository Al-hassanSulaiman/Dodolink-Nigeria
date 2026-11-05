import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView as KeyboardControllerView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useActiveScreen } from '@/hooks/useActiveScreen';
import { LoadingScreen } from '@/components/Loading';
import { showAlert } from '@/utils/alerts';
import { useDeliveryThread, coverageLine, deliveryTypeLabel, ratingLine } from '@/hooks/useDelivery';
import { DeliveryOrderCard } from '@/components/DeliveryOrderCard';
import { DeliveryRequestModal } from '@/components/DeliveryRequestModal';

export default function DeliveryChatScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number.parseInt(String(params.id ?? ''), 10) || null;
  const colors = useColors();
  const active = useActiveScreen();
  const queryClient = useQueryClient();
  const thread = useDeliveryThread(id, active ? 5000 : false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const list = useRef<FlatList>(null);
  const count = thread.data?.messages.length ?? 0;

  // Mark messages read whenever new ones arrive while the screen is open.
  useEffect(() => {
    if (!id || !thread.data || !active) return;
    customFetch(`/api/delivery/conversations/${id}/read`, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: ['delivery', 'inbox'] }))
      .catch(() => undefined);
  }, [id, count, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    const body = text.trim();
    if (!body || !id || sending) return;
    setSending(true);
    try {
      await customFetch(`/api/delivery/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
    } catch (err) {
      showAlert('Message not sent', (err as { data?: { error?: string } })?.data?.error ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (!id) return <LoadingScreen message="Chat not found" />;
  if (thread.isLoading && !thread.data) return <LoadingScreen message="Loading chat..." />;
  if (thread.isError || !thread.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>This chat could not be loaded.</Text>
      </View>
    );
  }
  const data = thread.data;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>
      <KeyboardControllerView style={styles.container} behavior="padding" keyboardVerticalOffset={100}>
        <Stack.Screen options={{ title: data.title }} />
        {data.role === 'customer' && (
          <View style={[styles.banner, { backgroundColor: colors.secondary }]}>
            <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>
              {deliveryTypeLabel[data.agent.deliveryType]} · {ratingLine(data.agent)} · Delivers: {coverageLine(data.agent) || 'ask in chat'}
            </Text>
          </View>
        )}
        {data.orders.length > 0 && (
          <View style={styles.orders}>
            {data.orders.slice(0, 2).map(order => (
              <DeliveryOrderCard key={order.id} order={order} role={data.role} onChanged={() => queryClient.invalidateQueries({ queryKey: ['delivery'] })} />
            ))}
          </View>
        )}
        {data.role === 'agent' && data.paymentsEnabled && (
          <Pressable onPress={() => setRequesting(true)} style={[styles.requestBtn, { backgroundColor: colors.secondary }]}>
            <Feather name="plus-circle" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>New delivery request</Text>
          </Pressable>
        )}
        <FlatList
          ref={list}
          data={data.messages}
          keyExtractor={m => m.id.toString()}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 40 }}>
              Say hello and describe what you want delivered, and where from and to.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs, { backgroundColor: item.mine ? colors.primary : colors.secondary }]}>
              {item.senderType === 'support' ? (
                <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold', fontSize: 12, marginBottom: 2 }}>DodoLink Support</Text>
              ) : null}
              <Text style={{ color: item.mine ? colors.primaryForeground : colors.secondaryForeground, fontSize: 15 }}>{item.body}</Text>
              <Text style={[styles.time, { color: item.mine ? colors.primaryForeground : colors.mutedForeground }]}>
                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        />
        <View style={[styles.inputBar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Type a message"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
          />
          <Pressable onPress={send} disabled={!text.trim() || sending} style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: !text.trim() || sending ? 0.5 : 1 }]}>
            {sending ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="send" size={18} color={colors.primaryForeground} />}
          </Pressable>
        </View>
      </KeyboardControllerView>
      <DeliveryRequestModal
        visible={requesting}
        conversationId={id}
        onClose={() => setRequesting(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['delivery'] })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  orders: { paddingHorizontal: 12, paddingTop: 10 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 12, marginTop: 6, paddingVertical: 10, borderRadius: 10 },
  messages: { padding: 12, gap: 8, flexGrow: 1 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  time: { fontSize: 10, marginTop: 2, alignSelf: 'flex-end', opacity: 0.8 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
