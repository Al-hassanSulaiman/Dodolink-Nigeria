import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { showAlert } from '@/utils/alerts';

/** A customer rates a delivery company from 1 to 5 stars. One rating per company; it can be changed. */
export function RateCompanyModal({ visible, agentId, initial, onClose, onSaved }: {
  visible: boolean; agentId: number; initial: { stars: number; comment: string | null } | null;
  onClose: () => void; onSaved: () => void;
}) {
  const colors = useColors();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (visible) { setStars(initial?.stars ?? 0); setComment(initial?.comment ?? ''); } }, [visible, initial]);

  const save = async () => {
    if (!stars || saving) return;
    setSaving(true);
    try {
      await customFetch(`/api/delivery/agents/${agentId}/rating`, { method: 'POST', body: JSON.stringify({ stars, comment: comment.trim() }) });
      onSaved();
      onClose();
    } catch (err) {
      showAlert('Rating not saved', (err as { data?: { error?: string } })?.data?.error ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.back}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 17, marginBottom: 10 }}>Rate this company</Text>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
                <Feather name="star" size={34} color={n <= stars ? '#F59E0B' : colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Say a little about your experience (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={500}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}><Text style={{ color: colors.mutedForeground }}>Cancel</Text></Pressable>
            <Pressable onPress={save} disabled={!stars || saving} style={[styles.btn, { backgroundColor: colors.primary, opacity: !stars || saving ? 0.5 : 1 }]}>
              {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Save</Text>}
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
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 12 },
  input: { minHeight: 70, borderRadius: 12, padding: 12, textAlignVertical: 'top', fontSize: 15 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  btn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, minWidth: 80, alignItems: 'center' },
});
