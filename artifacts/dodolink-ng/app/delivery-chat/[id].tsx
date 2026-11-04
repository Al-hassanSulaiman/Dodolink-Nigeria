import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable, ActivityIndicator, ScrollView, Modal } from 'react-native';
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
import { useDeliveryThread, coverageLine, deliveryTypeLabel } from '@/hooks/useDelivery';
import { DeliveryOrderCard } from '@/components/DeliveryOrderCard';
import { StatePickerModal } from '@/components/StatePickerModal';

export default function DeliveryChatScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number.parseInt(String(params.id ?? ''), 10) || null;
  const colors = useColors();
  const active = useActiveScreen();
  const queryClient = useQueryClient();
  const thread = useDeliveryThread(id, active ? 5000 : false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList>(null);
  const [requesting, setRequesting] = useState(false);
  const [price, setPrice] = useState('');
  const [pickup, setPickup] = useState('');
  const [drop, setDrop] = useState('');
  const [what, setWhat] = useState('');
  const [picking, setPicking] = useState<'pickup' | 'drop' | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  const submitRequest = async () => {
    if (submitting || !id) return;
    setSubmitting(true);
    try {
      await customFetch('/api/delivery/orders', {
        method: 'POST',
        body: JSON.stringify({ conversationId: id, amountNaira: Number(price), pickupState: pickup, dropState: drop, description: what || undefined }),
      });
      setRequesting(false); setPrice(''); setPickup(''); setDrop(''); setWhat('');
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
    } catch (err) {
      showAlert('Delivery request', (err as { data?: { error?: string } })?.data?.error ?? 'Could not send the request.');
    } finally {
      setSubmitting(false);
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
              {deliveryTypeLabel[data.agent.deliveryType]} · Delivers: {coverageLine(data.agent) || 'ask in chat'}
            </Text>
          </View>
        )}
        {data.orders.length > 0 && (
          <ScrollView style={styles.orders} nestedScrollEnabled>
            {data.orders.map(order => <DeliveryOrderCard key={order.id} order={order} role={data.role} />)}
          </ScrollView>
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
              <Text style={{ color: item.mine ? colors.primaryForeground : colors.secondaryForeground, fontSize: 15 }}>{item.body}</Text>
              <Text style={[styles.time, { color: item.mine ? colors.primaryForeground : colors.mutedForeground }]}>
                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        />
        {data.role === 'agent' && (
          <Pressable onPress={() => setRequesting(true)} style={[styles.requestBtn, { borderColor: colors.primary }]}>
            <Feather name="package" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>New delivery request</Text>
          </Pressable>
        )}
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

      <Modal visible={requesting} animationType="slide" onRequestClose={() => setRequesting(false)}>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 20 }}>New delivery request</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              The customer pays this price. DodoLink keeps 10% and Paystack fees come out of your share. You will see exactly what you receive once you send it.
            </Text>
            <TextInput
              value={price}
              onChangeText={v => setPrice(v.replace(/\D/g, ''))}
              placeholder="Price in naira, e.g. 15000"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary }]}
            />
            <Pressable onPress={() => setPicking('pickup')} style={[styles.field, { backgroundColor: colors.secondary }]}>
              <Text style={{ color: pickup ? colors.foreground : colors.mutedForeground, fontSize: 15 }}>{pickup || 'Pickup state'}</Text>
            </Pressable>
            <Pressable onPress={() => setPicking('drop')} style={[styles.field, { backgroundColor: colors.secondary }]}>
              <Text style={{ color: drop ? colors.foreground : colors.mutedForeground, fontSize: 15 }}>{drop || 'Drop-off state'}</Text>
            </Pressable>
            <TextInput
              value={what}
              onChangeText={setWhat}
              placeholder="What is being delivered (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.field, { color: colors.foreground, backgroundColor: colors.secondary }]}
              maxLength={500}
            />
            <Pressable
              onPress={submitRequest}
              disabled={submitting || !price || !pickup || !drop}
              style={[styles.submit, { backgroundColor: colors.primary, opacity: submitting || !price || !pickup || !drop ? 0.5 : 1 }]}
            >
              {submitting ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 16 }}>Send request</Text>}
            </Pressable>
            <Pressable onPress={() => setRequesting(false)} style={{ alignItems: 'center', padding: 8 }}>
              <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Cancel</Text>
            </Pressable>
          </ScrollView>
          <StatePickerModal
            visible={picking !== null}
            title={picking === 'pickup' ? 'Pickup state' : 'Drop-off state'}
            selected={picking === 'pickup' ? pickup : drop}
            onSelect={st => (picking === 'pickup' ? setPickup(st) : setDrop(st))}
            onClose={() => setPicking(null)}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  orders: { maxHeight: 320 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 10, marginHorizontal: 10, marginBottom: 6, paddingVertical: 8 },
  field: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15 },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  messages: { padding: 12, gap: 8, flexGrow: 1 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  time: { fontSize: 10, marginTop: 2, alignSelf: 'flex-end', opacity: 0.8 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
