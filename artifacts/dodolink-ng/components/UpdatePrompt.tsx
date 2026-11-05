import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { customFetch } from '@workspace/api-client-react';

import { useColors } from '@/hooks/useColors';

const DISMISSED_KEY = 'dodolink.update.dismissedBuild.v1';

function installedBuild(): number | null {
  const cfg = Constants.expoConfig;
  const raw = Platform.OS === 'ios' ? cfg?.ios?.buildNumber : cfg?.android?.versionCode;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Asks the server once at launch whether a newer build exists; "Later" hides it for that build. */
export default function UpdatePrompt() {
  const colors = useColors();
  const [info, setInfo] = useState<{ latestBuild: number; storeUrl: string } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    const mine = installedBuild();
    if (mine === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await customFetch<{ latestBuild: number; storeUrl: string }>(`/api/app-version?platform=${Platform.OS}`);
        if (cancelled || !(res.latestBuild > mine)) return;
        let dismissed = 0;
        try { dismissed = Number(await AsyncStorage.getItem(DISMISSED_KEY)) || 0; } catch { /* ignore */ }
        if (dismissed >= res.latestBuild) return;
        setInfo(res);
      } catch {
        // Offline or server busy: never bother the user about a failed check.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!info) return null;
  const later = () => {
    AsyncStorage.setItem(DISMISSED_KEY, String(info.latestBuild)).catch(() => undefined);
    setInfo(null);
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={later}>
      <View style={styles.back}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 18, marginBottom: 6 }}>Update available</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 14, marginBottom: 16 }}>
            A new version of Dodolink NG is ready with improvements and fixes. Update now to keep everything running smoothly.
          </Text>
          <Pressable style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => { void Linking.openURL(info.storeUrl); }}>
            <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Update now</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={later}>
            <Text style={{ color: colors.mutedForeground }}>Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  card: { borderRadius: 16, padding: 20 },
  btn: { alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
});
