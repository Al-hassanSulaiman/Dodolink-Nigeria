import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import {
  useListMessages,
  useListConversations,
  useSendMessage,
  getListMessagesQueryKey,
  getListConversationsQueryKey,
  markConversationRead,
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

const SCREEN_WIDTH = Dimensions.get('window').width;
const MEDIA_WIDTH = SCREEN_WIDTH * 0.65;

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

// Small component so each video gets its own player instance
function VideoBubble({ uri, isMe, colors }: { uri: string; isMe: boolean; colors: ReturnType<typeof useColors> }) {
  const player = useVideoPlayer(uri, p => { p.loop = false; });
  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', width: MEDIA_WIDTH, aspectRatio: 16 / 9 }}>
      <VideoView
        player={player}
        style={{ width: '100%', height: '100%' }}
        nativeControls
      />
    </View>
  );
}

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = parseInt(conversationId, 10);
  const colors = useColors();
  const { userId, userName, userEmail } = useUserIdentity();

  // Find this conversation from the cached list so we know the user's role.
  // If they are the customer → send with their email; if they are the store
  // owner (retailer) → send with the store name.
  const { data: conversations } = useListConversations(
    { userId: userId ?? '' },
    { query: { enabled: !!userId, queryKey: getListConversationsQueryKey({ userId: userId ?? '' }) } }
  );
  const conversation = conversations?.find(c => c.id === id);
  const isRetailer = !!conversation && conversation.customerId !== userId;
  const senderType = isRetailer ? ('retailer' as const) : ('customer' as const);
  const senderName = isRetailer
    ? (conversation?.storeName ?? userName)
    : (userEmail ?? userName);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput>(null);
  const active = useActiveScreen();

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
    if (!message.trim() || !userId || !userName) return;
    const submittedMessage = message.trim();
    sendMessage.mutate(
      { conversationId: id, data: {
        senderId: userId,
        senderName: senderName,
        senderType: senderType,
        body: submittedMessage,
      }},
      {
        onSuccess: async (sent) => {
          setMessage(current => current.trim() === submittedMessage ? '' : current);
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
          { conversationId: id, data: { senderId: userId, senderName: senderName, senderType: senderType, body: '', mediaUrl } },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(id) });
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
    const isVideo = !!item.mediaUrl && (
      item.mediaUrl.includes('chat-vid') ||
      item.mediaUrl.match(/\.(mp4|mov|avi|mkv|webm)$/i) !== null
    );

    return (
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
          {item.mediaUrl ? (
            isVideo ? (
              <VideoBubble uri={item.mediaUrl} isMe={isMe} colors={colors} />
            ) : (
              <Image
                source={{ uri: item.mediaUrl }}
                style={{ width: MEDIA_WIDTH, aspectRatio: 1, borderRadius: 8 }}
                contentFit="cover"
              />
            )
          ) : null}
          {item.body ? (
            <Text style={[
              styles.messageText,
              { color: isMe ? colors.primaryForeground : colors.foreground },
              item.mediaUrl ? { marginTop: 6 } : null,
            ]}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </View>
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
      <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        {/* + media button */}
        <Pressable
          style={[styles.mediaButton, { backgroundColor: colors.muted }]}
          onPress={handlePickMedia}
          disabled={isBusy}
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
          disabled={!message.trim() || isBusy}
          testID="chat-send-button"
        >
          <Feather name="send" size={20} color={message.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </Pressable>
      </View>
    </KeyboardControllerView>
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
