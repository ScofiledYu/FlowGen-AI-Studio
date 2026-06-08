/**
 * 模拟多客户端并发：登录、轮询 GET workspace、防抖 PUT workspace。
 * 用法: node scripts/multi-client-load-test.mjs
 * 环境: BASE=http://localhost:3001 CLIENTS=8 ROUNDS=5
 */
const BASE = (process.env.BASE || 'http://localhost:3001').replace(/\/$/, '');
const API = `${BASE}/flowgen-api`;
const CLIENTS = Math.max(1, Number(process.env.CLIENTS || 8));
const ROUNDS = Math.max(1, Number(process.env.ROUNDS || 5));
const PUT_INTERVAL_MS = Number(process.env.PUT_INTERVAL_MS || 1200);
const BURST = process.env.BURST === '1';

const USERS = [
  { username: 'e2e_user_a', password: 'e2e123456' },
  { username: 'e2e_user_b', password: 'e2e123456' },
  { username: 'e2e_proj_admin', password: 'e2e123456' },
  { username: 'admin', password: 'admin' },
];

/** @type {Record<string, number>} */
const stats = {
  getOk: 0,
  getFail: 0,
  putOk: 0,
  putFail: 0,
  conflict409: 0,
  other4xx: 0,
  server5xx: 0,
  networkErr: 0,
};
/** @type {number[]} */
const latencies = [];

async function api(path, { token, method = 'GET', body } = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    stats.networkErr += 1;
    throw e;
  } finally {
    latencies.push(performance.now() - t0);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function buildGraphPayload(clientIdx, round, userTag) {
  const nodes = Array.from({ length: 12 }, (_, i) => ({
    id: `n-${userTag}-${i}`,
    type: 'processor',
    position: { x: i * 120, y: clientIdx * 80 },
    data: {
      label: `节点-${userTag}-${round}-${i}`,
      prompt: `prompt ${round}`,
      imagePreview: `https://cdn.example.com/${userTag}/${round}/${i}.png`,
      referenceImages: [`https://cdn.example.com/ref/${userTag}/${i}.jpg`],
      generatedThumbnails: [
        { url: `https://cdn.example.com/thumb/${userTag}/${i}.jpg`, type: 'image' },
      ],
    },
  }));
  const edges = nodes.slice(0, -1).map((n, i) => ({
    id: `e-${userTag}-${i}`,
    source: n.id,
    target: nodes[i + 1].id,
  }));
  return {
    v: 1,
    graph: {
      nodes,
      edges,
      storyboardImages: [`https://cdn.example.com/story/${userTag}/${round}.jpg`],
      savedAt: new Date().toISOString(),
    },
    viewport: { x: clientIdx * 10, y: round * 5, zoom: 1 },
    projectName: `load-test-${userTag}`,
  };
}

async function login(username, password) {
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  if (!r.ok) throw new Error(`login ${username}: ${r.status} ${r.data?.error || ''}`);
  return r.data;
}

async function resolveProjectId(adminToken) {
  const envId = process.env.E2E_PROJECT_ID;
  if (envId) return envId;
  const list = await api('/projects', { token: adminToken });
  if (list.data?.projects?.[0]?.id) return list.data.projects[0].id;
  const created = await api('/projects', {
    token: adminToken,
    method: 'POST',
    body: { name: '多客户端压测项目' },
  });
  if (!created.ok) throw new Error(`create project: ${created.data?.error}`);
  return created.data.id;
}

async function putWorkspaceWithRetry(token, projectId, version, payload, maxAttempts = 5) {
  let v = version;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const put = await api(`/projects/${projectId}/workspace`, {
      token,
      method: 'PUT',
      body: { version: v, payload },
    });
    if (put.ok) {
      stats.putOk += 1;
      return put.data.version;
    }
    if (put.status === 409) {
      stats.conflict409 += 1;
      const retryGet = await api(`/projects/${projectId}/workspace`, { token });
      if (retryGet.ok) v = retryGet.data.version;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        continue;
      }
    }
    stats.putFail += 1;
    if (put.status >= 500) stats.server5xx += 1;
    else stats.other4xx += 1;
    return v;
  }
  return v;
}

const BATCH = Math.max(1, Number(process.env.BATCH || 50));

async function runClientsInBatches(specs, projectId) {
  const results = [];
  for (let i = 0; i < specs.length; i += BATCH) {
    const chunk = specs.slice(i, i + BATCH);
    const chunkResults = await Promise.all(
      chunk.map((u, j) => clientLoop(i + j, u, projectId))
    );
    results.push(...chunkResults);
  }
  return results;
}

async function clientLoop(clientIdx, userSpec, projectId) {
  const session = await login(userSpec.username, userSpec.password);
  const token = session.token;
  const userTag = userSpec.username.replace(/[^a-z0-9_]/gi, '');
  let version = 0;

  for (let round = 0; round < ROUNDS; round += 1) {
    const get = await api(`/projects/${projectId}/workspace`, { token });
    if (get.ok) {
      stats.getOk += 1;
      version = typeof get.data.version === 'number' ? get.data.version : version;
    } else {
      stats.getFail += 1;
    }

    if (!BURST && PUT_INTERVAL_MS > 0) {
      await new Promise((r) => setTimeout(r, PUT_INTERVAL_MS + clientIdx * 40));
    }

    version = await putWorkspaceWithRetry(
      token,
      projectId,
      version,
      buildGraphPayload(clientIdx, round, userTag)
    );
  }
  return { user: userSpec.username, finalVersion: version };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`[load-test] BASE=${BASE} CLIENTS=${CLIENTS} ROUNDS=${ROUNDS} BURST=${BURST}`);
  const admin = await login('admin', 'admin');
  const projectId = await resolveProjectId(admin.token);
  console.log(`[load-test] projectId=${projectId}`);

  const t0 = Date.now();
  const specs = Array.from({ length: CLIENTS }, (_, i) => USERS[i % USERS.length]);
  const results = await runClientsInBatches(specs, projectId);
  const elapsedMs = Date.now() - t0;

  latencies.sort((a, b) => a - b);
  const totalOps = stats.getOk + stats.getFail + stats.putOk + stats.putFail + stats.conflict409;
  const failRate =
    totalOps > 0
      ? (((stats.getFail + stats.putFail + stats.server5xx + stats.networkErr) / totalOps) * 100).toFixed(2)
      : '0';

  const health = await api('/health/db').catch(() => ({ ok: false, data: null }));

  const report = {
    elapsedMs,
    clients: CLIENTS,
    rounds: ROUNDS,
    stats,
    latencyMs: {
      p50: Math.round(percentile(latencies, 50)),
      p95: Math.round(percentile(latencies, 95)),
      max: Math.round(latencies[latencies.length - 1] || 0),
    },
    failRatePercent: Number(failRate),
    storage: health.ok ? health.data?.storage : 'unknown',
    sampleClients: results.slice(0, 4),
  };

  console.log(JSON.stringify(report, null, 2));

  const hardFail =
    stats.server5xx > 0 ||
    stats.networkErr > 0 ||
    Number(failRate) > 0.5;
  if (hardFail) process.exit(1);
}

main().catch((e) => {
  console.error('[load-test] fatal', e);
  process.exit(1);
});
