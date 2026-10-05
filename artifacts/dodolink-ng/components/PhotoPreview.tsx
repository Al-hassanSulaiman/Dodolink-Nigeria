import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export function PhotoPreview({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoading(true);
    setFailed(false);
  }, [uri]);

  return (
    <Modal visible={!!uri} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Photo preview</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo preview" onPress={onClose} style={styles.close}>
            <Feather name="x" size={26} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.photo}>
          {uri && !failed && (
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              accessibilityLabel="Full photo"
            />
          )}
          {loading && <ActivityIndicator size="large" color="#fff" />}
          {failed && <Text accessibilityRole="alert" style={styles.error}>Could not load this photo. Close the preview and try again.</Text>}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 16 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  photo: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fff', textAlign: 'center', padding: 24 },
});
