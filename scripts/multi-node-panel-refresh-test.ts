/**
 * 多节点 / 多模型面板：拖入参考图后 sanitize 保存，各节点 referenceImageLocalRefs 均保留
 * npx tsx scripts/multi-node-panel-refresh-test.ts
 */
import type { NodeData } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const longData = `data:image/jpeg;base64,${'B'.repeat(9000)}`;

const nodeBanana: Partial<NodeData> = {
  selectedModel: 'Nano Banana 2.0',
  imagePreview: 'blob:http://localhost/n1-main',
  referenceImages: [longData, longData],
  referenceImageLocalRefs: [
    'flowgen-local:uid_pid:node_banana:ref:0',
    'flowgen-local:uid_pid:node_banana:ref:1',
  ],
  referenceImageLabels: ['图片1', '图片2'],
};

const nodeImage2: Partial<NodeData> = {
  selectedModel: 'image 2',
  imagePreview: longData,
  imageLocalRef: 'flowgen-local:uid_pid:node_image2:main',
  referenceImages: [longData],
  referenceImageLocalRefs: ['flowgen-local:uid_pid:node_image2:ref:0'],
  referenceImageLabels: ['图片1'],
};

const nodeOmni: Partial<NodeData> = {
  selectedModel: '可灵3.0 Omni',
  klingOmniTab: 'multi',
  klingOmniMultiReferenceImages: [longData],
  klingOmniMultiReferenceLocalRefs: ['flowgen-local:uid_pid:node_omni:ref:0'],
  referenceImageLabels: ['图片1'],
};

console.log('\n=== 多节点 sanitize：各节点 localRefs 独立保留 ===\n');

for (const [label, node] of [
  ['Banana2', nodeBanana],
  ['image2', nodeImage2],
  ['Omni multi', nodeOmni],
] as const) {
  const saved = sanitizePersistValueDeep({ data: node }).data as NodeData;
  const localField =
    label === 'Omni multi' ? 'klingOmniMultiReferenceLocalRefs' : 'referenceImageLocalRefs';
  const refsField =
    label === 'Omni multi' ? 'klingOmniMultiReferenceImages' : 'referenceImages';
  ok(
    `${label} localRefs 保留`,
    Array.isArray(saved[localField]) && (saved[localField] as string[]).some(Boolean),
    JSON.stringify(saved[localField])
  );
  ok(
    `${label} referenceImages 剥离为占位`,
    Array.isArray(saved[refsField]) &&
      (saved[refsField] as string[]).every((u) => !String(u || '').startsWith('data:')),
    JSON.stringify(saved[refsField])
  );
}

console.log('\n=== 多模型 modelConfigs：切换快照含 localRefs ===\n');

const switchedNode = sanitizePersistValueDeep({
  data: {
    selectedModel: 'image 2',
    referenceImages: nodeImage2.referenceImages,
    referenceImageLocalRefs: nodeImage2.referenceImageLocalRefs,
    modelConfigs: {
      'Nano Banana 2.0': {
        referenceImages: ['', ''],
        referenceImageLocalRefs: nodeBanana.referenceImageLocalRefs,
      },
      image2: {
        referenceImages: [''],
        referenceImageLocalRefs: nodeImage2.referenceImageLocalRefs,
      },
    },
  },
}).data as NodeData;

ok(
  'Banana2 modelConfigs localRefs 保留',
  (switchedNode.modelConfigs?.['Nano Banana 2.0']?.referenceImageLocalRefs || []).length === 2,
  JSON.stringify(switchedNode.modelConfigs?.['Nano Banana 2.0']?.referenceImageLocalRefs)
);
ok(
  'image2 顶层 localRefs 保留',
  (switchedNode.referenceImageLocalRefs || []).length === 1,
  JSON.stringify(switchedNode.referenceImageLocalRefs)
);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
