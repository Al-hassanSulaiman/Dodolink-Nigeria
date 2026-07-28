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
import { getImageUrl, uploadMediaToStorage } from '@/utils/storage';
import { showAlert } from '@/utils/alerts';

const SCREEN_WIDTH = Dimensions.get('window').width;
const MEDIA_WIDTH = SCREEN_WIDTH * 0.65;

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

  const { data: messages, isLoading } = useListMessages(id, {
    query: { enabled: !!id, queryKey: getListMessagesQueryKey(id) }
  });

  // Mark conversation as read when chat is opened
  useEffect(() => {
    if (!id) return;
    markConversationRead(id)
      .then(() => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }))
      .catch(() => {});
  }, [id]);

  const sendMessage = useSendMessage({
    mutation: {
      onSuccess: () => {
        setMessage('');
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(id) });
        inputRef.current?.focus();
      }
    }
  });

  const handleSend = () => {
    if (!message.trim() || !userId || !userName) return;
    sendMessage.mutate({ conversationId: id, data: {
      senderId: userId,
      senderName: senderName,
      senderType: senderType,
      body: message.trim(),
    }});
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

      sendMessage.mutate({ conversationId: id, data: {
        senderId: userId,
        senderName: senderName,
        senderType: senderType,
        body: '',
        mediaUrl,
      }});
    } catch (err: any) {
      showAlert('Upload failed', err?.message ?? 'Could not upload media. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  if (isLoading && !messages) return <LoadingScreen message="Loading messages..." />;

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.senderId === userId;
    const isVideo = !!item.mediaUrl && (
      item.mediaUrl.includes('chat-vid') ||
      item.mediaUrl.match(/\.(mp4|mov|avi|mkv|webm)$/i) !== null
    );

    return (
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
    );
  };

  const isBusy = uploading || sendMessage.isPending;

  return (
    <KeyboardControllerView style={[styles.container, { backgroundColor: colors.background }]} behavior="padding" keyboardVerticalOffset={100}>
      <Stack.Screen options={{ title: "Chat" }} />
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
        >
          <Feather name="send" size={20} color={message.trim() ? colors.primaryForeground : colors.mutedForeground} />
        </Pressable>
      </View>
    </KeyboardControllerView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 10,
    borderRadius: 16,
    marginBottom: 8,
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
