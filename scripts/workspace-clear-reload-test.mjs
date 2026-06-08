/**
 * 清空画布 + 空聊天 应能持久化；再次 GET 仍为空。
 * Usage: node scripts/workspace-clear-reload-test.mjs
 */
import assert from 'node:assert/strict';

const BASE = process.env.FLOWGEN_API_BASE || 'http://localhost:3001/flowgen-api';

async function api(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    cache: 'no-store',
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

function countNodes(payload) {
  const nodes = payload?.graph?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

function chatMessageCount(payload, userId = 'admin') {
  const chat = payload?.chatByUser?.[userId] || payload?.chat;
  return Array.isArray(chat?.messages) ? chat.messages.length : 0;
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.ok(login.ok, `login: ${login.data?.error}`);
  const token = login.data.token;
  const userId = login.data.user?.id || 'admin';

  const created = await api('/projects', {
    token,
    method: 'POST',
    body: { name: `clear-reload-${Date.now()}` },
  });
  assert.ok(created.ok);
  const projectId = created.data.id;

  try {
    const payload3 = {
      v: 1,
      graph: {
        nodes: [
          {
            id: 'n1',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { label: 'before-clear' },
          },
        ],
        edges: [],
        storyboardImages: [],
      },
      viewport: { x: 0, y: 0, zoom: 1 },
      chatByUser: {
        [userId]: {
          v: 1,
          chatId: 'old-chat',
          modelId: 'gemini-3.1-pro',
          messages: [
            { id: 'u1', role: 'user', content: '旧问题', timestamp: new Date().toISOString() },
            { id: 'a1', role: 'assistant', content: '旧回答', timestamp: new Date().toISOString() },
          ],
        },
      },
    };

    const put1 = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: 0, payload: payload3 },
    });
    assert.ok(put1.ok, put1.data?.error);

    const putEmpty = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: {
        version: put1.data.version,
        allowEmptyGraph: true,
        payload: {
          v: 1,
          graph: { nodes: [], edges: [], storyboardImages: [] },
          viewport: { x: 0, y: 0, zoom: 1 },
          chatByUser: {
            [userId]: {
              v: 1,
              chatId: '',
              modelId: 'gemini-3.1-pro',
              messages: [
                {
                  id: 'welcome',
                  role: 'assistant',
                  content: '你好，我是你的 AI 助手。',
                  timestamp: new Date().toISOString(),
                },
              ],
            },
          },
        },
      },
    });
    assert.ok(putEmpty.ok, `empty save: ${putEmpty.data?.error}`);

    const get1 = await api(`/projects/${projectId}/workspace`, { token });
    assert.ok(get1.ok);
    assert.equal(countNodes(get1.data.payload), 0, 'nodes should stay empty after reload');
    assert.equal(chatMessageCount(get1.data.payload, userId), 1, 'chat should be welcome-only');

    const putRestore = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: {
        version: get1.data.version,
        payload: {
          v: 1,
          graph: {
            nodes: [
              {
                id: 'n2',
                type: 'custom',
                position: { x: 10, y: 0 },
                data: { label: 'restored' },
              },
            ],
            edges: [],
            storyboardImages: [],
          },
          viewport: { x: 0, y: 0, zoom: 1 },
          chatByUser: get1.data.payload.chatByUser,
        },
      },
    });
    assert.ok(putRestore.ok, putRestore.data?.error);

    const putEmptyNoFlag = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: {
        version: putRestore.data.version,
        payload: {
          v: 1,
          graph: { nodes: [], edges: [], storyboardImages: [] },
          chatByUser: get1.data.payload.chatByUser,
        },
      },
    });
    assert.equal(putEmptyNoFlag.status, 409, 'empty without allowEmptyGraph must 409 when graph had nodes');

    console.log('[workspace-clear-reload] passed', { projectId });
  } finally {
    await api(`/projects/${projectId}`, { token, method: 'DELETE' });
  }
}

main().catch((e) => {
  console.error('[workspace-clear-reload] failed', e);
  process.exit(1);
});
