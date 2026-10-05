import { useListConversations, getListConversationsQueryKey } from '@workspace/api-client-react';
import { useUserIdentity } from './useUserIdentity';

export function useUnreadCount(): number {
  const { userId } = useUserIdentity();

  const { data: conversations } = useListConversations(
    { userId: userId || '' },
    {
      query: {
        enabled: !!userId,
        refetchInterval: 60000,
        refetchIntervalInBackground: false,
        staleTime: 30000,
        queryKey: getListConversationsQueryKey({ userId: userId || '' }),
      },
    }
  );

  if (!conversations) return 0;
  return conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
}
