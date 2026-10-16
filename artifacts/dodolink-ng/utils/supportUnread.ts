import type { SupportMessage } from '@workspace/api-client-react';

type ReadState = Pick<SupportMessage, 'id' | 'senderRole' | 'readByUser'>;

export function getUnreadSupportMessageIds(messages: readonly ReadState[]): number[] {
  return messages.filter(message => message.senderRole === 'admin' && !message.readByUser)
    .map(message => message.id);
}
