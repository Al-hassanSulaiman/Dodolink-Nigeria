import { StyleSheet, View, Text, FlatList, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { useListConversations, getListConversationsQueryKey } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { LoadingScreen } from '@/components/Loading';
import { EmptyState } from '@/components/EmptyState';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { Feather } from '@expo/vector-icons';
import { RequireAccount } from '@/components/RequireAccount';
import { useActiveScreen } from '@/hooks/useActiveScreen';

export default function ChatsScreen() {
  const colors = useColors();
  const { userId } = useUserIdentity();
  const active = useActiveScreen();

  const { data: conversations, isLoading } = useListConversations({ userId: userId || '' }, {
    query: {
      enabled: !!userId,
      queryKey: getListConversationsQueryKey({ userId: userId || '' }),
      refetchInterval: active ? 10000 : false,
      refetchIntervalInBackground: false,
    }
  });
  if (!userId) return <RequireAccount />;

  if (isLoading && !conversations) return <LoadingScreen message="Loading chats..." />;

  if (!conversations || conversations.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <EmptyState 
          icon="message-square" 
          title="No messages yet" 
          description="Your chats will appear here once a message is sent."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Chats</Text>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => {
          // If the current user is the customer in this conversation, show the store name.
          // Otherwise show the customer's server-resolved store/account name.
          const isCustomer = item.customerId === userId;
          const displayName = isCustomer ? item.storeName : item.customerName;

          return (
            <Link href={`/chat/${item.id}`} asChild>
              <Pressable style={StyleSheet.flatten([styles.chatItem, { borderBottomColor: colors.border }])}>
                <ImagePlaceholder name={displayName} size={48} borderRadius={24} />
                <View style={styles.chatInfo}>
                  <Text style={[styles.chatName, { color: colors.foreground }]} numberOfLines={1}>
                    {displayName}
                  </Text>
                  {item.lastMessage ? (
                    <Text style={[styles.lastMessage, { color: item.unreadCount > 0 ? colors.foreground : colors.mutedForeground, fontFamily: item.unreadCount > 0 ? 'Inter_600SemiBold' : 'Inter_400Regular' }]} numberOfLines={1}>
                      {item.lastMessage}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rightCol}>
                  {item.unreadCount > 0 ? (
                    <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
                        {item.unreadCount > 99 ? '99+' : item.unreadCount}
                      </Text>
                    </View>
                  ) : (
                    <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                  )}
                </View>
              </Pressable>
            </Link>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  chatInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  chatName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    marginBottom: 4,
  },
  lastMessage: {
    fontSize: 14,
  },
  rightCol: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
});
