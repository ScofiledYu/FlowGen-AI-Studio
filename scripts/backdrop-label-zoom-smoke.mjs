/**
 * 背景框标签缩放一致性：登录 → 写入双背景框 workspace → 浏览器打开后可用 CDP 采样字号
 * node scripts/backdrop-label-zoom-smoke.mjs
 */
const BASE = process.env.FLOWGEN_API_BASE || 'http://localhost:3001/flowgen-api';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

function mkBackdrop(id, x, y, w, h, label) {
  return {
    id,
    type: 'backdropNode',
    position: { x, y },
    width: w,
    height: h,
    style: { width: w, height: h, zIndex: 0 },
    selectable: true,
    draggable: true,
    data: {
      label,
      backdropLabel: label,
      backdropChildIds: [],
      backdropFill: 'rgba(99, 102, 241, 0.07)',
      backdropBorder: 'rgba(129, 140, 248, 0.55)',
    },
  };
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  const token = login.token;
  const projects = await api('/projects', { token });
  const list = Array.isArray(projects) ? projects : projects.items || projects.projects || [];
  let projectId = list[0]?.id;
  if (!projectId) {
    console.log('no projects for admin — open http://localhost:3001/#/projects and create one');
    process.exit(0);
  }

  const payload = {
    v: 1,
    graph: {
      nodes: [
        mkBackdrop('bd-a', 100, 100, 520, 320, '场景一'),
        mkBackdrop('bd-b', 720, 140, 360, 240, '场景二'),
      ],
      edges: [],
      storyboardImages: [],
    },
    viewport: { x: 0, y: 0, zoom: 0.55 },
    chatByUser: {},
  };

  const ws = await api(`/projects/${projectId}/workspace`, { token });
  const version = ws?.version ?? ws?.serverVersion ?? null;

  await api(`/projects/${projectId}/workspace`, {
    method: 'PUT',
    token,
    body: { payload, version },
  });

  const url = `http://localhost:3001/#/workspace/${projectId}`;
  console.log('OK backdrop smoke workspace written');
  console.log('OPEN', url);
  console.log('TOKEN', token.slice(0, 12) + '...');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
