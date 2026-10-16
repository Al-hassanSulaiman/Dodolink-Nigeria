import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { MessageProductPreview, MessageReplyPreview } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { getImageUrl } from '@/utils/storage';

/** The same compact card is used for replies and product enquiries. */
export function MessageQuote({ reply, product, userId, onDismiss, disabled = false }: {
  reply?: MessageReplyPreview | null; product?: MessageProductPreview | null;
  userId?: string | null; onDismiss?: () => void; disabled?: boolean;
}) {
  const colors = useColors();
  const [kind, setKind] = useState<'image' | 'video' | 'attachment'>('attachment');
  const [imageFailed, setImageFailed] = useState(false);
  const media = reply?.mediaUrl ? getImageUrl(reply.mediaUrl) : null;
  const thumbnail = product?.imageUrl ? getImageUrl(product.imageUrl) : media;

  useEffect(() => {
    setImageFailed(false);
    setKind('attachment');
    if (!media) return;
    let mounted = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // Opaque video URLs must not be fetched/decoded as full-size images.
    fetch(media, { method: 'HEAD', signal: controller.signal })
      .then(response => {
        if (!mounted || !response.ok) return;
        const mime = response.headers.get('content-type') ?? '';
        setKind(mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'attachment');
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { mounted = false; clearTimeout(timer); controller.abort(); };
  }, [media, product?.imageUrl]);

  if (!reply && !product) return null;
  const title = product ? 'Product' : reply?.senderId === userId ? 'You' : reply?.senderName ?? 'Reply';
  const description = product
    ? `${product.name} · ₦${product.price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
    : reply?.body || (media ? kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : 'Photo or video' : 'Message');
  const showImage = !!thumbnail && !imageFailed && (!!product || kind === 'image');
  return (
    <View testID={product ? 'product-quote' : 'message-quote'} style={{
      flexDirection: 'row', alignItems: 'center', gap: 9, padding: 9, borderRadius: 8,
      borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: colors.muted,
      shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 3,
      shadowOffset: { width: 0, height: 2 }, elevation: 2, minWidth: 150,
    }}>
      {showImage ? <Image pointerEvents="none" source={{ uri: thumbnail! }} contentFit="cover"
        onError={() => setImageFailed(true)} style={{ width: 44, height: 44, borderRadius: 5 }} />
        : (product || media) ? <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={product ? 'shopping-bag' : kind === 'video' ? 'video' : 'image'} size={23} color={colors.mutedForeground} />
        </View> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>{title}</Text>
        <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: 12 }}>{description}</Text>
      </View>
      {onDismiss && <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply"
        disabled={disabled} onPress={onDismiss} style={{ minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="x" size={19} color={colors.mutedForeground} />
      </Pressable>}
    </View>
  );
}
