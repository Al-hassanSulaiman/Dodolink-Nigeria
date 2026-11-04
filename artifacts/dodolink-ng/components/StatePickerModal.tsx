import { Modal, View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useDeliveryStates } from '@/hooks/useDelivery';

export function StatePickerModal({ visible, title, selected, onSelect, onClose }: {
  visible: boolean; title: string; selected: string; onSelect: (state: string) => void; onClose: () => void;
}) {
  const colors = useColors();
  const states = useDeliveryStates();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 18 }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold', fontSize: 16 }}>Close</Text></Pressable>
        </View>
        <FlatList
          data={states.data ?? []}
          keyExtractor={s => s}
          renderItem={({ item }) => (
            <Pressable onPress={() => { onSelect(item); onClose(); }} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: item === selected ? 'Inter_700Bold' : 'Inter_400Regular' }}>{item}</Text>
              {item === selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 56 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
});
