import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Switch,
  Alert,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import {
  useGetSubscription,
  useInitializeSubscription,
  useVerifySubscription,
  useChargeSubscription,
  useToggleAutoPay,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { useListStores } from '@workspace/api-client-react';
import { Button } from '@/components/ui';
import { LoadingScreen } from '@/components/Loading';

const SUBSCRIPTION_FEE = '₦5,000';
const ENGAGEMENT_THRESHOLD = 7;

export default function SubscriptionScreen() {
  const colors = useColors();
  const { userId, isReady } = useUserIdentity();
  const [pendingReference, setPendingReference] = useState<string | null>(null);

  const { data: stores, isLoading: storesLoading } = useListStores(
    {},
    { query: { enabled: !!userId } }
  );
  const myStore = stores?.find((s) => s.ownerUserId === userId);

  const {
    data: sub,
    isLoading: subLoading,
    refetch,
  } = useGetSubscription(myStore?.id ?? 0, {
    query: { enabled: !!myStore?.id },
  });

  const initMutation = useInitializeSubscription();
  const verifyMutation = useVerifySubscription();
  const chargeMutation = useChargeSubscription();
  const autoPayMutation = useToggleAutoPay();

  const { user } = useAuth() as any;
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';

  const handlePayManually = async () => {
    if (!myStore) return;
    if (!userEmail) {
      Alert.alert('Email required', 'Your account has no email address. Please update your profile.');
      return;
    }

    try {
      const data = await initMutation.mutateAsync({
        storeId: myStore.id,
        data: { email: userEmail },
      });

      setPendingReference(data.reference);
      await WebBrowser.openBrowserAsync(data.checkoutUrl);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not initiate payment');
    }
  };

  const handleConfirmPayment = async () => {
    if (!myStore || !pendingReference) return;

    try {
      await verifyMutation.mutateAsync({
        storeId: myStore.id,
        data: { reference: pendingReference },
      });
      setPendingReference(null);
      await refetch();
      Alert.alert('Success', 'Subscription activated! Your store is now active.');
    } catch (err: any) {
      Alert.alert('Verification failed', err?.message ?? 'Could not verify payment. Try again.');
    }
  };

  const handleAutoCharge = async () => {
    if (!myStore) return;
    Alert.alert(
      'Renew subscription',
      `Charge ${SUBSCRIPTION_FEE} using your saved card?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Charge now',
          onPress: async () => {
            try {
              await chargeMutation.mutateAsync({ storeId: myStore.id });
              await refetch();
              Alert.alert('Success', 'Subscription renewed!');
            } catch (err: any) {
              Alert.alert('Charge failed', err?.message ?? 'Payment could not be processed.');
            }
          },
        },
      ]
    );
  };

  const handleToggleAutoPay = async (value: boolean) => {
    if (!myStore) return;
    try {
      await autoPayMutation.mutateAsync({
        storeId: myStore.id,
        data: { enabled: value },
      });
      await refetch();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not update auto-pay setting.');
    }
  };

  if (!isReady || storesLoading) return <LoadingScreen message="Loading…" />;

  const statusColor =
    sub?.subscriptionStatus === 'active'
      ? '#22c55e'
      : sub?.subscriptionStatus === 'past_due'
      ? '#f59e0b'
      : colors.mutedForeground;

  const statusLabel =
    sub?.subscriptionStatus === 'active'
      ? 'Active'
      : sub?.subscriptionStatus === 'past_due'
      ? 'Past Due'
      : 'Inactive';

  const dueDate = sub?.subscriptionDueAt ? new Date(sub.subscriptionDueAt) : null;
  const lastPaid = sub?.subscriptionLastPaidAt ? new Date(sub.subscriptionLastPaidAt) : null;
  const isOverdue = dueDate ? dueDate < new Date() : false;

  const daysLeft = sub?.gracePeriodDaysRemaining ?? null;
  const isHidden = sub ? !sub.isVisible : false;
  const graceUrgencyColor =
    daysLeft !== null && daysLeft <= 3
      ? '#ef4444'
      : daysLeft !== null && daysLeft <= 7
      ? '#f59e0b'
      : '#3b82f6';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={
        <RefreshControl
          refreshing={subLoading}
          onRefresh={refetch}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Subscription</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.content}>

        {/* Store hidden banner */}
        {isHidden && (
          <View style={[styles.alertBanner, { backgroundColor: '#ef444422', borderColor: '#ef4444' }]}>
            <Feather name="eye-off" size={18} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: '#ef4444' }]}>Your store is currently hidden</Text>
              <Text style={[styles.alertBody, { color: '#ef4444cc' }]}>
                Customers cannot find your store. Pay your subscription to restore visibility immediately.
              </Text>
            </View>
          </View>
        )}

        {/* Grace period countdown */}
        {!isHidden && daysLeft !== null && (
          <View style={[styles.alertBanner, { backgroundColor: graceUrgencyColor + '22', borderColor: graceUrgencyColor }]}>
            <Feather name="clock" size={18} color={graceUrgencyColor} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.alertTitle, { color: graceUrgencyColor }]}>
                {daysLeft === 0
                  ? 'Grace period ends today!'
                  : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in grace period`}
              </Text>
              <Text style={[styles.alertBody, { color: graceUrgencyColor + 'cc' }]}>
                Your store will be hidden from customers if you don't pay before the grace period ends.
              </Text>
            </View>
          </View>
        )}

        {/* Eligibility card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Eligibility</Text>
          <View style={styles.progressRow}>
            <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.min(100, ((sub?.engagementCount ?? 0) / ENGAGEMENT_THRESHOLD) * 100)}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
              {sub?.engagementCount ?? 0}/{ENGAGEMENT_THRESHOLD}
            </Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            {sub?.qualified
              ? '✓ Your store qualifies for a subscription'
              : `Reach ${ENGAGEMENT_THRESHOLD} customer interactions (reviews + messages) to activate your subscription.`}
          </Text>
        </View>

        {/* Status card */}
        {sub && (
          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}
          >
            <View style={styles.statusRow}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Status</Text>
              <View style={[styles.badge, { backgroundColor: statusColor + '22' }]}>
                <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>

            {sub.subscriptionStatus === 'active' && dueDate && (
              <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                {isOverdue
                  ? `⚠️ Due date passed on ${dueDate.toLocaleDateString('en-NG')}`
                  : `Next renewal: ${dueDate.toLocaleDateString('en-NG')}`}
              </Text>
            )}
            {lastPaid && (
              <Text style={[styles.cardBody, { color: colors.mutedForeground, marginTop: 4 }]}>
                Last paid: {lastPaid.toLocaleDateString('en-NG')}
              </Text>
            )}

            {/* Auto-pay toggle */}
            {sub.hasAutoCharge && (
              <View style={[styles.autoPayRow, { borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.autoPayLabel, { color: colors.foreground }]}>
                    Auto-renew
                  </Text>
                  <Text style={[styles.autoPaySub, { color: colors.mutedForeground }]}>
                    Automatically charge {SUBSCRIPTION_FEE} every 30 days
                  </Text>
                </View>
                <Switch
                  value={sub.autoPayEnabled}
                  onValueChange={handleToggleAutoPay}
                  disabled={autoPayMutation.isPending}
                  trackColor={{ true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            )}
          </View>
        )}

        {/* Payment actions */}
        {sub?.qualified && (
          <View
            style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payment</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground, marginBottom: 16 }]}>
              {SUBSCRIPTION_FEE}/month keeps your store visible and accepting orders.
            </Text>

            {/* Pending verification banner */}
            {pendingReference && (
              <View
                style={[styles.pendingBanner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '44' }]}
              >
                <Feather name="info" size={16} color={colors.primary} />
                <Text style={[styles.pendingText, { color: colors.primary }]}>
                  After completing payment in your browser, tap the button below to confirm.
                </Text>
              </View>
            )}

            {pendingReference ? (
              <Button
                title={verifyMutation.isPending ? 'Confirming…' : 'I have completed payment'}
                onPress={handleConfirmPayment}
                disabled={verifyMutation.isPending}
              />
            ) : (
              <View style={styles.buttonGroup}>
                <Button
                  title={
                    initMutation.isPending
                      ? 'Opening payment…'
                      : sub.subscriptionStatus === 'active'
                      ? `Renew now (${SUBSCRIPTION_FEE})`
                      : `Pay ${SUBSCRIPTION_FEE} to activate`
                  }
                  onPress={handlePayManually}
                  disabled={initMutation.isPending}
                />
                {sub.hasAutoCharge && sub.subscriptionStatus !== 'active' && (
                  <View style={{ marginTop: 8 }}>
                    <Button
                      title={chargeMutation.isPending ? 'Charging…' : 'Charge saved card'}
                      variant="outline"
                      onPress={handleAutoCharge}
                      disabled={chargeMutation.isPending}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Not qualified yet */}
        {sub && !sub.qualified && (
          <View
            style={[
              styles.card,
              styles.infoCard,
              { backgroundColor: colors.muted, borderColor: colors.border, marginTop: 12 },
            ]}
          >
            <Feather name="lock" size={20} color={colors.mutedForeground} />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Subscription payment will be unlocked once your store reaches {ENGAGEMENT_THRESHOLD} customer interactions.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: { padding: 4 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 10,
  },
  cardBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    minWidth: 32,
    textAlign: 'right',
  },
  autoPayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    marginTop: 14,
    borderTopWidth: 1,
  },
  autoPayLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 2,
  },
  autoPaySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  buttonGroup: {},
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
  },
  pendingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  infoText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  alertTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 3,
  },
  alertBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
});
