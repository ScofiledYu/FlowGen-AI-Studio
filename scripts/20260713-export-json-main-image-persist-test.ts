/**
 * 导出 JSON 跨机器：@主图 + imageLocalRef + COS imagePreview 勿被 hydrate 清空
 * fixture: scripts/fixtures/20260713-export-json-main-image-persist.json
 *
 * npx tsx scripts/20260713-export-json-main-image-persist-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeType } from '../types.ts';
import type { NodeData } from '../types.ts';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
import { resolveCanvasNodePreviewUrl } from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  '20260713-export-json-main-image-persist.json'
);

console.log('\n=== 20260713 导出 JSON：INPUT @主图 + COS 主预览跨机器保留 ===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; type: string; data: NodeData }>;
  };
  const node0 = raw.nodes.find((n) => n.id === 'node_0_1783922001453');
  ok('fixture 含 INPUT 节点', Boolean(node0));
  if (!node0) {
    console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
    process.exit(1);
  }

  const data = node0.data;
  const mainPreview = String(data.imagePreview || '').trim();
  const ref0 = String(data.referenceImages?.[0] || '').trim();

  ok('JSON 含 COS 主图 imagePreview', mainPreview.includes('openApi/212508/8cdbc6d8'));
  ok('JSON 含 imageLocalRef', Boolean(data.imageLocalRef));
  ok('panelMainSlotVisible=true（@主图）', data.panelMainSlotVisible === true);
  ok('主图 ≠ 面板首参考槽', mainPreview !== ref0, `${mainPreview.slice(-12)} vs ${ref0.slice(-12)}`);

  const hydrated = hydrateNodeImagePreviewFromPersisted({
    id: node0.id,
    type: NodeType.PROCESSOR,
    data: data as unknown as Record<string, unknown>,
  });
  const after = hydrated.data as unknown as NodeData;
  const hydratedPreview = String(after.imagePreview || '').trim();

  ok(
    'hydrate 后保留 COS 主图（勿清空走 IDB）',
    hydratedPreview === mainPreview,
    hydratedPreview || '(empty)'
  );
  ok(
    '画布缩略图=主图',
    resolveCanvasNodePreviewUrl(after) === mainPreview,
    String(resolveCanvasNodePreviewUrl(after) || '').slice(-24)
  );
}

console.log('\n=== §2. @主图但 imagePreview 误为首参考槽 COS 时仍应清空以走 IDB ===\n');

{
  const main = 'https://cos.example.com/openApi/main.png';
  const ref0 = 'https://cos.example.com/openApi/ref-first.png';
  const proc = {
    id: 'proc-wrong-ref0',
    type: NodeType.PROCESSOR,
    data: {
      imagePreview: ref0,
      imageLocalRef: 'flowgen-local:scope:node:main',
      panelMainSlotVisible: true,
      referenceImages: [ref0],
      prompt: '@主图参考@图片1风格',
      generationParams: {
        referenceImages: [main, ref0],
      },
    },
  };
  const hydrated = hydrateNodeImagePreviewFromPersisted(proc);
  ok(
    '@主图 + preview=ref0 → hydrate 清空待 IDB',
    String(hydrated.data?.imagePreview || '') === '',
    String(hydrated.data?.imagePreview || '')
  );
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);
