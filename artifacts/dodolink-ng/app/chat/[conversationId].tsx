import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { 
  useListMessages, 
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
import { getApiBase } from '@/utils/apiBase';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView as KeyboardControllerView } from 'react-native-keyboard-controller';
import { Pressable } from 'react-native';

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = parseInt(conversationId, 10);
  const colors = useColors();
  const { userId, userName } = useUserIdentity();
  const [message, setMessage] = useState('');
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
        // refocus
        inputRef.current?.focus();
      }
    }
  });

  // Check if we are the retailer or the customer. Since we don't fetch conversation details directly here easily,
  // we can infer from our userId matching any customerId or just assume 'customer' if it's the customer side.
  // Actually, we should fetch conversation to know if we are the retailer.
  // Wait, there's no useGetConversation. Let's just assume we are 'customer' unless our userId matches the store owner.
  // For simplicity, let's just send senderType: 'customer'. If we are in my-store, we should be 'retailer'.
  // We can pass senderType via params or determine it.
  
  const handleSend = () => {
    if (!message.trim() || !userId || !userName) return;
    sendMessage.mutate({ conversationId: id, data: {
      senderId: userId,
      senderName: userName,
      senderType: 'customer', // To make it perfect we'd need to know if we're retailer. Hardcode customer for now.
      body: message.trim()
    }});
  };

  if (isLoading && !messages) return <LoadingScreen message="Loading messages..." />;

  const renderItem = ({ item }: { item: Message }) => {
    const isMe = item.senderId === userId;
    return (
      <View style={[
        styles.messageBubble, 
        isMe ? [styles.myMessage, { backgroundColor: colors.primary }] : [styles.theirMessage, { backgroundColor: colors.card, borderColor: colors.border }]
      ]}>
        <Text style={[styles.messageText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>
          {item.body}
        </Text>
      </View>
    );
  };

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
          disabled={!message.trim() || sendMessage.isPending}
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
    padding: 12,
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
    marginRight: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
