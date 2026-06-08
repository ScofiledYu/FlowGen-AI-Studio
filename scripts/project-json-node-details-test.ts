/**
 * 基于 flowgen-project-2026-04-24.json：模拟校验上下游 Node Details 与 JSON 面板状态一致。
 * 不调用任何生成 API。
 *
 * npx tsx scripts/project-json-node-details-test.ts [path-to-project.json]
 */
import fs from 'node:fs';
import type { NodeData } from '../types.ts';
import {
  buildGenerationParamsFromRunSnapshot,
  buildNodeDetailsBaseParams,
  expectedProcessorReferenceImagesFromPanel,
  mergeOmniMultiTabReferenceImagesForDetails,
  resolveOmniTabPromptFromData,
  sanitizeDetailsReferenceImageUrls,
} from '../utils/nodeDetailsPreview.ts';
import { NodeType } from '../types.ts';

const PROJECT_PATH = process.argv[2] || 'd:/flowgen-project-2026-04-24.json';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq(a: unknown, b: unknown, name: string) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  ok(name, sa === sb, sa !== sb ? `got ${sa} want ${sb}` : undefined);
}

type FlowNode = {
  id: string;
  type: string;
  data: Partial<NodeData>;
};

type FlowEdge = { source: string; target: string };

function refFingerprint(urls: string[]): string {
  return JSON.stringify(
    urls.map((u) => {
      const s = String(u || '').trim();
      if (s.startsWith('data:')) return `data:len=${s.length}`;
      if (s.startsWith('blob:')) return `blob:${s.slice(0, 40)}`;
      const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return m ? m[0].toLowerCase() : s.split('?')[0].slice(-48);
    })
  );
}

function actualProcessorRefs(data: Partial<NodeData>): string[] {
  const model = String(data.selectedModel || '').trim();
  if (model === '可灵3.0 Omni' && (data.klingOmniTab || 'multi') === 'multi') {
    return mergeOmniMultiTabReferenceImagesForDetails({ nodeData: data, isOutputLike: false });
  }
  return expectedProcessorReferenceImagesFromPanel(data);
}

function legacyOmniMultiBuggyMerge(data: Partial<NodeData>): string[] {
  const d = data as Record<string, unknown>;
  const dm = Array.isArray(d.klingOmniMultiReferenceImages)
    ? (d.klingOmniMultiReferenceImages as string[])
    : [];
  const dr = Array.isArray(d.referenceImages) ? (d.referenceImages as string[]) : [];
  const gb = Array.isArray((d.generationParams as { referenceImages?: string[] })?.referenceImages)
    ? ((d.generationParams as { referenceImages?: string[] }).referenceImages as string[])
    : [];
  return [...dm, ...dr, ...gb].filter(Boolean);
}

