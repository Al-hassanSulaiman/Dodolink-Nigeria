import { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TextInput, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import {
  useListSupportMessages,
  useSendSupportMessage,
  getListSupportMessagesQueryKey,
  markSupportRead,
} from '@workspace/api-client-react';
import type { SupportMessage } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingScreen } from '@/components/Loading';
import { Feather } from '@expo/vector-icons';
import { KeyboardAvoidingView as KeyboardControllerView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RequireAccount } from '@/components/RequireAccount';
import { useActiveScreen } from '@/hooks/useActiveScreen';

export default function SupportScreen() {
  return <RequireAccount><SupportContent /></RequireAccount>;
}

function SupportContent() {
  const colors = useColors();
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput>(null);
  const active = useActiveScreen();

  const { data: messages, isLoading } = useListSupportMessages({
    query: {
      queryKey: getListSupportMessagesQueryKey(),
      refetchInterval: active ? 15000 : false,
      refetchIntervalInBackground: false,
    },
  });

  // Mark admin replies as read when the screen is opened
  useEffect(() => {
    markSupportRead()
      .then(() => queryClient.invalidateQueries({ queryKey: getListSupportMessagesQueryKey() }))
      .catch(() => {});
  }, []);

  const sendSupportMessage = useSendSupportMessage({
    mutation: {
      onSuccess: () => {
        setMessage('');
        queryClient.invalidateQueries({ queryKey: getListSupportMessagesQueryKey() });
        inputRef.current?.focus();
      },
    },
  });

  const handleSend = () => {
    if (!message.trim() || sendSupportMessage.isPending) return;
    sendSupportMessage.mutate({ data: { body: message.trim() } });
  };

  if (isLoading && !messages) return <LoadingScreen message="Loading support..." />;

  const renderItem = ({ item }: { item: SupportMessage }) => {
    const isMe = item.senderRole === 'user';
    return (
      <View style={styles.messageRow}>
        {!isMe && (
          <Text style={[styles.senderLabel, { color: colors.mutedForeground }]}>Dodolink Support</Text>
        )}
        <View
          style={[
            styles.messageBubble,
            isMe
              ? [styles.myMessage, { backgroundColor: colors.primary }]
              : [styles.theirMessage, { backgroundColor: colors.card, borderColor: colors.border }],
          ]}
        >
          <Text style={[styles.messageText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>
            {item.body}
          </Text>
        </View>
      </View>
    );
  };

  const hasMessages = !!messages && messages.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom', 'left', 'right']}>
    <KeyboardControllerView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={100}
    >
      <Stack.Screen options={{ title: 'Support' }} />
      {hasMessages ? (
        <FlatList
          data={[...messages].reverse()}
          inverted
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="help-circle" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>How can we help?</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Send us a message about anything — orders, your store, payments, or problems with the app. Our team will
            reply right here.
          </Text>
        </View>
      )}
      <View style={[styles.inputContainer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.input }]}
          placeholder="Type your message..."
          placeholderTextColor={colors.mutedForeground}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={2000}
        />
        <Pressable
          style={[styles.sendButton, { backgroundColor: message.trim() ? colors.primary : colors.muted }]}
          onPress={handleSend}
          disabled={!message.trim() || sendSupportMessage.isPending}
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
  messageRow: {
    marginBottom: 8,
  },
  senderLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginBottom: 2,
    marginLeft: 4,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 20,
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
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
