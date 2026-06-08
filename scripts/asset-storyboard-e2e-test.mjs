/**
 * 资产库 PNG + 分镜表模板校验 E2E（HTTP）
 * node scripts/asset-storyboard-e2e-test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateStoryboardTableSpawn,
  validateTemplateUsesProjectAssetLibrary,
} from '../utils/storyboardTableSpawn.ts';

const BASE = process.env.FLOWGEN_API_BASE || 'http://localhost:3001/flowgen-api';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function api(path, { token, method = 'GET', body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, headers: res.headers };
}

const sampleRows = [
  ['镜头编号', '单镜秒数', '关联剧本'],
  ['ep001', '5', 'test'],
];

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.ok(login.ok, `login: ${login.data?.error}`);
  const token = login.data.token;

  const created = await api('/projects', {
    token,
    method: 'POST',
    body: { name: `e2e-asset-${Date.now()}` },
  });
  assert.ok(created.ok);
  const projectId = created.data.id;

  try {
    const pngPath = path.join(__dirname, 'fixtures', 'test-pixel.png');
    if (!fs.existsSync(pngPath)) {
      const buf = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      fs.mkdirSync(path.dirname(pngPath), { recursive: true });
      fs.writeFileSync(pngPath, buf);
    }
    const fd = new FormData();
    fd.append('name', 'e2e-png');
    fd.append('flowgen_asset_tag', 'PERSON');
    fd.append('file', new Blob([fs.readFileSync(pngPath)], { type: 'application/octet-stream' }), 'test.png');

    const up = await api(`/projects/${projectId}/assets?flowgen_asset_tag=PERSON`, {
      token,
      method: 'POST',
      formData: fd,
    });
    assert.ok(up.ok, `upload: ${JSON.stringify(up.data)}`);
    const assetId = up.data.id;
    assert.equal(up.data.mime, 'image/png', 'server should normalize png mime');

    const thumb = await api(`/projects/${projectId}/assets/${assetId}/thumb`, { token });
    assert.ok(thumb.ok && thumb.status === 200, `thumb status ${thumb.status}`);
    assert.ok(
      (thumb.headers.get('content-type') || '').includes('image'),
      `thumb content-type ${thumb.headers.get('content-type')}`
    );

    const file = await api(`/projects/${projectId}/assets/${assetId}/file`, { token });
    assert.ok(file.ok && file.status === 200, `file status ${file.status}`);

    const fileUrl = `/flowgen-api/projects/${projectId}/assets/${assetId}/file`;

    const nodeData = {
      label: 'Input Picture Node',
      imagePreview: fileUrl,
      projectAssetId: assetId,
      imageLocalRef: 'flowgen-local:u:proj:n:main',
    };
    const v = validateTemplateUsesProjectAssetLibrary(nodeData, projectId);
    assert.equal(v.ok, true, `validate template: ${v.ok === false ? v.error : ''}`);

    const spawn = validateStoryboardTableSpawn(
      sampleRows,
      [{ id: 'tpl', data: nodeData }],
      null,
      (id) => (id === 'tpl' ? nodeData : undefined),
      projectId
    );
    assert.equal(spawn.ok, true, `spawn validate: ${spawn.ok === false ? spawn.error : ''}`);

    const blobNode = {
      label: 't',
      imagePreview: 'blob:http://localhost/fake',
      imageLocalRef: 'flowgen-local:u:p:n:main',
      projectAssetId: assetId,
    };
    const v2 = validateTemplateUsesProjectAssetLibrary(blobNode, projectId);
    assert.equal(v2.ok, true, `blob+assetId: ${v2.ok === false ? v2.error : ''}`);

    console.log('[asset-storyboard-e2e] passed', { projectId, assetId });
  } finally {
    await api(`/projects/${projectId}`, { token, method: 'DELETE' });
  }
}

main().catch((e) => {
  console.error('[asset-storyboard-e2e] failed', e);
  process.exit(1);
});
