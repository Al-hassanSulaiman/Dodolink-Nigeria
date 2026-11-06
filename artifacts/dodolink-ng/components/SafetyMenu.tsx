import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { confirmAlert, showAlert } from '@/utils/alerts';

/** Report window for a store, a product or a person (App Store guideline 1.2). */
export function ReportContentModal({ visible, targetType, targetId, targetLabel, onClose }: {
  visible: boolean; targetType: 'store' | 'product' | 'user'; targetId: string | number; targetLabel: string; onClose: () => void;
}) {
  const colors = useColors();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 5 || sending) return;
    setSending(true);
    try {
      await customFetch('/api/content-reports', {
        method: 'POST',
        body: JSON.stringify({ targetType, targetId: String(targetId), targetLabel, reason: reason.trim() }),
      });
      setReason('');
      onClose();
      showAlert('Thank you', 'We received your report. Our team reviews every report within 24 hours and removes anything that breaks our rules.');
    } catch (err) {
      showAlert('Report not sent', (err as { data?: { error?: string } })?.data?.error ?? 'Please sign in and try again.');
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 6 }}>Report</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
            Why are you reporting {targetLabel || 'this'}? Offensive, abusive, fake or illegal content is not allowed on DodoLink.
          </Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="What is wrong?"
            placeholderTextColor={colors.mutedForeground}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1000}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}><Text style={{ color: colors.mutedForeground }}>Cancel</Text></Pressable>
            <Pressable
              onPress={submit}
              disabled={reason.trim().length < 5 || sending}
              style={[styles.btn, { backgroundColor: colors.primary, opacity: reason.trim().length < 5 || sending ? 0.5 : 1 }]}
            >
              {sending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Send report</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One "report or block" menu for any screen. `open()` shows the choices;
 * render `element` once in the screen so the report window can appear.
 */
export function useSafetyMenu(opts: {
  targetType: 'store' | 'product' | 'user';
  targetId: string | number;
  targetLabel: string;
  /** Person to block. Leave out when there is nobody to block (the owner is you, or unknown). */
  blockUserId?: string | null;
  /** Replaces the report window, e.g. the chat's own report window. */
  onReport?: () => void;
  onBlocked?: () => void;
}): { open: () => void; element: ReactElement } {
  const queryClient = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const { targetType, targetId, targetLabel, blockUserId, onReport, onBlocked } = opts;

  const report = () => (onReport ? onReport() : setReporting(true));

  const block = () => {
    if (!blockUserId) return;
    confirmAlert({
      title: `Block ${targetLabel || 'this user'}?`,
      message: 'You will no longer see their stores, products or messages, and they cannot message you. We are also told so we can review them. You can unblock in Account settings.',
      confirmText: 'Block',
      destructive: true,
      onConfirm: async () => {
        try {
          await customFetch('/api/blocks', {
            method: 'POST',
            body: JSON.stringify({ userId: blockUserId, name: targetLabel }),
          });
          await queryClient.invalidateQueries();
          showAlert('Blocked', `${targetLabel || 'This user'} is blocked. Their content is removed from your feed.`);
          onBlocked?.();
        } catch (err) {
          showAlert('Could not block', (err as { data?: { error?: string } })?.data?.error ?? 'Please sign in and try again.');
        }
      },
    });
  };

  const open = () => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      if (window.confirm(`Report ${targetLabel || 'this'}?`)) { report(); return; }
      if (blockUserId && window.confirm(`Block ${targetLabel || 'this user'} instead?`)) block();
      return;
    }
    Alert.alert('Report or block', targetLabel || undefined, [
      { text: 'Report', onPress: report },
      ...(blockUserId ? [{ text: 'Block user', style: 'destructive' as const, onPress: block }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const element = (
    <ReportContentModal
      visible={reporting}
      targetType={targetType}
      targetId={targetId}
      targetLabel={targetLabel}
      onClose={() => setReporting(false)}
    />
  );
  return { open, element };
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 16, padding: 20 },
  input: { minHeight: 90, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, minWidth: 80, alignItems: 'center' },
});
