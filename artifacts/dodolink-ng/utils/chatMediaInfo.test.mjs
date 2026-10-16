import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMediaInfo } from './chatMediaInfo.ts';

test('opaque storage paths use the real MIME type, not filename guesses', () => {
  assert.deepEqual(chatMediaInfo('/objects/uploads/uuid', 'video/mp4'), { video: true, extension: 'mp4' });
  assert.deepEqual(chatMediaInfo('/objects/uploads/uuid', 'video/quicktime'), { video: true, extension: 'mov' });
  assert.deepEqual(chatMediaInfo('/objects/uploads/uuid', 'image/png'), { video: false, extension: 'png' });
});
test('MIME parameters and legacy video links are supported', () => {
  assert.equal(chatMediaInfo('/objects/uuid', 'Video/WebM; codecs=vp9').extension, 'webm');
  assert.equal(chatMediaInfo('https://example.com/file.mov?token=test').video, true);
  assert.equal(chatMediaInfo('/objects/chat-vid-123').video, true);
  assert.equal(chatMediaInfo('/objects/video.mp4', 'image/jpeg').video, false);
});
