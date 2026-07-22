import fs from 'fs';
import type { NodeData } from '../types.ts';
import {
  buildOmniMultiTabDetailsReferencePreview,
  buildOmniPanelSourceForNodeDetails,
} from '../utils/nodeDetailsPreview.ts';

const json = JSON.parse(fs.readFileSync('E:/问题/可灵.json', 'utf8'));
const outputNode = json.nodes.find((n: { type: string }) => n.type === 'outputNode');
if (!outputNode) throw new Error('outputNode missing');

const nodeData = outputNode.data as NodeData;
const gp = nodeData.generationParams!;
const prompt = String(gp.prompt || '');
const snapRefs = (gp.referenceImages || []) as string[];
const snapLabels = gp.referenceImageLabels as string[] | undefined;
const movUrlSet = new Set<string>();

console.log('=== 可灵3.0 Omni 多图参考测试 ===');
console.log('prompt:', prompt);
console.log('generationParams.referenceImages:', snapRefs.map((u, i) => `${i}: ${u.slice(-20)}`));
console.log('generationParams.referenceImageLabels:', snapLabels);
console.log('klingOmniMultiReferenceImages:', nodeData.klingOmniMultiReferenceImages?.map((u: string, i: number) => `${i}: ${u.slice(-20)}`) || 'empty');
console.log('referenceImageLabels:', nodeData.referenceImageLabels);

const panel = buildOmniPanelSourceForNodeDetails({
  previewNodeData: nodeData,
  generationParams: gp,
  ancestorData: null,
  isOutputLike: true,
  omniTab: 'multi',
  modelStr: '可灵3.0 Omni',
  resolvedPrompt: prompt,
});

const urlPool = [
  ...snapRefs,
  ...(panel.klingOmniMultiReferenceImages || []),
  ...(panel.imagePreview && !String(panel.imagePreview).includes('.mp4') ? [panel.imagePreview] : []),
].filter(Boolean) as string[];

const details = buildOmniMultiTabDetailsReferencePreview({
  panelSource: panel,
  urlPool,
  snapshotRefs: snapRefs,
  snapshotLabels: snapLabels,
  prompt,
  movUrlSet,
});

console.log('\n=== Node Details 结果 ===');
console.log('参考图:', details.referenceImageDetailItems.map((i) => `${i.label}: ${i.url.slice(-20)}`));

const expectedLabels = ['主图', '图片3'];
const actualLabels = details.referenceImageDetailItems.map((i) => i.label);
const labelsMatch = JSON.stringify(expectedLabels) === JSON.stringify(actualLabels);

console.log('\n=== 验证 ===');
console.log(`期望标签: ${expectedLabels}`);
console.log(`实际标签: ${actualLabels}`);
console.log(`标签匹配: ${labelsMatch ? 'OK' : 'FAIL'}`);

if (!labelsMatch) process.exit(1);
