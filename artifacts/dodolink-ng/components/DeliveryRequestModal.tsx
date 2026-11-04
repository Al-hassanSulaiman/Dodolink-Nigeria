import { useState } from 'react';
import { StyleSheet, View, Text, Pressable, TextInput, Modal, FlatList, ActivityIndicator } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';
import { naira, previewQuote, useDeliveryStates } from '@/hooks/useDelivery';

/** The company proposes a job and a price inside the chat. */
export function DeliveryRequestModal({ visible, conversationId, onClose, onCreated }: {
  visible: boolean; conversationId: number; onClose: () => void; onCreated: () => void;
}) {
  const colors = useColors();
  const states = useDeliveryStates();
  const [price, setPrice] = useState('');
  const [pickup, setPickup] = useState('');
  const [drop, setDrop] = useState('');
  const [what, setWhat] = useState('');
  const [picking, setPicking] = useState<'pickup' | 'drop' | null>(null);
  const [sending, setSending] = useState(false);
  const amount = Number(price.replace(/,/g, ''));
  const q = amount >= 500 ? previewQuote(amount) : null;

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      await customFetch(`/api/delivery/conversations/${conversationId}/orders`, {
        method: 'POST',
        body: JSON.stringify({ amountNaira: amount, pickupState: pickup, dropState: drop, description: what }),
      });
      setPrice(''); setPickup(''); setDrop(''); setWhat('');
      onCreated();
      onClose();
    } catch (err) {
      showAlert('Delivery request', (err as { data?: { error?: string } })?.data?.error ?? 'Could not send the request. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const field = (label: string, value: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={[styles.input, { backgroundColor: colors.secondary }]}>
      <Text style={{ color: value ? colors.foreground : colors.mutedForeground, fontSize: 15 }}>{value || label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {picking ? (
          <>
            <Text style={[styles.heading, { color: colors.foreground }]}>{picking === 'pickup' ? 'Pickup state' : 'Drop-off state'}</Text>
            <FlatList
              data={states.data ?? []}
              keyExtractor={s => s}
              renderItem={({ item }) => (
                <Pressable onPress={() => { if (picking === 'pickup') setPickup(item); else setDrop(item); setPicking(null); }} style={[styles.row, { borderBottomColor: colors.border }]}>
                  <Text style={{ color: colors.foreground, fontSize: 16 }}>{item}</Text>
                </Pressable>
              )}
            />
            <Pressable onPress={() => setPicking(null)} style={styles.closeBtn}><Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Back</Text></Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.heading, { color: colors.foreground }]}>New delivery request</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground }]}
              placeholder="Price you agreed (₦)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              value={price}
              onChangeText={setPrice}
            />
            {field('Pickup state', pickup, () => setPicking('pickup'))}
            {field('Drop-off state', drop, () => setPicking('drop'))}
            <TextInput
              style={[styles.input, { backgroundColor: colors.secondary, color: colors.foreground }]}
              placeholder="What is being delivered (optional)"
              placeholderTextColor={colors.mutedForeground}
              value={what}
              onChangeText={setWhat}
              maxLength={500}
            />
            {q && (
              <View style={[styles.quote, { backgroundColor: colors.secondary }]}>
                <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>Customer pays: {naira(amount * 100)}</Text>
                <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>DodoLink fee (10%): -{naira(q.platform)}</Text>
                <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>Payment fees (estimate): -{naira(q.paystack + q.transfer)}</Text>
                <Text style={{ color: colors.secondaryForeground, fontSize: 15, fontFamily: 'Inter_700Bold' }}>You receive about {naira(q.receive)}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>The exact payment fee is taken when the customer pays. You are paid after the delivery is confirmed.</Text>
              </View>
            )}
            <View style={styles.buttons}>
              <Pressable onPress={send} disabled={sending || !q || !pickup || !drop} style={[styles.btn, { backgroundColor: colors.primary, opacity: sending || !q || !pickup || !drop ? 0.5 : 1 }]}>
                {sending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Send request</Text>}
              </Pressable>
              <Pressable onPress={onClose} style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 14 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, marginBottom: 10 },
  row: { paddingVertical: 14, borderBottomWidth: 1 },
  closeBtn: { paddingVertical: 16, alignItems: 'center' },
  quote: { borderRadius: 12, padding: 12, gap: 3, marginBottom: 12 },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center', minWidth: 110 },
});
