import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';

/** "Report a problem" for a store chat or a delivery chat. Support reads the chat only after a report. */
export function ReportChatModal({ visible, kind, conversationId, onClose }: {
  visible: boolean; kind: 'store' | 'delivery'; conversationId: number; onClose: () => void;
}) {
  const colors = useColors();
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 5 || sending) return;
    setSending(true);
    try {
      await customFetch('/api/reports', { method: 'POST', body: JSON.stringify({ kind, conversationId, reason: reason.trim() }) });
      setReason('');
      onClose();
      showAlert('Thank you', 'DodoLink support has your report and will look into it.');
    } catch (err) {
      showAlert('Report not sent', (err as { data?: { error?: string } })?.data?.error ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 6 }}>Report a problem</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginBottom: 8 }}>
            Tell us what went wrong. DodoLink support can read this conversation once a problem is reported.
          </Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="What went wrong?"
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

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 16, padding: 20 },
  input: { minHeight: 90, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, minWidth: 80, alignItems: 'center' },
});
