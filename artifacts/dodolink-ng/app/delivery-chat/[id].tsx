import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable, ActivityIndicator, Image as RNImage } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView as KeyboardControllerView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useActiveScreen } from '@/hooks/useActiveScreen';
import { LoadingScreen } from '@/components/Loading';
import { PhotoPreview } from '@/components/PhotoPreview';
import { ChatMedia } from '@/components/ChatMedia';
import { MessageQuote } from '@/components/MessageQuote';
import { SwipeReply } from '@/components/SwipeReply';
import { ReportChatModal } from '@/components/ReportChatModal';
import { RateCompanyModal } from '@/components/RateCompanyModal';
import { getImageUrl, uploadMediaToStorage } from '@/utils/storage';
import { showAlert } from '@/utils/alerts';
import { useDeliveryThread, coverageLine, deliveryTypeLabel, ratingLine, type DeliveryMessage } from '@/hooks/useDelivery';

// The delivery chat works exactly like the store chat: photos, videos, swipe to reply, copy.

function CopyableMessage({ body, color }: { body: string; color: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try { setCopied(await Clipboard.setStringAsync(body)); } catch { setCopied(false); }
  };
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={[styles.messageText, { color }]}>{body}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={copy} style={styles.copyBtn}>
        <Feather name={copied ? 'check' : 'copy'} size={13} color={color} />
        <Text style={{ color, fontSize: 11 }}>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
    </View>
  );
}

function sendErrorMessage(error: unknown): string {
  const fromServer = (error as { data?: { error?: string } })?.data?.error;
  if (fromServer) return fromServer;
  const message = error instanceof Error ? error.message.trim() : '';
  if (/network request failed|failed to fetch/i.test(message)) return 'Check your connection, then try again.';
  return message || 'Please try again.';
}

