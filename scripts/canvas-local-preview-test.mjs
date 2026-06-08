import assert from 'node:assert/strict';
import { formatNodeSourceUrlForDisplay } from '../utils/canvasLocalPreview.ts';

const blob = formatNodeSourceUrlForDisplay({
  imagePreview: 'blob:http://localhost/abc',
  imageLocalRef: 'flowgen-local:u:p:n:main',
  imageName: 'test.jpg',
});
assert.equal(blob, 'blob: (test.jpg)');

const data = formatNodeSourceUrlForDisplay({
  imagePreview: 'data:image/jpeg;base64,' + 'x'.repeat(100000),
});
assert.match(data, /^data: \(本机预览/);

const remote = formatNodeSourceUrlForDisplay({
  imagePreview: '/flowgen-api/projects/p/a/file',
});
assert.equal(remote, '/flowgen-api/projects/p/a/file');

console.log('[canvas-local-preview-test] passed');
