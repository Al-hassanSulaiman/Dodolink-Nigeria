import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import {
  useListMessages,
  useListConversations,
  useSendMessage,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  markConversationRead,
  useGetProduct,
} from '@workspace/api-client-react';
import type { Message } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingScreen } from '@/components/Loading';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView as KeyboardControllerView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getImageUrl, uploadMediaToStorage } from '@/utils/storage';
import { showAlert } from '@/utils/alerts';
import { useActiveScreen } from '@/hooks/useActiveScreen';
import { PhotoPreview } from '@/components/PhotoPreview';
import { ChatMedia } from '@/components/ChatMedia';
import { MessageQuote } from '@/components/MessageQuote';
import { SwipeReply } from '@/components/SwipeReply';

function CopyableMessage({ body, color }: { body: string; color: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (status !== 'copied') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  const copy = async () => {
    try {
      const success = await Clipboard.setStringAsync(body);
      setStatus(success ? 'copied' : 'failed');
    } catch {
      setStatus('failed');
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={[styles.messageText, { color }]}>{body}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy message" onPress={copy} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 5, minHeight: 36, paddingHorizontal: 6 }}>
        <Feather name={status === 'copied' ? 'check' : 'copy'} size={13} color={color} />
        <Text accessibilityLiveRegion="polite" style={{ color, fontSize: 11 }}>{status === 'copied' ? 'Copied' : 'Copy'}</Text>
      </Pressable>
      {status === 'failed' && <Text accessibilityRole="alert" style={{ color, fontSize: 12 }}>Could not access the clipboard. Select the message text to copy it.</Text>}
    </View>
  );
}

function mediaSendErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || message === 'undefined is not a function') {
    return 'We could not prepare that photo. Tap + to choose it again.';
  }
  if (/network request failed|failed to fetch/i.test(message)) {
    return 'Could not upload the photo. Check your connection, then tap + to try again.';
  }
  return `${message} Tap + to try again.`;
}

