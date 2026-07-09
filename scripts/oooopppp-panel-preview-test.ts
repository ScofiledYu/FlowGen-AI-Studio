/**
 * oooopppp.json 回归：链式生成后原始 INPUT/PROCESSOR 节点
 * 1) hydrate 勿用 generationParams.outputUrl 覆盖画布主预览
 * 2) 面板 referenceImages 空时 Node Details 仍展示 gp / modelConfigs 参考图
 *
 * npx tsx scripts/oooopppp-panel-preview-test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeType } from '../types.ts';
import type { NodeData } from '../types.ts';
import {
  buildNodeDetailsReferencePreview,
  enrichPanelSourceFromGenerationSnapshot,
  resolveNodeSelectionPreviewUrl,
} from '../utils/nodeDetailsPreview.ts';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'oooopppp.json');

console.log('\n=== oooopppp §1. node_0：链式生成后 hydrate 不用 outputUrl ===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; type: string; data: NodeData }>;
  };
  const node0 = raw.nodes.find((n) => n.id === 'node_0_1782821064275');
  ok('fixture 含 node_0', Boolean(node0));
  if (node0) {
    const gp = node0.data.generationParams!;
    const outputUrl = String(gp.outputUrl || '');
    const firstRef = String(gp.referenceImages?.[0] || '');
    ok('gp 含 outputUrl', outputUrl.includes('imagesGenerations'));
    ok('gp 含参考图', firstRef.includes('openApi'));

    const hydrated = hydrateNodeImagePreviewFromPersisted({
      id: node0.id,
      type: NodeType.PROCESSOR,
      data: {
        ...node0.data,
        imagePreview: 'blob:http://localhost:3001/stale-preview',
      },
    });
    const preview = String(hydrated.data?.imagePreview || '');
    ok('hydrate 后非 outputUrl', preview !== outputUrl, preview);
    ok('hydrate 后为首张参考图', preview === firstRef, preview);
  }
}

console.log('\n=== oooopppp §2. node_0：面板 referenceImages 空时 Details 仍有参考图 ===\n');

{
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    nodes: Array<{ id: string; data: NodeData }>;
  };
  const node0 = raw.nodes.find((n) => n.id === 'node_0_1782821064275');
  if (node0) {
    const gp = node0.data.generationParams!;
    const model = String(gp.model || '');
    ok('运行模型为 Nano', model === 'Nano Banana 2.0');

    const panelSource = enrichPanelSourceFromGenerationSnapshot(
      { ...node0.data, selectedModel: model },
      gp
    );
    ok(
      'enrich 后面板含参考槽',
      (panelSource.referenceImages || []).some((u) => String(u || '').trim()),
      JSON.stringify(panelSource.referenceImages)
    );

    const snapRefs = (gp.referenceImages || []).filter(Boolean) as string[];
    const refPreview = buildNodeDetailsReferencePreview({
      panelSource,
      urlPool: snapRefs,
    });
    ok('Reference Images ≥2', refPreview.referenceImageDetailItems.length >= 2);
    ok(
      '含图片1标签',
      refPreview.referenceImageDetailItems.some((it) => it.label === '图片1')
    );
    ok(
      '含图片3标签',
      refPreview.referenceImageDetailItems.some((it) => it.label === '图片3')
    );

    const hero = resolveNodeSelectionPreviewUrl(
      enrichPanelSourceFromGenerationSnapshot(node0.data, gp)
    );
    ok('画布选中预览=首张参考', hero === snapRefs[0], hero);
    ok('画布预览非生成 outputUrl', hero !== gp.outputUrl, hero);
  }
}

console.log(`\n=== 汇总: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail > 0 ? 1 : 0);
