import assert from 'node:assert/strict';
import {
  chatCanvasSessionStorageKey,
  chatSessionsListStorageKey,
  chatLocalHistoryStorageKey,
  projectWorkspaceDataStorageKey,
  projectViewportStorageKey,
  resolveChatStorageScope,
} from '../utils/chatStorageScope.ts';

const scope = resolveChatStorageScope('user-1', 'proj-a');
assert.equal(chatSessionsListStorageKey(scope), 'flowgen:chat:sessions:user-1:proj-a');
assert.equal(chatCanvasSessionStorageKey(scope), 'flowgen:chat:canvas-session:user-1:proj-a');
assert.equal(chatLocalHistoryStorageKey(scope), 'flowgen:chat:local-history:user-1:proj-a');
assert.equal(projectWorkspaceDataStorageKey(scope), 'flowgen-project-data:user-1:proj-a');
assert.equal(projectViewportStorageKey(scope), 'flowgen-last-viewport:user-1:proj-a');

const local = resolveChatStorageScope('u2', null);
assert.equal(chatSessionsListStorageKey(local), 'flowgen:chat:sessions:u2:_local');

console.log('test-chat-storage-scope: ok');
