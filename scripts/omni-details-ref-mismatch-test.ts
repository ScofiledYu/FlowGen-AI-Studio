/**
 * 复现 d:/json/node details参考图不一致.json：可灵 Omni processor vs MOV Node Details 参考图不一致
 * npx tsx scripts/omni-details-ref-mismatch-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
  ancestorOmniPanelMergeAllowedForDetails,
} from '../utils/nodeDetailsPreview.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const json = JSON.parse(fs.readFileSync('d:/json/node details参考图不一致.json', 'utf8'));
const proc = json.nodes.find((n: { type: string }) => n.type === 'processorNode');
const mov = json.nodes.find((n: { type: string }) => n.type === 'movNode');
if (!proc || !mov) throw new Error('nodes missing');

const procData = proc.data as NodeData;
const movData = mov.data as NodeData;
const gp = procData.generationParams!;
const prompt = String(gp.prompt || '');
const snapRefs = (gp.referenceImages || []) as string[];
const snapLabels = gp.referenceImageLabels as string[] | undefined;
const movUrlSet = new Set<string>();

function buildDetails(
  previewData: Partial<NodeData>,
  ancestor: Partial<NodeData> | null,
  isOutputLike: boolean
) {
  const panel = buildOmniPanelSourceForNodeDetails({
    previewNodeData: previewData,
    generationParams: (previewData.generationParams || gp) as typeof gp,
    ancestorData: ancestor,
    isOutputLike,
    omniTab: 'multi',
    modelStr: '可灵3.0 Omni',
    resolvedPrompt: prompt,
  });
  const urlPool = [
    ...snapRefs,
    ...(panel.klingOmniMultiReferenceImages || []),
    ...(panel.imagePreview && !String(panel.imagePreview).includes('.mp4') ? [panel.imagePreview] : []),
  ].filter(Boolean) as string[];
  return buildOmniMultiTabDetailsReferencePreview({
    panelSource: panel,
    urlPool,
    snapshotRefs: snapRefs,
    snapshotLabels: snapLabels,
    prompt,
    movUrlSet,
  });
}

const detailsProc = buildDetails(procData, null, false);
const detailsMov = buildDetails(movData, procData, true);

console.log('taskId proc', procData.taskId, 'mov', movData.taskId);
console.log(
  'merge allowed',
  ancestorOmniPanelMergeAllowedForDetails(movData, procData)
);
console.log('PROC', detailsProc.referenceImageDetailItems.map((i) => `${i.label}:${i.url.slice(-16)}`));
console.log('MOV ', detailsMov.referenceImageDetailItems.map((i) => `${i.label}:${i.url.slice(-16)}`));

ok(
  'processor 与 MOV Details 参考图数量一致',
  detailsProc.referenceImageDetailItems.length === detailsMov.referenceImageDetailItems.length,
  `${detailsProc.referenceImageDetailItems.length} vs ${detailsMov.referenceImageDetailItems.length}`
);
ok(
  'processor 与 MOV Details 标签一致',
  JSON.stringify(detailsProc.referenceImageDetailItems.map((i) => i.label)) ===
    JSON.stringify(detailsMov.referenceImageDetailItems.map((i) => i.label)),
  JSON.stringify(detailsProc.referenceImageDetailItems.map((i) => i.label)) +
    ' vs ' +
    JSON.stringify(detailsMov.referenceImageDetailItems.map((i) => i.label))
);
ok(
  'processor 与 MOV Details URL 一致',
  JSON.stringify(detailsProc.referenceImageDetailItems.map((i) => i.url)) ===
    JSON.stringify(detailsMov.referenceImageDetailItems.map((i) => i.url))
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
