/**
 * 画布持久化回归：slice 读取、版本冲突、封面空图、HTTP 往返（需 localhost:3001 + admin）
 */
import assert from 'node:assert/strict';
import {
  graphNodeCountFromPayload,
  resolveUserWorkspaceSliceView,
  shouldRejectEmptyWorkspaceOverwrite,
} from '../server/flowgen/workspaceSliceView.mjs';
import {
  ensureWorkspaceEnvelope,
  getUserWorkspaceView,
  putUserWorkspaceSlice,
} from '../server/flowgen/workspacePerUser.mjs';
import { pickWorkspaceCoverCandidateUrl } from '../server/flowgen/workspaceProjectCover.mjs';
import {
  isManualProjectCover,
  markProjectCoverSource,
  clearProjectCoverSource,
} from '../server/flowgen/projectCoverMeta.mjs';

const BASE = process.env.FLOWGEN_API_BASE || 'http://localhost:3001/flowgen-api';
const RUN_HTTP = process.env.SKIP_HTTP !== '1';

function mkPayload(nodeIds, tag = 'a') {
  const nodes = nodeIds.map((id, i) => ({
    id,
    type: 'custom',
    position: { x: i * 100, y: 0 },
    data: { label: `${tag}-node-${id}`, imagePreview: `https://example.com/${tag}/${id}.jpg` },
  }));
  return {
    v: 1,
    graph: { nodes, edges: [], storyboardImages: [] },
    viewport: { x: 0, y: 0, zoom: 1 },
    chatByUser: {},
  };
}

function countNodes(payload) {
  return graphNodeCountFromPayload(payload);
}

// --- unit: resolveUserWorkspaceSliceView ---
{
  const slices = [
    { userId: 'userA', version: 3, payload: mkPayload(['a1', 'a2'], 'mine') },
    { userId: 'userB', version: 1, payload: mkPayload(['b1', 'b2', 'b3', 'b4', 'b5'], 'other') },
  ];
  const viewA = resolveUserWorkspaceSliceView(slices, 'userA');
  assert.equal(viewA.version, 3, 'userA version from own slice');
  assert.equal(countNodes(viewA.payload), 2, 'userA gets own 2 nodes not other 5');

  const emptyA = resolveUserWorkspaceSliceView(
    [
      { userId: 'userA', version: 2, payload: mkPayload([], 'empty') },
      { userId: 'userB', version: 1, payload: mkPayload(['b1', 'b2', 'b3'], 'rich') },
    ],
    'userA'
  );
  assert.equal(emptyA.version, 2, 'empty own slice keeps version');
  assert.equal(countNodes(emptyA.payload), 0, 'empty own slice does not borrow rich other graph');

  const newcomer = resolveUserWorkspaceSliceView(slices, 'userC');
  assert.equal(countNodes(newcomer.payload), 5, 'new user without slice borrows richest graph');
  assert.equal(newcomer.version, 1, 'new user version from borrowed slice');
}

// --- unit: reject empty overwrite ---
{
  const full = mkPayload(['a1', 'a2'], 'full');
  const empty = mkPayload([], 'empty');
  assert.equal(shouldRejectEmptyWorkspaceOverwrite(full, empty), true);
  assert.equal(shouldRejectEmptyWorkspaceOverwrite(full, empty, { allowEmptyGraph: true }), false);
  assert.equal(shouldRejectEmptyWorkspaceOverwrite(null, empty), false);
  assert.equal(shouldRejectEmptyWorkspaceOverwrite(full, full), false);
}

// --- unit: JSON store envelope (workspacePerUser) ---
{
  const store = { workspaces: {} };
  const projectId = 'proj-json-test';
  const envelope = ensureWorkspaceEnvelope(store, projectId);
  envelope.byUser.userA = { version: 2, payload: mkPayload([], 'empty'), updatedAt: new Date().toISOString() };
  envelope.byUser.userB = {
    version: 1,
    payload: mkPayload(['x1', 'x2', 'x3'], 'b'),
    updatedAt: new Date().toISOString(),
  };
  const view = getUserWorkspaceView(envelope, 'userA');
  assert.equal(view.version, 2);
  assert.equal(countNodes(view.payload), 0, 'JSON store: empty mine not mixed with other version');

  putUserWorkspaceSlice(store, projectId, 'userA', {
    version: 2,
    payload: mkPayload(['new1', 'new2', 'new3'], 'saved'),
  });
  const afterPut = getUserWorkspaceView(envelope, 'userA');
  assert.equal(afterPut.version, 3);
  assert.equal(countNodes(afterPut.payload), 3);

  let conflictThrown = false;
  try {
    putUserWorkspaceSlice(store, projectId, 'userA', { version: 1, payload: mkPayload(['bad'], 'stale') });
  } catch (e) {
    conflictThrown = e?.code === 'VERSION_CONFLICT';
  }
  assert.equal(conflictThrown, true, 'stale version must conflict');

  let emptyReject = false;
  try {
    putUserWorkspaceSlice(store, projectId, 'userA', {
      version: 3,
      payload: mkPayload([], 'empty'),
    });
  } catch (e) {
    emptyReject = e?.code === 'EMPTY_GRAPH_REJECTED';
  }
  assert.equal(emptyReject, true, 'JSON store: empty overwrite rejected');
  assert.equal(countNodes(getUserWorkspaceView(envelope, 'userA').payload), 3);
}