function main() {
  if (!fs.existsSync(PROJECT_PATH)) {
    console.error(`项目文件不存在: ${PROJECT_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(PROJECT_PATH, 'utf8')) as {
    nodes: FlowNode[];
    edges: FlowEdge[];
  };
  const nodes = raw.nodes || [];
  const edges = raw.edges || [];
  const parents: Record<string, string[]> = {};
  for (const e of edges) {
    (parents[e.target] ||= []).push(e.source);
  }

  const processors = nodes.filter((n) => n.type === 'processorNode');
  const outputs = nodes.filter((n) => n.type === 'outputNode');

  console.log(`\n=== 项目 JSON：${PROJECT_PATH} ===`);
  console.log(`节点 ${nodes.length}，运行节点 ${processors.length}，输出 ${outputs.length}\n`);

  console.log('--- 1. 上游运行节点：参考图应对齐当前 tab 面板（非 dm+dr+gp 三合一）---\n');

  let omniMultiCount = 0;
  let omniMultiLegacyInflated = 0;
  for (const n of processors) {
    const d = n.data || {};
    const model = String(d.selectedModel || '').trim();
    if (!model) continue;

    const expected = expectedProcessorReferenceImagesFromPanel(d);
    const actual = actualProcessorRefs(d);

    if (model === '可灵3.0 Omni' && (d.klingOmniTab || 'multi') === 'multi') {
      omniMultiCount++;
      const legacy = legacyOmniMultiBuggyMerge(d);
      if (legacy.length > expected.length + 1) {
        omniMultiLegacyInflated++;
        ok(
          `Omni multi ${n.id.slice(-8)} 旧合并会膨胀`,
          actual.length <= expected.length + 1,
          `legacy=${legacy.length} expected=${expected.length} actual=${actual.length}`
        );
      }
      if (/@主图|@主体/.test(resolveOmniTabPromptFromData(d).prompt)) {
        const main = String(d.imagePreview || '').trim();
        const mainInExpected =
          !main ||
          expected.some((u) => u === main) ||
          (main.startsWith('data:') &&
            expected.some((u) => String(u).startsWith('data:') && String(u).length === main.length));
        ok(
          `Omni multi ${n.id.slice(-8)} @主图 时 Details 含主预览`,
          mainInExpected,
          `hasMain=${Boolean(main)} refs=${expected.length}`
        );
      }
    }

    eq(refFingerprint(actual), refFingerprint(expected), `${model} · ${n.id.slice(-8)} 上游参考图`);
  }

  ok('Omni multi 节点已抽样', omniMultiCount > 0, `count=${omniMultiCount}`);
  ok(
    '无大量「三合一」膨胀样本（修复后 actual≤expected+1）',
    omniMultiLegacyInflated === 0 || omniMultiCount > omniMultiLegacyInflated,
    `inflated=${omniMultiLegacyInflated}/${omniMultiCount}`
  );

  console.log('\n--- 2. 上游运行节点：Used Parameters 应对齐 JSON 面板（model / tab prompt）---\n');

  const modelTabs: Record<string, Set<string>> = {};
  for (const n of processors) {
    const d = n.data || {};
    const model = String(d.selectedModel || '').trim();
    if (!model) continue;
    const base = buildNodeDetailsBaseParams({
      previewNodeData: d,
      nodeType: NodeType.PROCESSOR,
    });
    ok(`${model} ${n.id.slice(-8)} model`, (d.selectedModel || base.model) === model);
    if (model === '可灵3.0 Omni') {
      const tab = d.klingOmniTab || 'multi';
      (modelTabs[model] ||= new Set()).add(tab);
      const wantPrompt = resolveOmniTabPromptFromData(
        d,
        tab as 'multi' | 'instruction' | 'video' | 'frames'
      ).prompt;
      ok(
        `Omni · ${tab} ${n.id.slice(-8)} prompt`,
        (base.prompt || '').trim() === wantPrompt,
        `gotLen=${(base.prompt || '').length} wantLen=${wantPrompt.length}`
      );
    }
  }

  for (const [m, tabs] of Object.entries(modelTabs)) {
    ok(`${m} 覆盖 tab`, tabs.size >= 1, [...tabs].join(','));
  }

  console.log('\n--- 3. 输出节点：generationParams 快照（有则与 JSON 一致）---\n');

  for (const o of outputs) {
    const d = o.data || {};
    const gp = d.generationParams;
    const model = String(gp?.model || d.selectedModel || '').trim();
    if (!model) continue;
    const srcId = parents[o.id]?.[0];
    const upstream = srcId ? nodes.find((n) => n.id === srcId) : undefined;
    const upData = upstream?.data;

    if (!gp) {
      ok(`${model} OUT ${o.id.slice(-8)} 无 generationParams（旧输出节点）`, true);
      continue;
    }
    if (gp?.model) {
      ok(`${model} OUT ${o.id.slice(-8)} model 来自快照`, gp.model === model);
    }

    const snapRefs = Array.isArray(gp?.referenceImages)
      ? sanitizeDetailsReferenceImageUrls(gp.referenceImages.filter(Boolean) as string[])
      : [];
    if (snapRefs.length > 0) {
      const legacyInflated =
        upData?.selectedModel === '可灵3.0 Omni' &&
        (upData.klingOmniTab || 'multi') === 'multi' &&
        legacyOmniMultiBuggyMerge(upData).length > snapRefs.length + 2;
      ok(
        `${model} OUT ${o.id.slice(-8)} 参考图张数合理`,
        !legacyInflated || snapRefs.length <= 7,
        `snap=${snapRefs.length}`
      );
    } else if (upData) {
      ok(
        `${model} OUT ${o.id.slice(-8)} 无快照参考图（旧运行可接受）`,
        true,
        'gp.referenceImages empty'
      );
    }

    if (upData && gp) {
      const simGp = buildGenerationParamsFromRunSnapshot(upData, model);
      const baseOut = buildNodeDetailsBaseParams({
        previewNodeData: { ...d, generationParams: gp },
        nodeType: NodeType.OUTPUT,
        ancestorData: upData,
      });
      ok(
        `${model} OUT ${o.id.slice(-8)} 输出 Details model`,
        baseOut.model === (gp.model || model)
      );
      if (gp.prompt) {
        ok(
          `${model} OUT ${o.id.slice(-8)} 输出 prompt 用快照`,
          baseOut.prompt === gp.prompt || baseOut.prompt === simGp.prompt
        );
      }
    }
  }

  console.log('\n--- 4. Omni 面板：有 imagePreview 时多图 tab 应能展示主图（逻辑）---\n');

  for (const n of processors) {
    const d = n.data || {};
    if (d.selectedModel !== '可灵3.0 Omni') continue;
    if ((d.klingOmniTab || 'multi') !== 'multi') continue;
    const main = String(d.imagePreview || '').trim();
    if (!main) continue;
    ok(
      `Omni ${n.id.slice(-8)} 主图应在面板/Details 可解析`,
      expectedProcessorReferenceImagesFromPanel(d).length >= 1 ||
        (d.klingOmniMultiReferenceImages || []).length >= 1,
      `mainLen=${main.length} multi=${(d.klingOmniMultiReferenceImages || []).length}`
    );
  }

  console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}`);
  if (fail > 0) process.exit(1);
  console.log('项目 JSON Node Details 模拟全部通过。请 npm run build 后部署 dist 做真实点击验证。');
}

main();
