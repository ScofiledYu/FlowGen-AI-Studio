/**
 * 端到端模拟：Banana 节点未运行 → 上传主图 → 持久化 → 刷新 → 全链路 hydration
 * npx tsx scripts/banana-no-run-full-flow-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateNodeImagePreviewFromPersisted, hydrateGraphMediaFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
import { normalizeGraphNodesProjectAssetBinding } from '../utils/normalizeTemplateNodeForSpawn.ts';
import { shouldPreferRunReferencePreviewOverLocalMain } from '../utils/referencedMediaRun.ts';
import { isEphemeralMediaUrl } from '../utils/workspaceMediaPersist.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function simNode(partial: { id: string; type?: NodeType; data: Partial<NodeData> }): RFNode {
  return {
    id: partial.id,
    type: partial.type || NodeType.PROCESSOR,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

console.log('=== 全链路模拟：Banana 未运行 → 上传主图 → persist → 刷新 → hydrate ===\n');

const serverProjectId = 'proj-123';

// 阶段1：用户上传主图后的内存状态（blob URL + imageLocalRef）
const stage1_memory: RFNode[] = [
  simNode({
    id: 'banana-main',
    type: NodeType.PROCESSOR,
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'blob:http://localhost:3001/abc-main-upload',
      imageLocalRef: 'flowgen-local:uid_pid:banana-main:main:Nano_Banana_20',
      imageName: 'test-upload.png',
      panelMainSlotVisible: true,
      prompt: '',
      status: 'idle',
      generationParams: undefined,
    },
  }),
];

console.log('阶段1 - 内存状态:');
console.log('  imagePreview:', stage1_memory[0].data.imagePreview);
console.log('  imageLocalRef:', (stage1_memory[0].data as NodeData).imageLocalRef);

// 阶段2：模拟 persist sanitize（剥离 blob）
const stage2_persisted = stage1_memory.map((n) => sanitizePersistValueDeep(n)) as RFNode[];
console.log('\n阶段2 - persist 后:');
console.log('  imagePreview:', JSON.stringify(stage2_persisted[0].data.imagePreview));
console.log('  imageLocalRef:', (stage2_persisted[0].data as NodeData).imageLocalRef);
ok('persist 后 imagePreview 被剥离', stage2_persisted[0].data.imagePreview === undefined, JSON.stringify(stage2_persisted[0].data.imagePreview));
ok('persist 后 imageLocalRef 保留', Boolean((stage2_persisted[0].data as NodeData).imageLocalRef));

// 阶段3：模拟服务器返回 + loadPersistedProject 处理
// 步骤3a：hydrateGraphMediaFromPersisted
const stage3a = hydrateGraphMediaFromPersisted(stage2_persisted, []);
console.log('\n阶段3a - hydrateGraphMediaFromPersisted:');
console.log('  imagePreview:', JSON.stringify(stage3a[0].data.imagePreview));
console.log('  imageLocalRef:', (stage3a[0].data as NodeData).imageLocalRef);
ok('hydrateGraph 后 imagePreview 为空', !stage3a[0].data.imagePreview || stage3a[0].data.imagePreview === '', JSON.stringify(stage3a[0].data.imagePreview));

// 步骤3b：normalizeGraphNodesProjectAssetBinding
const stage3b = normalizeGraphNodesProjectAssetBinding(stage3a, serverProjectId);
console.log('\n阶段3b - normalizeGraphNodesProjectAssetBinding:');
console.log('  imagePreview:', JSON.stringify(stage3b[0].data.imagePreview));
console.log('  imageLocalRef:', (stage3b[0].data as NodeData).imageLocalRef);
console.log('  projectAssetId:', (stage3b[0].data as NodeData & { projectAssetId?: string }).projectAssetId);
ok('normalizeBinding 后 imageLocalRef 保留', Boolean((stage3b[0].data as NodeData).imageLocalRef), String((stage3b[0].data as NodeData).imageLocalRef || ''));
ok('normalizeBinding 后 imagePreview 仍为空', !stage3b[0].data.imagePreview || stage3b[0].data.imagePreview === '', JSON.stringify(stage3b[0].data.imagePreview));

// 阶段4：模拟 hydrateLocalMediaPreviews 的判断逻辑
const stage4_node = stage3b[0];
const nData = stage4_node.data as NodeData;
const boundAsset = (nData as NodeData & { projectAssetId?: string }).projectAssetId;
const ref = nData.imageLocalRef;
const shouldRecover = !shouldPreferRunReferencePreviewOverLocalMain(nData);
const previewEmpty = !nData.imagePreview || isEphemeralMediaUrl(String(nData.imagePreview || ''), 'imagePreview');
const canRecover = !boundAsset && ref && shouldRecover && previewEmpty;

console.log('\n阶段4 - hydrateLocalMediaPreviews 判断:');
console.log('  boundAsset:', boundAsset);
console.log('  imageLocalRef:', ref);
console.log('  shouldRecover (shouldPreferRun...=false):', shouldRecover);
console.log('  previewEmpty:', previewEmpty);
console.log('  canRecover:', canRecover);
ok('boundAsset 为空', !boundAsset);
ok('imageLocalRef 存在', Boolean(ref));
ok('shouldRecover 为 true', shouldRecover);
ok('previewEmpty 为 true', previewEmpty);
ok('最终判断：允许从 IDB 恢复主图', canRecover);

// 阶段5：验证参考图场景
console.log('\n=== 阶段5：Banana 未运行 + 参考图 + 刷新 ===\n');

const stage5_memory: RFNode[] = [
  simNode({
    id: 'banana-refs',
    type: NodeType.PROCESSOR,
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'blob:http://localhost:3001/main-ref-test',
      imageLocalRef: 'flowgen-local:uid_pid:banana-refs:main:Nano_Banana_20',
      imageName: 'main.png',
      panelMainSlotVisible: true,
      referenceImages: [
        'blob:http://localhost:3001/ref-0',
        'blob:http://localhost:3001/ref-1',
      ],
      referenceImageLabels: ['图片1', '图片2'],
      referenceImageLocalRefs: [
        'flowgen-local:uid_pid:banana-refs:ref:Nano_Banana_20:0',
        'flowgen-local:uid_pid:banana-refs:ref:Nano_Banana_20:1',
      ],
      prompt: '',
      status: 'idle',
    },
  }),
];

const stage5_persisted = stage5_memory.map((n) => sanitizePersistValueDeep(n)) as RFNode[];
console.log('persist 后 referenceImages:', (stage5_persisted[0].data as NodeData).referenceImages?.map(u => u ? u.slice(0, 20) : 'EMPTY'));
console.log('persist 后 referenceImageLocalRefs:', (stage5_persisted[0].data as NodeData).referenceImageLocalRefs);
ok('referenceImages 剥离但保留槽位', (stage5_persisted[0].data as NodeData).referenceImages?.length === 2 && (stage5_persisted[0].data as NodeData).referenceImages?.every(u => !u || !u.startsWith('blob:')), JSON.stringify((stage5_persisted[0].data as NodeData).referenceImages));
ok('referenceImageLocalRefs 保留', (stage5_persisted[0].data as NodeData).referenceImageLocalRefs?.length === 2);

const stage5_hydrated = hydrateGraphMediaFromPersisted(stage5_persisted, []);
const stage5_bound = normalizeGraphNodesProjectAssetBinding(stage5_hydrated, serverProjectId);
console.log('\n全链路后 referenceImages:', (stage5_bound[0].data as NodeData).referenceImages);
console.log('全链路后 referenceImageLocalRefs:', (stage5_bound[0].data as NodeData).referenceImageLocalRefs);
ok('全链路后 referenceImageLocalRefs 保留', (stage5_bound[0].data as NodeData).referenceImageLocalRefs?.length === 2);
ok('全链路后 referenceImages 槽位保留（空串待 IDB 恢复）', (stage5_bound[0].data as NodeData).referenceImages?.every(u => !u || u === ''), JSON.stringify((stage5_bound[0].data as NodeData).referenceImages));

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);