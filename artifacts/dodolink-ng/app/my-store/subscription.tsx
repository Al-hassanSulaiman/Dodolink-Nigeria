import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  RefreshControl,
  Switch,
  ActivityIndicator,
  Pressable,
  Platform,
  Linking,
} from 'react-native';
import { showAlert, confirmAlert } from '@/utils/alerts';
import { useState } from 'react';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useUser } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import {
  useGetSubscription,
  useInitializeSubscription,
  useVerifySubscription,
  useChargeSubscription,
  useToggleAutoPay,
  getGetSubscriptionQueryKey,
  getListStoresQueryKey,
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
    { ownerUserId: userId ?? undefined },
    {
      query: {
        enabled: !!userId,
        queryKey: getListStoresQueryKey({ ownerUserId: userId ?? undefined }),
      },
    }
  );
  const myStore = stores?.find((s) => s.ownerUserId === userId);

  const {
    data: sub,
    isLoading: subLoading,
    refetch,
  } = useGetSubscription(myStore?.id ?? 0, {
    query: {
      enabled: !!myStore?.id,
      queryKey: getGetSubscriptionQueryKey(myStore?.id ?? 0),
    },
  });

  const initMutation = useInitializeSubscription();
  const verifyMutation = useVerifySubscription();
  const chargeMutation = useChargeSubscription();
  const autoPayMutation = useToggleAutoPay();

  const { user } = useUser();
  const userEmail =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    '';

  const handlePayManually = async () => {
    if (!myStore) return;
    if (!userEmail) {
      showAlert('Email required', 'Your account has no email address. Please update your profile.');
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
      showAlert('Error', err?.message ?? 'Could not initiate payment');
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
      showAlert('Success', 'Subscription activated! Your store is now active.');
    } catch (err: any) {
      showAlert('Verification failed', err?.message ?? 'Could not verify payment. Try again.');
    }
  };

  const handleAutoCharge = async () => {
    if (!myStore) return;
    confirmAlert({
      title: 'Renew subscription',
      message: `Charge ${SUBSCRIPTION_FEE} using your saved card?`,
      confirmText: 'Charge now',
      onConfirm: async () => {
        try {
          await chargeMutation.mutateAsync({ storeId: myStore.id });
          await refetch();
          showAlert('Success', 'Subscription renewed!');
        } catch (err: any) {
          showAlert('Charge failed', err?.message ?? 'Payment could not be processed.');
        }
      },
    });
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
      showAlert('Error', err?.message ?? 'Could not update auto-pay setting.');
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

            {/* Coming soon banner — shown before Jan 1 2027 */}
            {!sub.paymentsLive ? (
              <View style={[styles.comingSoonBanner, { backgroundColor: '#16a34a18', borderColor: '#16a34a44' }]}>
                <Feather name="calendar" size={20} color="#16a34a" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.comingSoonTitle, { color: '#16a34a' }]}>
                    Subscription billing launches January 1, 2027
                  </Text>
                  <Text style={[styles.comingSoonBody, { color: '#16a34a99' }]}>
                    Your store is free to use until then. No payment is required right now — enjoy building your customer base!
                  </Text>
                </View>
              </View>
            ) : Platform.OS === 'ios' ? (
              /* iOS: Apple does not allow in-app payment initiation for this
                 type of service. Direct the user to the website instead. */
              <View style={[styles.webPayBanner, { backgroundColor: '#1B5E2010', borderColor: '#1B5E2044' }]}>
                <Feather name="globe" size={20} color="#1B5E20" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.webPayTitle, { color: '#1B5E20' }]}>
                    Subscribe on our website
                  </Text>
                  <Text style={[styles.webPayBody, { color: '#1B5E2099' }]}>
                    To subscribe or renew, visit your store's subscription page on the Dodolink website.
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.webPayBtn, pressed && { opacity: 0.75 }]}
                    onPress={() => Linking.openURL('https://dodolink.com.ng/my-store/subscription')}
                  >
                    <Text style={styles.webPayBtnText}>Open dodolink.com.ng</Text>
                    <Feather name="external-link" size={14} color="#fff" />
                  </Pressable>
                  {/* Auto-renew with saved card is still available on iOS */}
                  {sub.hasAutoCharge && sub.subscriptionStatus !== 'active' && (
                    <View style={{ marginTop: 12 }}>
                      <Button
                        title={chargeMutation.isPending ? 'Charging…' : 'Charge saved card'}
                        variant="outline"
                        onPress={handleAutoCharge}
                        disabled={chargeMutation.isPending}
                      />
                    </View>
                  )}
                </View>
              </View>
            ) : (
              <>
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
              </>
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
  comingSoonBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  comingSoonTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    marginBottom: 4,
  },
  comingSoonBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  webPayBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  webPayTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    marginBottom: 4,
  },
  webPayBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  webPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1B5E20',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 6,
  },
  webPayBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#fff',
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