// --- unit: cover candidate ---
{
  assert.equal(pickWorkspaceCoverCandidateUrl([]), null);
  const url = pickWorkspaceCoverCandidateUrl([
    { id: '1', data: { imagePreview: 'https://cdn.example.com/shot.jpg' } },
  ]);
  assert.equal(url, 'https://cdn.example.com/shot.jpg');
  assert.equal(pickWorkspaceCoverCandidateUrl([{ id: '1', data: { imagePreview: 'data:image/png;base64,xx' } }]), null);
}

{
  assert.equal(isManualProjectCover({ coverSource: 'manual' }), true);
  assert.equal(isManualProjectCover({ coverSource: 'auto' }), false);
  const marked = markProjectCoverSource({}, 'manual');
  assert.equal(marked.coverSource, 'manual');
  assert.equal(typeof marked.coverUpdatedAt, 'number');
  const cleared = clearProjectCoverSource(marked);
  assert.equal(cleared.coverSource, undefined);
}

console.log('[workspace-persistence] unit tests passed');

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function runHttpTests() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  if (!login.ok) {
    console.warn('[workspace-persistence] SKIP HTTP: admin login failed', login.data?.error || login.status);
    return;
  }
  const token = login.data.token;

  const created = await api('/projects', {
    token,
    method: 'POST',
    body: { name: `persist-test-${Date.now()}` },
  });
  assert.ok(created.ok, `create project: ${created.data?.error}`);
  const projectId = created.data.id;

  try {
    const get0 = await api(`/projects/${projectId}/workspace`, { token });
    assert.ok(get0.ok);
    assert.equal(get0.data.version, 0);

    const payload3 = mkPayload(['n1', 'n2', 'n3'], 'http');
    const put1 = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: 0, payload: payload3 },
    });
    assert.ok(put1.ok, `put v0: ${put1.data?.error}`);
    assert.equal(put1.data.version, 1);

    const get1 = await api(`/projects/${projectId}/workspace`, { token });
    assert.ok(get1.ok);
    assert.equal(get1.data.version, 1);
    assert.equal(countNodes(get1.data.payload), 3, 'GET after PUT returns 3 nodes');

    const putConflict = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: 0, payload: mkPayload(['stale'], 'stale') },
    });
    assert.equal(putConflict.status, 409, 'stale version must 409');

    const put2 = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: 1, payload: mkPayload(['n1', 'n2', 'n3', 'n4'], 'http2') },
    });
    assert.ok(put2.ok);
    const get2 = await api(`/projects/${projectId}/workspace`, { token });
    assert.equal(countNodes(get2.data.payload), 4);

    const putEmpty = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: get2.data.version, payload: mkPayload([], 'empty-save') },
    });
    assert.equal(putEmpty.status, 409, 'empty overwrite without flag must 409');
    assert.ok(
      String(putEmpty.data?.error || '').includes('空画布') ||
        putEmpty.data?.code === 'EMPTY_GRAPH_REJECTED',
      'empty overwrite error message'
    );
    const getAfterReject = await api(`/projects/${projectId}/workspace`, { token });
    assert.equal(countNodes(getAfterReject.data.payload), 4, 'nodes preserved after rejected empty save');
    assert.equal(getAfterReject.data.version, get2.data.version, 'version unchanged after rejected empty save');

    const putEmptyAllowed = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: {
        version: get2.data.version,
        payload: mkPayload([], 'empty-save'),
        allowEmptyGraph: true,
      },
    });
    assert.ok(putEmptyAllowed.ok, `empty with allowEmptyGraph: ${putEmptyAllowed.data?.error}`);

    const getCleared = await api(`/projects/${projectId}/workspace`, { token });
    assert.equal(countNodes(getCleared.data.payload), 0, 'allowEmptyGraph clears graph');

    console.log('[workspace-persistence] HTTP tests passed', { projectId });
  } finally {
    await api(`/projects/${projectId}`, { token, method: 'DELETE' });
  }
}

if (RUN_HTTP) {
  try {
    await runHttpTests();
  } catch (e) {
    console.error('[workspace-persistence] HTTP tests failed:', e);
    process.exit(1);
  }
} else {
  console.log('[workspace-persistence] HTTP skipped (SKIP_HTTP=1)');
}
