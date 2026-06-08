/**
 * 创建 E2E 测试账号并关联到首个可用项目
 */
const BASE = 'http://localhost:3001/flowgen-api';

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
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${data?.error || text}`);
  return data;
}

const USERS = [
  { username: 'e2e_user_a', password: 'e2e123456', role: 'user' },
  { username: 'e2e_user_b', password: 'e2e123456', role: 'user' },
  { username: 'e2e_proj_admin', password: 'e2e123456', role: 'project_admin' },
];

async function ensureUser(token, spec) {
  const list = await api('/users', { token });
  const found = list.users.find((u) => u.username === spec.username);
  if (found) {
    await api(`/users/${found.id}`, {
      token,
      method: 'PATCH',
      body: { password: spec.password, role: spec.role, status: 'active' },
    });
    return found.id;
  }
  const created = await api('/users', {
    token,
    method: 'POST',
    body: {
      username: spec.username,
      password: spec.password,
      role: spec.role,
      status: 'active',
      mustChangePassword: false,
    },
  });
  return created.id;
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  const token = login.token;
  const ids = {};
  for (const u of USERS) {
    ids[u.username] = await ensureUser(token, u);
  }
  const { projects } = await api('/projects', { token });
  let projectId = projects[0]?.id;
  if (!projectId) {
    const p = await api('/projects', {
      token,
      method: 'POST',
      body: { name: 'E2E测试项目' },
    });
    projectId = p.id;
  }
  for (const uid of Object.values(ids)) {
    try {
      const m = await api(`/projects/${projectId}/members`, { token });
      if (!m.members.some((x) => x.userId === uid)) {
        await api(`/projects/${projectId}/members`, {
          token,
          method: 'POST',
          body: { userId: uid, role: 'editor' },
        });
      }
    } catch (e) {
      console.warn('member', uid, e.message);
    }
  }
  console.log(JSON.stringify({ projectId, projectName: projects[0]?.name || 'E2E测试项目', ids }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
