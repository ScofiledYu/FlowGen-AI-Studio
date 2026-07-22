import fs from 'fs';
import type { GenerationParams, NodeData } from '../types.ts';
import { buildSeedanceReferenceDetailsFromSnapshot } from '../utils/nodeDetailsPreview.ts';
import {
  pickSeedanceReferencePanelSnapshot,
  repairSeedanceReferenceGenerationParamsFromPanel,
} from '../utils/referencedMediaRun.ts';

function testSeedanceDetails(
  nodeData: NodeData,
  gp: GenerationParams,
  panelSource: Partial<NodeData>,
  name: string
) {
  const rawRefs = (gp.referenceImages || []) as string[];
  const rawLabels = (gp.referenceImageLabels || []) as string[];

  console.log(`\n=== ${name} ===`);
  console.log('generationParams.referenceImages (原始):');
  rawRefs.forEach((u: string, i: number) => {
    console.log(`  [${i}] ${u ? u.slice(-20) : '(空)'}`);
  });
  console.log('generationParams.referenceImageLabels (原始):');
  rawLabels.forEach((l: string, i: number) => {
    console.log(`  [${i}] ${l || '(空)'}`);
  });

  const displayRefs = (gp?.referenceImages || []) as string[];
  const displayLabels = (gp?.referenceImageLabels || []) as string[];

  const details = buildSeedanceReferenceDetailsFromSnapshot({
    snapshotRefs: displayRefs,
    snapshotLabels: displayLabels,
    prompt: String(gp.prompt || ''),
  });

  console.log('Node Details 结果:');
  details.referenceImageDetailItems.forEach((item) => {
    console.log(`  ${item.label}: ${item.url.slice(-20)}`);
  });

  return details.referenceImageDetailItems;
}

function testProcessorJson(path: string, name: string) {
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  const proc = json.nodes.find((n: { type: string }) => n.type === 'processorNode');
  if (!proc) throw new Error('processorNode missing');
  const nodeData = proc.data as NodeData;
  const gp = nodeData.generationParams!;
  return testSeedanceDetails(nodeData, gp, {
    ...nodeData,
    selectedModel: nodeData.selectedModel,
    seedanceGenerationMode: 'reference',
  }, `${name} (processor)`);
}

function testMovJson(path: string, name: string) {
  const json = JSON.parse(fs.readFileSync(path, 'utf8'));
  const mov = json.nodes.find((n: { type: string }) => n.type === 'movNode');
  const proc = json.nodes.find((n: { type: string }) => n.type === 'processorNode');
  if (!mov) throw new Error('movNode missing');
  if (!proc) throw new Error('processorNode missing');
  const movData = mov.data as NodeData;
  const movGp = movData.generationParams!;
  const ancestorData = proc.data as NodeData;
  return testSeedanceDetails(movData, movGp, {
    ...ancestorData,
    selectedModel: movData.selectedModel || ancestorData.selectedModel,
    seedanceGenerationMode: 'reference',
  }, `${name} (movNode)`);
}

const result3Proc = testProcessorJson('E:/问题/seedance3.json', 'seedance3.json');
const result3Mov = testMovJson('E:/问题/seedance3.json', 'seedance3.json');

console.log('\n=== 验证 seedance3.json (processor vs mov) ===');
let pass3 = true;
if (result3Proc.length !== result3Mov.length) {
  console.log(`  [FAIL] processor 有 ${result3Proc.length} 张，mov 有 ${result3Mov.length} 张`);
  pass3 = false;
} else {
  result3Proc.forEach((procItem, i) => {
    const movItem = result3Mov[i];
    const ok = procItem.label === movItem.label && procItem.url === movItem.url;
    console.log(`  [${i}] ${procItem.label}:${procItem.url.slice(-20)} -> ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) pass3 = false;
  });
}

if (!pass3) {
  console.log('\n❌ 验证失败');
  process.exit(1);
}
console.log('\n✅ seedance3.json 验证通过！');
