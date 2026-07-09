/**
 * 背景框标签缩放一致性自动化验证（需 localhost:3001 + admin）
 * node scripts/backdrop-label-zoom-verify.mjs
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
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
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

/** 在浏览器 CDP Runtime.evaluate 中执行的采样脚本 */
const BROWSER_SAMPLE_SCRIPT = `
(async () => {
  function measure() {
    return Array.from(document.querySelectorAll('.backdrop-node button')).map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent?.trim(), screenH: r.height, screenW: r.width };
    });
  }
  function getZoom() {
    const m = getComputedStyle(document.querySelector('.react-flow__viewport')).transform;
    return parseFloat(m.match(/matrix\\(([^,]+)/)?.[1] || '1');
  }
  const pane = document.querySelector('.react-flow__pane');
  if (!pane) return { error: 'no pane' };
  const rect = pane.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const samples = [];
  for (let i = 0; i < 30; i++) {
    pane.dispatchEvent(
      new WheelEvent('wheel', { deltaY: i % 2 === 0 ? 100 : -100, clientX: cx, clientY: cy, bubbles: true })
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const labels = measure();
    if (labels.length >= 2) {
      const diff = Math.abs(labels[0].screenH - labels[1].screenH);
      samples.push({ zoom: getZoom(), diff, labels });
    }
  }
  const maxDiff = Math.max(...samples.map((s) => s.diff), 0);
  let maxJump = 0;
  for (let i = 1; i < samples.length; i++) {
    maxJump = Math.max(
      maxJump,
      Math.abs(samples[i].labels[0].screenH - samples[i - 1].labels[0].screenH)
    );
  }
  return {
    ok: maxDiff < 1 && maxJump < 2,
    backdropCount: document.querySelectorAll('.backdrop-node').length,
    maxDiff,
    maxJump,
    sampleCount: samples.length,
  };
})();
`;

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  const token = login.token;
  const { projects } = await api('/projects', { token });
  const projectId = projects?.[0]?.id;
  if (!projectId) throw new Error('no project');

  const payload = {
    v: 1,
    graph: {
      nodes: [
        mkBackdrop('bd-a', 80, 80, 640, 360, '场景一'),
        mkBackdrop('bd-b', 780, 120, 280, 220, '场景二'),
        mkBackdrop('bd-c', 80, 520, 400, 260, '场景三长名称测试'),
      ],
      edges: [],
      storyboardImages: [],
    },
    viewport: { x: 40, y: 40, zoom: 0.6 },
    chatByUser: {},
  };

  const ws = await api(`/projects/${projectId}/workspace`, { token });
  await api(`/projects/${projectId}/workspace`, {
    method: 'PUT',
    token,
    body: { payload, version: ws.version },
  });

  console.log('workspace ready:', `http://localhost:3001/#/workspace/${projectId}`);
  console.log('Run browser CDP test with BROWSER_SAMPLE_SCRIPT');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
