/**
 * 封面/项目权限 E2E（HTTP）：需 localhost:3001 + admin/admin
 */
const BASE = 'http://localhost:3001/flowgen-api';

async function api(path, { token, method = 'GET', body, formData } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let b = body;
  if (formData) {
    b = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: b });
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
  return r.data.token;
}

async function ensureUser(adminToken, spec) {
  const list = await api('/users', { token: adminToken });
  let u = list.data?.users?.find((x) => x.username === spec.username);
  if (u) {
    await api(`/users/${u.id}`, {
      token: adminToken,
      method: 'PATCH',
      body: { password: spec.password, role: spec.role, status: 'active', mustChangePassword: false },
    });
    return u.id;
  }
  const c = await api('/users', {
    token: adminToken,
    method: 'POST',
    body: {
      username: spec.username,
      password: spec.password,
      role: spec.role,
      status: 'active',
      mustChangePassword: false,
    },
  });
  return c.data.id;
}

async function tryCoverUpload(token, projectId) {
  const fd = new FormData();
  const blob = new Blob([Buffer.from('fake-png')], { type: 'image/png' });
  fd.append('file', blob, 'test-cover.png');
  const res = await fetch(`${BASE}/projects/${encodeURIComponent(projectId)}/cover`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  return res.status;
}

async function main() {
  const adminToken = await login('admin', 'admin');
  const projAdminId = await ensureUser(adminToken, {
    username: 'perm_proj_admin',
    password: 'perm123456',
    role: 'project_admin',
  });
  const plainUserId = await ensureUser(adminToken, {
    username: 'perm_plain_user',
    password: 'perm123456',
    role: 'user',
  });

  const { data: projData } = await api('/projects', { token: adminToken });
  const projects = projData?.projects || [];
  if (projects.length < 1) throw new Error('无项目可测，请先 AITOP 同步或确保库内有项目');
  const p1 = projects[0].id;
  const p2 = projects[1]?.id;

  // 确保项目管理员只在 p1 有成员关系（通过 admin 添加 members 若 API 允许）
  // AITOP 模式下 POST members 被禁；若已有 liangyu 等同步关系则沿用库内 members
  const membersP1 = await api(`/projects/${p1}/members`, { token: adminToken });
  const hasProjAdminOnP1 = membersP1.data?.members?.some((m) => m.userId === projAdminId);
  console.log(`项目1 ${projects[0].name} (${p1.slice(0, 8)}…) 项目管理员已是成员: ${hasProjAdminOnP1}`);

  const projAdminToken = await login('perm_proj_admin', 'perm123456');
  const plainToken = await login('perm_plain_user', 'perm123456');

  const adminProjects = (await api('/projects', { token: adminToken })).data?.projects?.length ?? 0;
  const projAdminProjects = (await api('/projects', { token: projAdminToken })).data?.projects?.length ?? 0;
  console.log(`admin 可见项目数: ${adminProjects}`);
  console.log(`perm_proj_admin 可见项目数: ${projAdminProjects}`);
  if (adminProjects > 0 && projAdminProjects >= adminProjects && projAdminProjects > 1) {
    console.warn('WARN: 项目管理员可见项目数未少于 admin（可能 AITOP 给了多项目权限）');
  }

  const sAdminP1 = await tryCoverUpload(adminToken, p1);
  assertStatus(sAdminP1, [200], 'admin 上传封面 p1');

  const sPlainP1 = await tryCoverUpload(plainToken, p1);
  assertStatus(sPlainP1, [403], '普通用户上传封面 p1 应 403');

  const sProjAdminP1 = await tryCoverUpload(projAdminToken, p1);
  if (hasProjAdminOnP1) {
    assertStatus(sProjAdminP1, [200], '项目管理员上传已分配项目封面');
  } else {
    assertStatus(sProjAdminP1, [403], '项目管理员未分配 p1 时应 403');
  }

  if (p2) {
    const membersP2 = await api(`/projects/${p2}/members`, { token: adminToken });
    const onP2 = membersP2.data?.members?.some((m) => m.userId === projAdminId);
    const sProjAdminP2 = await tryCoverUpload(projAdminToken, p2);
    if (onP2) {
      assertStatus(sProjAdminP2, [200], '项目管理员上传 p2（已分配）');
    } else {
      assertStatus(sProjAdminP2, [403], '项目管理员上传未分配 p2 应 403');
    }
  }

  console.log('\npermissions-cover-e2e-test: 全部通过');
}

function assertStatus(got, want, label) {
  if (!want.includes(got)) {
    throw new Error(`${label}: 期望 HTTP ${want.join('|')} 实际 ${got}`);
  }
  console.log(`  [OK] ${label} (${got})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
