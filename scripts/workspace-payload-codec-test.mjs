import assert from 'node:assert/strict';
import {
  encodeWorkspacePayloadForDb,
  decodeWorkspacePayloadFromDb,
  WORKSPACE_GZIP_KEY,
} from '../server/flowgen/workspacePayloadCodec.mjs';

const small = { v: 1, graph: { nodes: [{ id: 'n1', data: { label: 'hi' } }] } };
const encodedSmall = await encodeWorkspacePayloadForDb(small);
assert.equal(encodedSmall.storedBytes, encodedSmall.uncompressedBytes);
assert.equal(encodedSmall.stored?.v, 1);

const bigInner = 'x'.repeat(600 * 1024);
const big = { v: 1, graph: { nodes: [{ id: 'n1', data: { blob: bigInner } }] } };
const encodedBig = await encodeWorkspacePayloadForDb(big);
assert.ok(encodedBig.storedBytes < encodedBig.uncompressedBytes);
assert.ok(encodedBig.storedBytes < 1024 * 1024);
assert.equal(typeof encodedBig.stored?.[WORKSPACE_GZIP_KEY], 'string');

const roundTrip = await decodeWorkspacePayloadFromDb(encodedBig.stored);
assert.equal(roundTrip.graph.nodes[0].data.blob.length, bigInner.length);

console.log('workspace-payload-codec-test: ok', {
  uncompressed: encodedBig.uncompressedBytes,
  stored: encodedBig.storedBytes,
});
