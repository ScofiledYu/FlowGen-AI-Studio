import assert from 'node:assert/strict';
import {
  shouldStripPersistString,
  sanitizePersistValueDeep,
  sanitizeStoryboardImagesForPersist,
  sanitizeChatForPersist,
  sanitizeWorkspacePayload,
} from '../utils/persistSanitize.mjs';

const bigDataImage = `data:image/png;base64,${'A'.repeat(9000)}`;

assert.equal(shouldStripPersistString('blob:http://x'), true);
assert.equal(shouldStripPersistString('data:video/mp4;base64,abc'), true);
assert.equal(shouldStripPersistString(bigDataImage), true);
assert.equal(shouldStripPersistString('https://cdn.example/a.png'), false);

const node = sanitizePersistValueDeep({
  id: 'n1',
  data: {
    imagePreview: bigDataImage,
    referenceImages: ['https://ok', bigDataImage],
    generatedThumbnails: [{ url: bigDataImage, posterDataUrl: bigDataImage }],
  },
});
assert.equal(node.data.imagePreview, undefined);
assert.deepEqual(node.data.referenceImages, ['https://ok']);
assert.equal(node.data.generatedThumbnails[0].url, undefined);

const storyboard = sanitizeStoryboardImagesForPersist([
  'https://a',
  bigDataImage,
  ...Array.from({ length: 200 }, (_, i) => `https://img-${i}`),
]);
assert.equal(storyboard.length, 120);
assert.ok(storyboard.every((u) => u.startsWith('https://')));

const chat = sanitizeChatForPersist({
  v: 1,
  chatId: 'c1',
  modelId: 'm1',
  messages: [
    {
      id: '1',
      role: 'user',
      content: 'hi',
      timestamp: 't',
      imageUrl: bigDataImage,
      imageUrls: [bigDataImage, 'https://ok'],
    },
  ],
});
assert.equal(chat.messages[0].imageUrl, undefined);
assert.deepEqual(chat.messages[0].imageUrls, ['https://ok']);

const ws = sanitizeWorkspacePayload({
  v: 1,
  graph: {
    nodes: [{ id: 'n', data: { imagePreview: bigDataImage } }],
    storyboardImages: [bigDataImage],
  },
  chatByUser: { u1: chat },
});
assert.equal(ws.graph.nodes[0].data.imagePreview, undefined);
assert.equal(ws.graph.storyboardImages.length, 0);

console.log('persist-sanitize-test: ok');
