import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUnreadSupportMessageIds } from './supportUnread.ts';

test('only unopened admin replies contribute to the support badge', () => {
  assert.deepEqual(getUnreadSupportMessageIds([
    { id: 1, senderRole: 'user', readByUser: false },
    { id: 2, senderRole: 'admin', readByUser: true },
    { id: 3, senderRole: 'admin', readByUser: false },
    { id: 4, senderRole: 'admin', readByUser: false },
  ]), [3, 4]);
});

test('there is no badge for an empty thread or read replies', () => {
  assert.deepEqual(getUnreadSupportMessageIds([]), []);
  assert.deepEqual(getUnreadSupportMessageIds([
    { id: 1, senderRole: 'admin', readByUser: true },
  ]), []);
});