export default function DeliveryChatScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number.parseInt(String(params.id ?? ''), 10) || null;
  const colors = useColors();
  const active = useActiveScreen();
  const queryClient = useQueryClient();
  const thread = useDeliveryThread(id, active ? 5000 : false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<DeliveryMessage | null>(null);
  const [reporting, setReporting] = useState(false);
  const [rating, setRating] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const lastPhotoSwipe = useRef({ id: -1, until: 0 });
  const count = thread.data?.messages.length ?? 0;

  useEffect(() => { setReplyTo(null); setText(''); setPendingMedia(null); }, [id]);

  // Mark messages read whenever new ones arrive while the screen is open.
  useEffect(() => {
    if (!id || !thread.data || !active) return;
    customFetch(`/api/delivery/conversations/${id}/read`, { method: 'POST' })
      .then(() => queryClient.invalidateQueries({ queryKey: ['delivery', 'inbox'] }))
      .catch(() => undefined);
  }, [id, count, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (payload: { body: string; mediaUrl?: string }) => {
    await customFetch(`/api/delivery/conversations/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ ...payload, replyToMessageId: replyTo?.id }),
    });
    setReplyTo(null);
    await queryClient.invalidateQueries({ queryKey: ['delivery'] });
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !id || sending) return;
    setSending(true);
    try {
      await post({ body });
      setText(current => (current.trim() === body ? '' : current));
      inputRef.current?.focus();
    } catch (err) {
      showAlert('Message not sent', sendErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const pickMedia = async () => {
    if (sending) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow access to your media library to send photos and videos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.6,
      exif: false,
      ...(ImagePicker.VideoExportPreset?.H264_1280x720 !== undefined
        ? { videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720 } : {}),
      videoMaxDuration: 120,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;
    setPendingMedia(result.assets[0]);
  };

  const sendPendingMedia = async () => {
    const asset = pendingMedia;
    if (!asset || !id || sending) return;
    setSending(true);
    try {
      const isVideo = asset.type === 'video';
      const objectPath = await uploadMediaToStorage(asset.uri, asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'), isVideo ? 'chat-vid' : 'chat-img');
      await post({ body: '', mediaUrl: getImageUrl(objectPath) });
      setPendingMedia(null);
    } catch (err) {
      showAlert('Photo not sent', `${sendErrorMessage(err)} Tap + to try again.`);
    } finally {
      setSending(false);
    }
  };

  if (!id) return <LoadingScreen message="Chat not found" />;
  if (thread.isLoading && !thread.data) return <LoadingScreen message="Loading chat..." />;
  if (thread.isError || !thread.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>This chat could not be loaded.</Text>
      </View>
    );
  }
  const data = thread.data;
  const myUserId = data.messages.find(m => m.mine)?.senderId ?? null;

  const renderItem = ({ item }: { item: DeliveryMessage }) => {
    const isMe = item.mine;
    const color = isMe ? colors.primaryForeground : colors.foreground;
    return (
      <SwipeReply
        onReply={() => { setReplyTo(item); inputRef.current?.focus(); }}
        onGestureReply={() => { lastPhotoSwipe.current = { id: item.id, until: Date.now() + 500 }; setReplyTo(item); inputRef.current?.focus(); }}
        disabled={sending} messageId={item.id} isMe={isMe}>
        <View style={isMe ? styles.myRow : styles.theirRow}>
          {!isMe && (
            <Text style={[styles.senderLabel, { color: item.senderType === 'support' ? colors.primary : colors.mutedForeground }]}>
              {item.senderType === 'support' ? 'DodoLink Support' : item.senderName}
            </Text>
          )}
          <View style={[styles.bubble, isMe ? [styles.myMessage, { backgroundColor: colors.primary }] : [styles.theirMessage, { backgroundColor: colors.card, borderColor: colors.border }]]}>
            {item.replyPreview ? (
              <View style={{ marginBottom: 8 }}>
                <MessageQuote reply={item.replyPreview} userId={myUserId} />
              </View>
            ) : null}
            {item.mediaUrl ? (
              <ChatMedia mediaUrl={item.mediaUrl} messageId={item.id} color={color} onViewPhoto={uri => {
                if (lastPhotoSwipe.current.id !== item.id || Date.now() >= lastPhotoSwipe.current.until) setPreviewUri(uri);
              }} />
            ) : null}
            {item.body ? (
              <View style={item.mediaUrl ? { marginTop: 6 } : undefined}>
                <CopyableMessage body={item.body} color={color} />
              </View>
            ) : null}
          </View>
        </View>
      </SwipeReply>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>
      <KeyboardControllerView style={styles.container} behavior="padding" keyboardVerticalOffset={100}>
        <Stack.Screen options={{
          title: data.title,
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              {data.role === 'customer' && data.canRate ? (
                <Pressable onPress={() => setRating(true)} hitSlop={8} accessibilityLabel="Rate this company">
                  <Feather name="star" size={20} color="#1B5E20" />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setReporting(true)} hitSlop={8} accessibilityLabel="Report a problem">
                <Feather name="flag" size={20} color="#1B5E20" />
              </Pressable>
            </View>
          ),
        }} />
        {data.role === 'customer' && (
          <View style={[styles.banner, { backgroundColor: colors.secondary }]}>
            <Text style={{ color: colors.secondaryForeground, fontSize: 13 }}>
              {deliveryTypeLabel[data.agent.deliveryType]} · {ratingLine(data.agent)} · Delivers: {coverageLine(data.agent) || 'ask in chat'}
            </Text>
          </View>
        )}
        <FlatList
          data={[...data.messages].reverse()}
          inverted
          keyExtractor={m => m.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={data.messages.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginVertical: 40, transform: [{ scaleY: -1 }] }}>
              Say hello and describe what you want delivered, and where from and to.
            </Text>
          ) : null}
        />
        {replyTo ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.card }}>
            <MessageQuote reply={{ ...replyTo, mediaUrl: replyTo.mediaUrl ?? null }} userId={myUserId} onDismiss={() => setReplyTo(null)} disabled={sending} />
          </View>
        ) : null}
        {pendingMedia && (
          <View style={[styles.pendingRow, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            {pendingMedia.type === 'video'
              ? <View style={[styles.pendingThumb, { backgroundColor: colors.muted }]}><Feather name="video" size={24} color={colors.mutedForeground} /></View>
              : <RNImage source={{ uri: pendingMedia.uri }} style={styles.pendingThumb} />}
            <Text style={{ flex: 1, color: colors.foreground }} numberOfLines={1}>
              {pendingMedia.type === 'video' ? 'Video ready to send' : 'Photo ready to send'}
            </Text>
            <Pressable onPress={() => setPendingMedia(null)} disabled={sending} style={styles.pendingButton}>
              <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={sendPendingMedia} disabled={sending} style={[styles.pendingButton, { backgroundColor: colors.primary, opacity: sending ? 0.6 : 1 }]}>
              {sending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }}>Send</Text>}
            </Pressable>
          </View>
        )}
        <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <Pressable style={[styles.roundBtn, { backgroundColor: colors.muted }]} onPress={pickMedia} disabled={sending}>
            <Feather name="plus" size={22} color={colors.mutedForeground} />
          </Pressable>
          <TextInput
            ref={inputRef}
            style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.input }]}
            placeholder="Type a message..."
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.roundBtn, { backgroundColor: text.trim() ? colors.primary : colors.muted }]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            <Feather name="send" size={20} color={text.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </Pressable>
        </View>
      </KeyboardControllerView>
      <PhotoPreview uri={previewUri} onClose={() => setPreviewUri(null)} />
      <ReportChatModal visible={reporting} kind="delivery" conversationId={id} onClose={() => setReporting(false)} />
      <RateCompanyModal
        visible={rating}
        agentId={data.agent.id}
        initial={data.myRating}
        onClose={() => setRating(false)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['delivery'] })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  listContent: { padding: 16 },
  myRow: { alignItems: 'flex-end', marginBottom: 8 },
  theirRow: { alignItems: 'flex-start', marginBottom: 8 },
  senderLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, marginBottom: 2, marginLeft: 4 },
  bubble: { maxWidth: '80%', padding: 10, borderRadius: 16 },
  myMessage: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirMessage: { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: 1 },
  messageText: { fontFamily: 'Inter_400Regular', fontSize: 16 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5, minHeight: 36, paddingHorizontal: 6 },
  inputContainer: { flexDirection: 'row', padding: 12, borderTopWidth: 1, alignItems: 'flex-end', gap: 8 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 100, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontFamily: 'Inter_400Regular', fontSize: 16 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  pendingThumb: { width: 52, height: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pendingButton: { minWidth: 72, height: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
