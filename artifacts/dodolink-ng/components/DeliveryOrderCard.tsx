import { useState } from 'react';
import { StyleSheet, View, Text, Pressable, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';
import { naira, type DeliveryOrder } from '@/hooks/useDelivery';

const PAYOUT_TEXT: Record<string, string> = {
  none: 'Payout not started', queued: 'Payout is being processed by DodoLink', sending: 'Payout is being sent',
  awaiting_otp: 'Payout is being processed by DodoLink', sent: 'Payout sent. Your bank is processing it', paid: 'Paid to your bank account', failed: 'Payout is being retried by DodoLink',
};

function confirmAction(title: string, message: string, yes: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [{ text: 'Not yet', style: 'cancel' }, { text: yes, onPress: onYes }]);
}

function errorOf(err: unknown, fallback: string): string {
  return (err as { data?: { error?: string } })?.data?.error ?? fallback;
}

export function DeliveryOrderCard({ order, role }: { order: DeliveryOrder; role: 'customer' | 'agent' }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [stars, setStars] = useState(0);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['delivery'] });

  const run = async (path: string, body: object | null, fail: string, after?: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await customFetch(`/api/delivery/orders/${order.id}/${path}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      if (after) await after();
      await refresh();
    } catch (err) {
      showAlert('Delivery', errorOf(err, fail));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await customFetch<{ checkoutUrl: string }>(`/api/delivery/orders/${order.id}/pay`, { method: 'POST' });
      await WebBrowser.openBrowserAsync(res.checkoutUrl);
      // Back from checkout: ask the server to confirm the payment with Paystack.
      await customFetch(`/api/delivery/orders/${order.id}/verify`, { method: 'POST' });
      await refresh();
    } catch (err) {
      showAlert('Payment', errorOf(err, 'Could not start the payment. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    await run('dispute', { reason }, 'Could not send your report.', () => { setReporting(false); setReason(''); });
  };

  const route = `${order.pickupState} → ${order.dropState}`;
  const box = [styles.card, { backgroundColor: colors.card ?? colors.secondary, borderColor: colors.border }];
  const text = { color: colors.foreground, fontSize: 14 };
  const muted = { color: colors.mutedForeground, fontSize: 13 };
  const primaryBtn = (label: string, onPress: () => void, disabled = false) => (
    <Pressable onPress={onPress} disabled={busy || disabled} style={[styles.btn, { backgroundColor: colors.primary, opacity: busy || disabled ? 0.5 : 1 }]}>
      {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{label}</Text>}
    </Pressable>
  );
  const linkBtn = (label: string, onPress: () => void, destructive = false) => (
    <Pressable onPress={onPress} disabled={busy} hitSlop={8}>
      <Text style={{ color: destructive ? colors.destructive : colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  const header = (
    <View>
      <Text style={[text, { fontFamily: 'Inter_700Bold' }]}>Delivery #{order.id} · {naira(order.amountKobo)}</Text>
      <Text style={muted}>{route}</Text>
      {order.description ? <Text style={muted}>{order.description}</Text> : null}
    </View>
  );

  let body: React.ReactNode = null;

  if (order.status === 'disputed') {
    body = <Text style={muted}>A problem was reported. DodoLink is reviewing it and will update you here.</Text>;
  } else if (order.status === 'refunded') {
    body = <Text style={muted}>{role === 'customer' ? 'Your payment was refunded.' : 'This job was refunded to the customer.'}</Text>;
  } else if (order.status === 'cancelled') {
    body = <Text style={muted}>This request was cancelled.</Text>;
  } else if (role === 'customer') {
    if (order.status === 'requested') {
      body = (
        <View style={styles.actions}>
          {primaryBtn(`Pay ${naira(order.amountKobo)}`, pay)}
          {linkBtn('Decline', () => run('cancel', null, 'Could not cancel.'), true)}
        </View>
      );
    } else if (order.status === 'paid') {
      body = (
        <View style={{ gap: 8 }}>
          <Text style={muted}>Paid. Your delivery code:</Text>
          <Text style={[styles.code, { color: colors.foreground }]}>{order.deliveryCode ?? '----'}</Text>
          <Text style={muted}>Give this code to the company only when your goods have arrived.</Text>
          <View style={styles.actions}>
            {primaryBtn('I received my goods', () => confirmAction('Confirm delivery', 'Only confirm if your goods have arrived. DodoLink will then pay the delivery company.', 'Yes, received', () => void run('confirm', null, 'Could not confirm.')))}
            {linkBtn('Report a problem', () => setReporting(true), true)}
          </View>
        </View>
      );
    } else if (order.status === 'delivered') {
      body = order.ratingStars ? (
        <Text style={muted}>Delivered. You rated this delivery {'★'.repeat(order.ratingStars)}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={muted}>Delivered. How was it?</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
                <Text style={{ fontSize: 30, color: n <= stars ? '#F59E0B' : colors.mutedForeground }}>{n <= stars ? '★' : '☆'}</Text>
              </Pressable>
            ))}
          </View>
          {primaryBtn('Submit rating', () => void run('rate', { stars }, 'Could not save your rating.'), stars === 0)}
        </View>
      );
    }
  } else {
    const b = order.breakdown;
    if (order.status === 'requested') {
      body = (
        <View style={{ gap: 6 }}>
          {b ? (
            <Text style={muted}>
              You will receive about {naira(b.companyReceivesKobo)}: the price, less DodoLink's 10% ({naira(b.platformFeeKobo)}) and Paystack fees (about {naira(b.paystackFeeKobo + b.transferFeeKobo)}). Waiting for the customer to pay.
            </Text>
          ) : null}
          {linkBtn('Cancel request', () => run('cancel', null, 'Could not cancel.'), true)}
        </View>
      );
    } else if (order.status === 'paid') {
      body = (
        <View style={{ gap: 8 }}>
          <Text style={muted}>Paid. Deliver the goods, then ask the customer for their 4-digit code.</Text>
          <TextInput
            value={code}
            onChangeText={v => setCode(v.replace(/\D/g, '').slice(0, 4))}
            placeholder="Customer's code"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            maxLength={4}
            style={[styles.codeInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <View style={styles.actions}>
            {primaryBtn('Confirm delivery', () => void run('deliver', { code }, 'That code is not correct.'), code.length !== 4)}
            {linkBtn('Report a problem', () => setReporting(true), true)}
          </View>
        </View>
      );
    } else if (order.status === 'delivered') {
      body = (
        <View style={{ gap: 4 }}>
          <Text style={muted}>Delivered. {PAYOUT_TEXT[order.payoutStatus ?? 'none']}.</Text>
          {b ? <Text style={muted}>You receive {naira(b.companyReceivesKobo)}{b.estimated ? ' (estimate)' : ''}.</Text> : null}
        </View>
      );
    }
  }

  return (
    <View style={box}>
      {header}
      <View style={{ height: 8 }} />
      {body}
      {reporting && (
        <View style={{ gap: 8, marginTop: 10 }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="What went wrong?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={1000}
            style={[styles.reasonInput, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
          />
          <View style={styles.actions}>
            {primaryBtn('Send report', () => void report(), reason.trim().length < 5)}
            {linkBtn('Cancel', () => { setReporting(false); setReason(''); })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginHorizontal: 12, marginTop: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, minWidth: 120, alignItems: 'center' },
  code: { fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: 8 },
  codeInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, letterSpacing: 6 },
  reasonInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 70, fontSize: 14 },
  stars: { flexDirection: 'row', gap: 8 },
});
