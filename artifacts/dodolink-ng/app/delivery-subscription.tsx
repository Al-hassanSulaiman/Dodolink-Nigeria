import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { showAlert } from '@/utils/alerts';
import { naira, useDeliverySubscription } from '@/hooks/useDelivery';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

/** A delivery company pays its monthly subscription here, like a store does in My Store. */
export default function DeliverySubscriptionScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { userEmail } = useUserIdentity();
  const sub = useDeliverySubscription(true);
  const [email, setEmail] = useState(userEmail ?? '');
  const [reference, setReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (sub.isLoading && !sub.data) return <LoadingScreen message="Loading subscription..." />;
  if (sub.isError || !sub.data) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={{ color: colors.mutedForeground }}>Could not load your subscription.</Text></View>;
  }
  const s = sub.data;

  const pay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await customFetch<{ checkoutUrl: string; reference: string }>('/api/delivery/subscription/initialize', {
        method: 'POST', body: JSON.stringify({ email: email.trim() }),
      });
      setReference(res.reference);
      await WebBrowser.openBrowserAsync(res.checkoutUrl);
    } catch (err) {
      showAlert('Payment', (err as { data?: { error?: string } })?.data?.error ?? 'Could not start the payment. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!reference || busy) return;
    setBusy(true);
    try {
      await customFetch('/api/delivery/subscription/verify', { method: 'POST', body: JSON.stringify({ reference }) });
      setReference(null);
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
      showAlert('Thank you', 'Your subscription is active.');
    } catch (err) {
      showAlert('Not confirmed yet', (err as { data?: { error?: string } })?.data?.error ?? 'We could not confirm the payment yet. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const status = s.exempt ? 'Free of charge'
    : s.paid ? `Active until ${day(s.dueAt!)}`
    : !s.qualified ? 'Not needed yet'
    : s.graceDaysLeft !== null && s.graceDaysLeft > 0 ? `${s.graceDaysLeft} day${s.graceDaysLeft === 1 ? '' : 's'} left before customers stop seeing you`
    : 'Unpaid: customers cannot see your company';

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Subscription' }} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Status</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>{status}</Text>
        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>Different customers who chatted with you in 30 days</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>{s.engagementCount}</Text>
        <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>Monthly fee</Text>
        <Text style={[styles.value, { color: colors.foreground }]}>{naira(s.amountKobo)}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
          ₦2,000 a month, or ₦5,000 once 12 or more different customers chat with you in 30 days. It starts after 7 different customers have chatted with you.
        </Text>
      </View>

      {s.exempt || !s.paymentsLive || (!s.qualified && !s.paid) ? null : (
        <View style={styles.pay}>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Email for your payment receipt"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Pressable onPress={pay} disabled={busy || !email.includes('@')} style={[styles.btn, { backgroundColor: colors.primary, opacity: busy || !email.includes('@') ? 0.5 : 1 }]}>
            {busy && !reference ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>{s.paid ? 'Renew now' : 'Pay now'}</Text>}
          </Pressable>
          {reference ? (
            <Pressable onPress={confirm} disabled={busy} style={[styles.btn, { backgroundColor: colors.secondary }]}>
              <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>I have completed payment</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { padding: 16, gap: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16 },
  label: { fontSize: 13 },
  value: { fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 2 },
  pay: { gap: 10 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  btn: { borderRadius: 24, paddingVertical: 13, alignItems: 'center' },
});
