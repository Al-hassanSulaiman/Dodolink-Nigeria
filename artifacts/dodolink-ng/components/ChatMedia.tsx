import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Platform, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { getImageUrl } from '@/utils/storage';
import { chatMediaInfo } from '@/utils/chatMediaInfo';
import { saveChatMedia } from '@/utils/saveChatMedia';

const WIDTH = Dimensions.get('window').width * 0.65;

function Video({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, instance => { instance.loop = false; });
  return <VideoView player={player} style={{ width: WIDTH, aspectRatio: 16 / 9, borderRadius: 8 }} nativeControls />;
}

export function ChatMedia({ mediaUrl, messageId, color, onViewPhoto }: {
  mediaUrl: string; messageId: number; color: string; onViewPhoto: (url: string) => void;
}) {
  const uri = getImageUrl(mediaUrl);
  const [contentType, setContentType] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'started' | null>(null);
  const [error, setError] = useState('');
  const { video } = chatMediaInfo(uri, contentType);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    setContentType('');
    fetch(uri, { method: 'HEAD', signal: controller.signal })
      .then(response => { if (response.ok) setContentType(response.headers.get('content-type') ?? ''); })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [uri]);

  const download = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    setResult(null);
    try {
      setResult(await saveChatMedia(uri, messageId, contentType));
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== 'AbortError'
        ? reason.message : 'Download timed out. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 6, maxWidth: WIDTH }}>
      {video ? <Video uri={uri} /> : (
        <Pressable accessibilityRole="button" accessibilityLabel="View full photo" onPress={() => onViewPhoto(uri)}>
          <Image pointerEvents="none" source={{ uri }} style={{ width: WIDTH, aspectRatio: 1, borderRadius: 8 }} contentFit="cover" />
        </Pressable>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel={video ? 'Download video' : 'Download photo'}
        accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={download}
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 6, minHeight: 44, paddingHorizontal: 8 }}>
        {saving ? <ActivityIndicator size="small" color={color} /> : <Feather name="download" size={17} color={color} />}
        <Text style={{ color, fontSize: 12 }}>{saving ? 'Saving…' : video ? 'Download video' : 'Download photo'}</Text>
      </Pressable>
      {result && <Text accessibilityLiveRegion="polite" style={{ color, fontSize: 12 }}>
        {result === 'saved' ? 'Saved to your photos/videos.' : 'Download started. If your preview blocks it, open the app in a browser tab.'}
      </Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color, fontSize: 12 }}>{error}</Text>}
      {Platform.OS !== 'web' && saving && <Text style={{ color, fontSize: 12 }}>Please keep this screen open until saving finishes.</Text>}
    </View>
  );
}
