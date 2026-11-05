import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';
import { ReportChatModal } from '@/components/ReportChatModal';

export type ContentTarget =
  | { type: 'store' | 'product' | 'review' | 'user'; id: string | number }
  | { type: 'chat'; chatKind: 'store' | 'delivery'; id: number };

/**
 * The "..." button on stores, products, reviews, people and chats.
 * Report: tells the DodoLink team, who act on it within 24 hours.
 * Block: hides that person's content from you straight away and stops them messaging you.
 */
export function ContentMenu({ target, blockUserId, personName, onBlocked, color, size = 22 }: {
  target: ContentTarget;
  /** The person who made the content (to block them). Omit for chats: the server finds them. */
  blockUserId?: string | null;
  personName: string;
  onBlocked?: () => void;
  color?: string;
  size?: number;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const sendReport = async () => {
    if (reason.trim().length < 5 || busy || target.type === 'chat') return;
    setBusy(true);
    try {
      await customFetch('/api/content-reports', {
        method: 'POST', body: JSON.stringify({ kind: target.type, targetId: String(target.id), reason: reason.trim() }),
      });
      setReason('');
      setReporting(false);
      showAlert('Thank you', 'DodoLink has your report and will review it within 24 hours.');
    } catch (err) {
      showAlert('Report not sent', (err as { data?: { error?: string } })?.data?.error ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const doBlock = async () => {
    try {
      await customFetch('/api/blocks', {
        method: 'POST',
        body: JSON.stringify(target.type === 'chat'
          ? { chatKind: target.chatKind, conversationId: target.id }
          : { userId: blockUserId }),
      });
      await queryClient.invalidateQueries();
      showAlert('Blocked', `${personName} can no longer message you, and you will not see their content. You can undo this in Account.`);
      onBlocked?.();
    } catch (err) {
      showAlert('Could not block', (err as { data?: { error?: string } })?.data?.error ?? 'Please try again.');
    }
  };

  const confirmBlock = () => {
    setMenu(false);
    Alert.alert(`Block ${personName}?`, 'You will not see their stores, products or reviews, and neither of you can message the other. DodoLink is told so we can check for abuse.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => { void doBlock(); } },
    ]);
  };

  const canBlock = target.type === 'chat' || !!blockUserId;

  return (
    <>
      <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Report or block">
        <Feather name="more-horizontal" size={size} color={color ?? colors.foreground} />
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.back} onPress={() => setMenu(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            <Pressable style={styles.row} onPress={() => { setMenu(false); if (target.type === 'chat') setReporting(true); else setReporting(true); }}>
              <Feather name="flag" size={18} color={colors.foreground} />
              <Text style={{ color: colors.foreground, fontSize: 16 }}>Report</Text>
            </Pressable>
            {canBlock && (
              <Pressable style={styles.row} onPress={confirmBlock}>
                <Feather name="slash" size={18} color="#C62828" />
                <Text style={{ color: '#C62828', fontSize: 16 }}>Block {personName}</Text>
              </Pressable>
            )}
            <Pressable style={styles.row} onPress={() => setMenu(false)}>
              <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {target.type === 'chat' ? (
        <ReportChatModal visible={reporting} kind={target.chatKind} conversationId={target.id} onClose={() => setReporting(false)} />
      ) : (
        <Modal visible={reporting} transparent animationType="fade" onRequestClose={() => setReporting(false)}>
          <View style={styles.back}>
            <View style={[styles.card, { backgroundColor: colors.background }]}>
              <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 6 }}>Report</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
                Tell us what is wrong. We review every report within 24 hours and remove content or people that break our rules.
              </Text>
              <TextInput
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
                placeholder="What is wrong with this?"
                placeholderTextColor={colors.mutedForeground}
                value={reason}
                onChangeText={setReason}
                multiline
                maxLength={1000}
              />
              <View style={styles.actions}>
                <Pressable onPress={() => setReporting(false)} style={styles.btn}><Text style={{ color: colors.mutedForeground }}>Cancel</Text></Pressable>
                <Pressable
                  onPress={sendReport}
                  disabled={reason.trim().length < 5 || busy}
                  style={[styles.btn, { backgroundColor: colors.primary, opacity: reason.trim().length < 5 || busy ? 0.5 : 1 }]}
                >
                  {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Send report</Text>}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { borderRadius: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  card: { borderRadius: 16, padding: 20 },
  input: { minHeight: 90, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, minWidth: 80, alignItems: 'center' },
});
