import { useListConversations } from '@workspace/api-client-react';
import { useUserIdentity } from './useUserIdentity';

export function useUnreadCount(): number {
  const { userId } = useUserIdentity();

  const { data: conversations } = useListConversations(
    { userId: userId || '' },
    {
      query: {
        enabled: !!userId,
        refetchInterval: 15000,
        staleTime: 10000,
      },
    }
  );

  if (!conversations) return 0;
  return conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
}
