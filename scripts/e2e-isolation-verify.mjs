/**
 * API 级验证：聊天 workspace 按用户隔离、资产库权限
 */
const BASE = 'http://localhost:3001/flowgen-api';
const PROJECT_ID = process.env.E2E_PROJECT_ID || '7b5c23a2-a38b-479a-9553-3fda49c5d5e7';

async function api(path, { token, method = 'GET', body, formData } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let reqBody;
  if (formData) {
    reqBody = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: reqBody });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function login(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  if (!r.ok) throw new Error(`login ${username}: ${r.data?.error || r.status}`);
  return r.data;
}

function chatMarker(uid, tag) {
  return {
    v: 1,
    messages: [
      {
        id: `m-${tag}`,
        role: 'user',
        content: `隔离标记-${tag}-uid-${uid.slice(0, 8)}`,
        timestamp: new Date().toISOString(),
      },
    ],
    modelId: 'claude-sonnet-4-6',
    updatedAt: new Date().toISOString(),
  };
}

async function putWorkspaceChat(token, userId, tag) {
  const get = await api(`/projects/${PROJECT_ID}/workspace`, { token });
  if (!get.ok) throw new Error(`get workspace: ${get.data?.error}`);
  const payload = get.data.payload && typeof get.data.payload === 'object' ? get.data.payload : {};
  const chatByUser = { ...(payload.chatByUser || {}) };
  chatByUser[userId] = chatMarker(userId, tag);
  const put = await api(`/projects/${PROJECT_ID}/workspace`, {
    token,
    method: 'PUT',
    body: { version: get.data.version, payload: { ...payload, chatByUser } },
  });
  if (!put.ok) throw new Error(`put workspace: ${put.data?.error}`);
  return put.data;
}

async function readWorkspaceChat(token, expectUserId) {
  const get = await api(`/projects/${PROJECT_ID}/workspace`, { token });
  if (!get.ok) throw new Error(`get workspace: ${get.data?.error}`);
  const p = get.data.payload || {};
  const mine = p.chatByUser?.[expectUserId];
  const legacy = p.chat;
  return { mine, legacy, chatByUserKeys: Object.keys(p.chatByUser || {}) };
}

async function tryUploadAsset(token) {
  const fd = new FormData();
  const blob = new Blob(['fake'], { type: 'image/png' });
  fd.append('file', blob, 'e2e-test.png');
  fd.append('name', 'e2e-test');
  fd.append('category', 'OTHER');
  return api(`/projects/${PROJECT_ID}/assets`, { token, method: 'POST', formData: fd });
}

const failures = [];
const passes = [];

function pass(msg) {
  passes.push(msg);
  console.log('✓', msg);
}
function fail(msg) {
  failures.push(msg);
  console.error('✗', msg);
}

async function main() {
  const admin = await login('admin', 'admin');
  const userA = await login('e2e_user_a', 'e2e123456');
  const userB = await login('e2e_user_b', 'e2e123456');
  const projAdmin = await login('e2e_proj_admin', 'e2e123456');

  const idA = userA.user.id;
  const idB = userB.user.id;

  await putWorkspaceChat(admin.token, admin.user.id, 'admin');
  await putWorkspaceChat(userA.token, idA, 'userA');
  await putWorkspaceChat(userB.token, idB, 'userB');

  const viewA = await readWorkspaceChat(userA.token, idA);
  if (viewA.mine?.messages?.[0]?.content?.includes('userA')) pass('用户A 读到自己的工程聊天');
  else fail('用户A 未读到自己的工程聊天');

  if (!viewA.mine?.messages?.[0]?.content?.includes('userB')) pass('用户A 不会把自己的聊天当成用户B');
  else fail('用户A 聊天内容异常');

  const viewB = await readWorkspaceChat(userB.token, idB);
  if (viewB.mine?.messages?.[0]?.content?.includes('userB')) pass('用户B 读到自己的工程聊天');
  else fail('用户B 未读到自己的工程聊天');

  if (!viewB.mine?.messages?.[0]?.content?.includes('userA')) pass('用户B 看不到用户A的聊天标记');
  else fail('用户B 泄露了用户A的聊天');

  const viewAasB = await readWorkspaceChat(userB.token, idA);
  if (!viewAasB.mine?.messages?.[0]?.content?.includes('userA')) {
    pass('用户B 的 workspace 视图不含用户A的 chatByUser 槽位内容');
  } else fail('用户B 可能读到用户A的 chatByUser');

  const uploadUser = await tryUploadAsset(userA.token);
  if (uploadUser.status === 403) pass('普通用户上传资产被拒绝 (403)');
  else fail(`普通用户上传资产应 403，实际 ${uploadUser.status}`);

  const uploadPa = await tryUploadAsset(projAdmin.token);
  if (uploadPa.ok || uploadPa.status === 201) pass('项目管理员可上传资产');
  else fail(`项目管理员上传失败: ${uploadPa.status} ${uploadPa.data?.error}`);

  const chatId = `e2e-isolation-${Date.now()}`;
  const saveA = await api(`/chat-history/${chatId}`, {
    token: userA.token,
    method: 'POST',
    body: {
      modelId: 'claude-sonnet-4-6',
      projectId: PROJECT_ID,
      messages: [{ id: '1', role: 'user', content: '用户A私密会话', timestamp: new Date().toISOString() }],
    },
  });
  if (saveA.ok) pass('用户A 可保存带 projectId 的 chat-history');
  else fail(`用户A 保存 chat-history 失败: ${saveA.data?.error}`);

  const peekB = await api(`/chat-history/${chatId}`, { token: userB.token });
  if (peekB.status === 403) pass('用户B 无法读取用户A 的 chat-history');
  else fail(`用户B 应 403 读取他人会话，实际 ${peekB.status}`);

  const listA = await api(`/chat-history?projectId=${PROJECT_ID}`, { token: userA.token });
  const listB = await api(`/chat-history?projectId=${PROJECT_ID}`, { token: userB.token });
  const aHas = listA.ok && listA.data?.sessions?.some((s) => s.chatId === chatId);
  const bHas = listB.ok && listB.data?.sessions?.some((s) => s.chatId === chatId);
  if (aHas) pass('用户A 列表含自己的会话');
  else fail('用户A 列表未含自己的会话');
  if (!bHas) pass('用户B 列表不含用户A 的会话');
  else fail('用户B 列表泄露了用户A 的会话');

  console.log('\n---');
  console.log(`通过 ${passes.length}，失败 ${failures.length}`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
