import { useState } from 'react';
import { StyleSheet, View, Text, Pressable, TextInput, ActivityIndicator, Modal } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';
import { naira, type DeliveryOrder } from '@/hooks/useDelivery';

const STATUS_TEXT: Record<string, string> = {
  requested: 'Waiting for payment',
  paid: 'Paid. Goods on the way',
  delivered: 'Delivered',
  disputed: 'Problem raised. DodoLink support is reviewing it',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
  review: 'Payment under review',
};
const PAYOUT_TEXT: Record<string, string> = {
  pending: 'Payout: waiting for DodoLink to approve',
  starting: 'Payout: being checked',
  awaiting_otp: 'Payout: being approved',
  processing: 'Payout: on its way to your bank',
  paid: 'Payout: sent to your bank',
  failed: 'Payout: delayed, DodoLink is looking into it',
  held: 'Payout: on hold',
};

function errorText(err: unknown) {
  return (err as { data?: { error?: string } })?.data?.error ?? 'Something went wrong. Please try again.';
}

export function DeliveryOrderCard({ order, role, onChanged }: { order: DeliveryOrder; role: 'customer' | 'agent'; onChanged: () => void }) {
  const colors = useColors();
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [problemOpen, setProblemOpen] = useState(false);
  const [problem, setProblem] = useState('');

  const call = async (key: string, path: string, body?: unknown) => {
    if (busy) return;
    setBusy(key);
    try {
      const res = await customFetch(`/api/delivery/orders/${order.id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      onChanged();
      return res;
    } catch (err) {
      showAlert('Delivery', errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (busy) return;
    setBusy('pay');
    try {
      const res = await customFetch<{ checkoutUrl: string }>(`/api/delivery/orders/${order.id}/pay`, { method: 'POST', body: '{}' });
      await WebBrowser.openBrowserAsync(res.checkoutUrl);
      // Back from checkout: ask the server to confirm with Paystack right away.
      await customFetch(`/api/delivery/orders/${order.id}/verify`, { method: 'POST', body: '{}' }).catch(() => undefined);
      onChanged();
    } catch (err) {
      showAlert('Payment', errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const sendProblem = async () => {
    if (problem.trim().length < 10) { showAlert('Delivery', 'Please describe the problem in a few words (at least 10 characters).'); return; }
    await call('problem', 'dispute', { reason: problem.trim() });
    setProblemOpen(false);
    setProblem('');
  };

  const button = (label: string, onPress: () => void, key: string, kind: 'primary' | 'plain' = 'primary') => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={!!busy}
      style={[styles.btn, kind === 'primary' ? { backgroundColor: colors.primary } : { borderColor: colors.border, borderWidth: 1 }, busy ? { opacity: 0.6 } : null]}
    >
      {busy === key ? <ActivityIndicator color={kind === 'primary' ? colors.primaryForeground : colors.foreground} /> : (
        <Text style={{ color: kind === 'primary' ? colors.primaryForeground : colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{label}</Text>
      )}
    </Pressable>
  );

  const canReport = ['paid', 'delivered'].includes(order.status) && !order.disputed && (role === 'customer' || order.payoutStatus === 'none' || order.payoutStatus === 'pending');
  const finished = ['cancelled', 'refunded'].includes(order.status);

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <Feather name="package" size={18} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>Delivery #{order.id} · {naira(order.amountKobo)}</Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{order.pickupState} to {order.dropState}{order.description ? ` · ${order.description}` : ''}</Text>
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 4 }}>{STATUS_TEXT[order.status] ?? order.status}</Text>

      {role === 'agent' && order.breakdown && !finished && (
        <View style={[styles.breakdown, { backgroundColor: colors.secondary }]}>
          <Text style={{ color: colors.secondaryForeground, fontSize: 12 }}>DodoLink fee (10%): -{naira(order.breakdown.platformFeeKobo)}</Text>
          <Text style={{ color: colors.secondaryForeground, fontSize: 12 }}>Payment fees: -{naira(order.breakdown.paystackFeeKobo + order.breakdown.transferFeeKobo)}</Text>
          <Text style={{ color: colors.secondaryForeground, fontSize: 13, fontFamily: 'Inter_700Bold' }}>You receive: {naira(order.breakdown.youReceiveKobo)}</Text>
        </View>
      )}
      {role === 'agent' && order.payoutStatus && PAYOUT_TEXT[order.payoutStatus] && order.status !== 'refunded' ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>{PAYOUT_TEXT[order.payoutStatus]}</Text>
      ) : null}

      {role === 'customer' && order.code ? (
        <View style={[styles.codeBox, { backgroundColor: colors.secondary }]}>
          <Text style={{ color: colors.secondaryForeground, fontSize: 12 }}>Your delivery code. Give it to the company only when your goods arrive.</Text>
          <Text style={{ color: colors.foreground, fontSize: 30, letterSpacing: 8, fontFamily: 'Inter_700Bold' }}>{order.code}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {role === 'customer' && order.status === 'requested' && [
          button(`Pay ${naira(order.amountKobo)}`, pay, 'pay'),
          button('Decline', () => call('cancel', 'cancel'), 'cancel', 'plain'),
        ]}
        {role === 'agent' && order.status === 'requested' && button('Cancel request', () => call('cancel', 'cancel'), 'cancel', 'plain')}
        {role === 'customer' && order.status === 'paid' && button('My goods arrived', () => call('confirm', 'confirm'), 'confirm')}
        {canReport && button('Report a problem', () => setProblemOpen(true), 'report', 'plain')}
      </View>

      {role === 'agent' && order.status === 'paid' ? (
        <View style={styles.codeRow}>
          <TextInput
            style={[styles.codeInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Customer's 4-digit code"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            maxLength={4}
            value={code}
            onChangeText={setCode}
          />
          {button('Confirm delivery', async () => { await call('deliver', 'deliver', { code }); setCode(''); }, 'deliver')}
        </View>
      ) : null}

      {role === 'customer' && order.deliveredAt && order.status !== 'refunded' ? (
        order.rating ? (
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 6 }}>You rated this company {'★'.repeat(order.rating.stars)}{'☆'.repeat(5 - order.rating.stars)}</Text>
        ) : (
          <View style={{ marginTop: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>Rate this company</Text>
            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
                  <Text style={{ fontSize: 30, color: n <= stars ? '#F59E0B' : colors.mutedForeground }}>{n <= stars ? '★' : '☆'}</Text>
                </Pressable>
              ))}
            </View>
            {stars > 0 && (
              <>
                <TextInput
                  style={[styles.commentInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
                  placeholder="Add a short comment (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  value={comment}
                  onChangeText={setComment}
                  maxLength={500}
                />
                {button('Submit rating', () => { void call('rate', 'rate', { stars, comment }); }, 'rate')}
              </>
            )}
          </View>
        )
      ) : null}

      <Modal visible={problemOpen} transparent animationType="fade" onRequestClose={() => setProblemOpen(false)}>
        <View style={styles.modalBack}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 6 }}>Report a problem</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>The payment is held while DodoLink support looks into it. Support can read this conversation once a problem is reported.</Text>
            <TextInput
              style={[styles.commentInput, { color: colors.foreground, backgroundColor: colors.secondary, minHeight: 90, textAlignVertical: 'top' }]}
              placeholder="What went wrong?"
              placeholderTextColor={colors.mutedForeground}
              value={problem}
              onChangeText={setProblem}
              multiline
              maxLength={1000}
            />
            <View style={[styles.actions, { marginTop: 10 }]}>
              {button('Send', sendProblem, 'problem')}
              {button('Cancel', () => setProblemOpen(false), 'close', 'plain')}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 15, flexShrink: 1 },
  breakdown: { borderRadius: 10, padding: 8, marginTop: 8, gap: 2 },
  codeBox: { borderRadius: 10, padding: 10, marginTop: 8, alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minWidth: 90, alignItems: 'center' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  codeInput: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minWidth: 170 },
  starRow: { flexDirection: 'row', gap: 6, marginVertical: 4 },
  commentInput: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modal: { borderRadius: 16, padding: 16 },
});
