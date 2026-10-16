import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import palettes from '@/constants/colors';

const colors = palettes.dark;
const MAX_ZOOM = 5;
function clamp(value: number, limit: number) {
  'worklet';
  return Math.max(-limit, Math.min(limit, value));
}

function ZoomPhoto({ uri }: { uri: string }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart(event => {
      startScale.value = scale.value;
      startX.value = x.value;
      startY.value = y.value;
      focalX.value = event.focalX - width.value / 2;
      focalY.value = event.focalY - height.value / 2;
    })
    .onUpdate(event => {
      const next = Math.max(1, Math.min(MAX_ZOOM, startScale.value * event.scale));
      const ratio = next / startScale.value;
      scale.value = next;
      x.value = clamp(startX.value * ratio + focalX.value * (1 - ratio), width.value * (next - 1) / 2);
      y.value = clamp(startY.value * ratio + focalY.value * (1 - ratio), height.value * (next - 1) / 2);
    });
  const pan = Gesture.Pan().maxPointers(1).minDistance(5)
    .onStart(() => { startX.value = x.value; startY.value = y.value; })
    .onUpdate(event => {
      x.value = clamp(startX.value + event.translationX, width.value * (scale.value - 1) / 2);
      y.value = clamp(startY.value + event.translationY, height.value * (scale.value - 1) / 2);
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd((_event, success) => {
    if (!success) return;
    scale.value = withTiming(scale.value > 1 ? 1 : 2);
    x.value = withTiming(0);
    y.value = withTiming(0);
  });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));
  const zoom = (change: number) => {
    const next = change === 0 ? 1 : Math.max(1, Math.min(MAX_ZOOM, scale.value + change));
    scale.value = withTiming(next);
    x.value = withTiming(clamp(x.value, width.value * (next - 1) / 2));
    y.value = withTiming(clamp(y.value, height.value * (next - 1) / 2));
  };

  return (
    <View style={styles.flex}>
      <View style={styles.photo} onLayout={event => {
        width.value = event.nativeEvent.layout.width;
        height.value = event.nativeEvent.layout.height;
        scale.value = 1; x.value = 0; y.value = 0;
      }}>
        {!failed && (
          <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)} touchAction="none">
            <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} collapsable={false}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain"
                onLoad={() => setLoading(false)}
                onError={() => { setLoading(false); setFailed(true); }}
                accessibilityLabel="Full photo. Pinch or double-tap to zoom." />
            </Animated.View>
          </GestureDetector>
        )}
        {loading && <ActivityIndicator pointerEvents="none" size="large" color={colors.foreground} />}
        {failed && <Text accessibilityRole="alert" style={styles.hint}>Could not load this photo. Close the preview and try again.</Text>}
      </View>
      <Text style={styles.hint}>Pinch or double-tap to zoom. Drag to move.</Text>
      <View style={styles.controls}>
        <Pressable disabled={loading || failed} accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => zoom(-0.5)} style={styles.control}>
          <Feather name="minus" size={24} color={colors.foreground} />
        </Pressable>
        <Pressable disabled={loading || failed} accessibilityRole="button" accessibilityLabel="Reset photo zoom" onPress={() => zoom(0)} style={styles.control}>
          <Text style={styles.label}>Reset</Text>
        </Pressable>
        <Pressable disabled={loading || failed} accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => zoom(0.5)} style={styles.control}>
          <Feather name="plus" size={24} color={colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

function Gallery({ uri, images }: { uri: string; images?: string[] }) {
  const sources = images?.length ? images : [uri];
  const [index, setIndex] = useState(Math.max(0, sources.indexOf(uri)));
  const safeIndex = Math.min(index, sources.length - 1);
  return (
    <View style={styles.flex}>
      <ZoomPhoto key={sources[safeIndex]} uri={sources[safeIndex]} />
      {sources.length > 1 && (
        <View style={styles.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous photo" disabled={safeIndex === 0} onPress={() => setIndex(safeIndex - 1)} style={[styles.control, safeIndex === 0 && styles.disabled]}>
            <Feather name="chevron-left" size={24} color={colors.foreground} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={styles.label}>{safeIndex + 1} / {sources.length}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next photo" disabled={safeIndex === sources.length - 1} onPress={() => setIndex(safeIndex + 1)} style={[styles.control, safeIndex === sources.length - 1 && styles.disabled]}>
            <Feather name="chevron-right" size={24} color={colors.foreground} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function PhotoPreview({ uri, images, title = 'Photo preview', onClose }: {
  uri: string | null; images?: string[]; title?: string; onClose: () => void;
}) {
  return (
    <Modal visible={!!uri} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.flex}>
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}>
            <Text numberOfLines={1} style={[styles.label, styles.flex]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close photo preview" onPress={onClose} style={styles.control}>
              <Feather name="x" size={26} color={colors.foreground} />
            </Pressable>
          </View>
          {uri && <Gallery key={uri} uri={uri} images={images} />}
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  label: { color: colors.foreground, fontSize: 16 },
  control: { minWidth: 48, height: 48, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  photo: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  hint: { color: colors.foreground, textAlign: 'center', padding: 12, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  disabled: { opacity: 0.3 },
});