export default function ChatThreadScreen() {
  const { conversationId, productId: productParam } = useLocalSearchParams<{ conversationId: string; productId?: string }>();
  const id = parseInt(conversationId, 10);
  const colors = useColors();
  const { userId, userName, userEmail } = useUserIdentity();
  const active = useActiveScreen();

  // The composer includes drafts; the inbox deliberately excludes them.
  // Names are resolved by the server from store ownership, not the sender role.
  const { data: conversations } = useListConversations(
    { userId: userId ?? '', includeEmpty: true },
    { query: {
      enabled: !!userId,
      queryKey: getListConversationsQueryKey({ userId: userId ?? '', includeEmpty: true }),
      refetchInterval: active ? 10000 : false,
      refetchIntervalInBackground: false,
    } }
  );
  const conversation = conversations?.find(c => c.id === id);
  const isRetailer = !!conversation && conversation.customerId !== userId;
  const senderType = isRetailer ? ('retailer' as const) : ('customer' as const);
  const senderName = isRetailer
    ? (conversation?.storeName ?? userName)
    : (conversation?.customerName ?? userEmail ?? userName);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [productContextId, setProductContextId] = useState<number | null>(null);
  useEffect(() => {
    const value = Number(productParam);
    const valid = Number.isInteger(value) && value > 0 && value <= 2147483647;
    setProductContextId(valid ? value : null);
    if (valid) setReplyTo(null);
  }, [productParam, id]);
  useEffect(() => { setReplyTo(null); setMessage(''); }, [id]);
  const { data: contextProduct, isError: productError, refetch: retryProduct } = useGetProduct(productContextId ?? 0, {
    query: { enabled: !!productContextId && !!userId },
  });
  const productReady = !productContextId || (!!contextProduct && contextProduct.id === productContextId && contextProduct.storeId === conversation?.storeId);
  const productWrongStore = !!(productContextId && contextProduct && conversation && contextProduct.storeId !== conversation.storeId);
  const clearContext = () => {
    setReplyTo(null);
    setProductContextId(null);
    if (productParam) router.setParams({ productId: undefined });
  };
  const selectReply = (item: Message) => {
    setProductContextId(null);
    if (productParam) router.setParams({ productId: undefined });
    setReplyTo(item);
    inputRef.current?.focus();
  };
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput>(null);
  const lastPhotoSwipe = useRef({ id: -1, until: 0 });

  const { data: messages, isLoading, isError: messagesError, refetch: refetchMessages } = useListMessages(id, {
    query: { enabled: !!id && !!userId, queryKey: getListMessagesQueryKey(id), refetchInterval: active ? 10000 : false, refetchIntervalInBackground: false }
  });

  // Mark conversation as read when chat is opened
  useEffect(() => {
    if (!id) return;
    markConversationRead(id)
      .then(() => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }))
      .catch(() => {});
  }, [id]);

  const sendMessage = useSendMessage();

  const handleSend = () => {
    if (!message.trim() || !userId || !userName || !productReady || uploading || sendMessage.isPending) return;
    const submittedMessage = message.trim();
    sendMessage.mutate(
      { conversationId: id, data: {
        senderId: userId,
        senderName: senderName,
        senderType: senderType,
        body: submittedMessage,
        replyToMessageId: replyTo?.id,
        productId: productContextId,
      }},
      {
        onSuccess: async (sent) => {
          setMessage(current => current.trim() === submittedMessage ? '' : current);
          clearContext();
          await queryClient.cancelQueries({ queryKey: getListMessagesQueryKey(id) });
          queryClient.setQueryData<Message[]>(getListMessagesQueryKey(id), old =>
            old?.some(m => m.id === sent.id) ? old : [...(old ?? []), sent]);
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          inputRef.current?.focus();
        },
        onError: () => {
          showAlert('Message not sent', 'Something went wrong. Please check your connection and try again.');
        },
      }
    );
  };

  const handlePickMedia = async () => {
    if (!productReady || uploading || sendMessage.isPending) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permission needed', 'Please allow access to your media library to send photos and videos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.8,
      videoMaxDuration: 120, // 2 minutes max
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];

    if (!userId || !userName) return;

    setUploading(true);
    try {
      const isVideo = asset.type === 'video';
      const mimeType = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      const objectPath = await uploadMediaToStorage(
        asset.uri,
        mimeType,
        isVideo ? 'chat-vid' : 'chat-img'
      );
      const mediaUrl = getImageUrl(objectPath);

      // Use per-call onError only (no global onError on the hook for media path)
      await new Promise<void>((resolve, reject) => {
        sendMessage.mutate(
          { conversationId: id, data: { senderId: userId, senderName: senderName, senderType: senderType,
            body: '', mediaUrl, replyToMessageId: replyTo?.id, productId: productContextId } },
          {
            onSuccess: async (sent) => {
              clearContext();
              await queryClient.cancelQueries({ queryKey: getListMessagesQueryKey(id) });
              queryClient.setQueryData<Message[]>(getListMessagesQueryKey(id), old =>
                old?.some(m => m.id === sent.id) ? old : [...(old ?? []), sent]);
              queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
              resolve();
            },
            onError: (err: any) => reject(err),
          }
        );
      });
    } catch (err: any) {
      showAlert('Photo not sent', mediaSendErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  if (isLoading && !messages) return <LoadingScreen message="Loading messages..." />;
  if (messagesError && !messages) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.background }}>
      <Feather name="wifi-off" size={48} color={colors.mutedForeground} />
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.foreground, marginTop: 16, textAlign: 'center' }}>Couldn't load messages</Text>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.mutedForeground, marginTop: 8, textAlign: 'center' }}>Check your connection and try again.</Text>
      <Pressable onPress={() => refetchMessages()} style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 20 }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.primaryForeground }}>Try again</Text>
      </Pressable>
    </View>
  );

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.senderId === userId;
    return (
      <SwipeReply onReply={() => selectReply(item)}
        onGestureReply={() => {
          lastPhotoSwipe.current = { id: item.id, until: Date.now() + 500 };
          selectReply(item);
        }} disabled={isBusy} messageId={item.id} isMe={isMe}>
      <View style={isMe ? styles.myRow : styles.theirRow}>
        {!isMe && (
          <Text style={[styles.senderLabel, { color: colors.mutedForeground }]}>
            {item.senderName}
          </Text>
        )}
        <View style={[
          styles.messageBubble,
          isMe
            ? [styles.myMessage, { backgroundColor: colors.primary }]
            : [styles.theirMessage, { backgroundColor: colors.card, borderColor: colors.border }]
        ]}>
          {(item.replyPreview || item.productPreview) && <View style={{ marginBottom: 8 }}>
            <MessageQuote reply={item.replyPreview} product={item.productPreview} userId={userId} />
          </View>}
          {item.mediaUrl && <ChatMedia mediaUrl={item.mediaUrl} messageId={item.id}
            color={isMe ? colors.primaryForeground : colors.foreground} onViewPhoto={uri => {
              if (lastPhotoSwipe.current.id !== item.id || Date.now() >= lastPhotoSwipe.current.until) setPreviewUri(uri);
            }} />}
          {item.body ? (
            <View style={item.mediaUrl ? { marginTop: 6 } : undefined}>
              <CopyableMessage body={item.body} color={isMe ? colors.primaryForeground : colors.foreground} />
            </View>
          ) : null}
        </View>
      </View>
      </SwipeReply>
    );
  };

  const isBusy = uploading || sendMessage.isPending;

  return (
    // The navigation header handles the top inset. Reserve the bottom system
    // bar outside keyboard avoidance so it is not also added above the keyboard.
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>
    <KeyboardControllerView style={styles.container} behavior="padding" keyboardVerticalOffset={100}>
      <Stack.Screen options={{ title: isRetailer ? (conversation?.customerName ?? "Chat") : (conversation?.storeName ?? "Chat") }} />
      <FlatList
        data={messages ? [...messages].reverse() : []}
        inverted
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      />
      {(replyTo || productContextId) && <View style={{ paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.card }}>
        {replyTo
          ? <MessageQuote reply={{ ...replyTo, mediaUrl: replyTo.mediaUrl ?? null }} userId={userId} onDismiss={clearContext} disabled={isBusy} />
          : productReady && contextProduct
            ? <MessageQuote product={{ id: contextProduct.id, name: contextProduct.name, price: contextProduct.price,
                imageUrl: contextProduct.imageUrls?.[0] ?? contextProduct.imageUrl ?? null }}
                userId={userId} onDismiss={clearContext} disabled={isBusy} />
            : <View style={{ gap: 8, padding: 8 }}>
              <Text style={{ color: colors.foreground }}>{productWrongStore ? 'This product belongs to another store. Remove it to continue.' : productError ? 'Could not load the product preview.' : 'Loading product preview…'}</Text>
              {productError && <Pressable onPress={() => retryProduct()}><Text style={{ color: colors.primary }}>Retry product preview</Text></Pressable>}
              <Pressable onPress={clearContext} accessibilityLabel="Cancel reply"><Text style={{ color: colors.primary }}>Remove product</Text></Pressable>
            </View>}
      </View>}
      <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        {/* + media button */}
        <Pressable
          style={[styles.mediaButton, { backgroundColor: colors.muted }]}
          onPress={handlePickMedia}
          disabled={isBusy || !productReady}
          testID="chat-media-button"
        >
          {uploading
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="plus" size={22} color={colors.mutedForeground} />
          }
        </Pressable>

        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.input }]}
          placeholder="Type a message..."
          placeholderTextColor={colors.mutedForeground}
          value={message}
          onChangeText={setMessage}
          multiline
        />

        <Pressable
          style={[styles.sendButton, { backgroundColor: message.trim() ? colors.primary : colors.muted }]}
          onPress={handleSend}
          disabled={!message.trim() || isBusy || !productReady}
          testID="chat-send-button"
        >
          <Feather name="send" size={20} color={message.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </Pressable>
      </View>
    </KeyboardControllerView>
    <PhotoPreview uri={previewUri} onClose={() => setPreviewUri(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  myRow: {
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  theirRow: {
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  senderLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginBottom: 2,
    marginLeft: 4,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 16,
  },
  myMessage: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
  },
  messageText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    alignItems: 'flex-end',
    gap: 8,
  },
  mediaButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
