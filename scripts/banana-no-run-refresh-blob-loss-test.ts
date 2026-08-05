/**
 * 复现：Banana 节点未运行，仅上传主图后刷新，blob 图片丢失
 * npx tsx scripts/banana-no-run-refresh-blob-loss-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';
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

console.log('=== 场景1：Banana 未运行，仅上传主图（blob + imageLocalRef），刷新 ===\n');

{
  // 模拟用户上传主图后的内存状态
  const beforePersist: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'blob:http://localhost:3001/abc-123-main',
    imageLocalRef: 'flowgen-local:uid_pid:node_main:Nano_Banana_20',
    imageName: 'test.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
    generationParams: undefined, // 未运行，无 gp
  };

  console.log('刷新前 imagePreview:', beforePersist.imagePreview);
  console.log('刷新前 imageLocalRef:', beforePersist.imageLocalRef);
  console.log('刷新前 generationParams:', beforePersist.generationParams);

  // 步骤1：模拟 persist sanitize（blob 被剥离）
  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  console.log('\npersist 后 imagePreview:', JSON.stringify(saved.imagePreview));
  console.log('persist 后 imageLocalRef:', saved.imageLocalRef);
  console.log('persist 后 generationParams:', JSON.stringify(saved.generationParams));

  ok('imageLocalRef 保留', Boolean(saved.imageLocalRef), String(saved.imageLocalRef || ''));
  ok('imagePreview 被剥离（blob 不可持久化）', saved.imagePreview === undefined || saved.imagePreview === '', JSON.stringify(saved.imagePreview));

  // 步骤2：模拟 hydrateNodeImagePreviewFromPersisted（第一层 hydrate）
  const node = simNode({
    id: 'banana-1',
    type: NodeType.PROCESSOR,
    data: saved,
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  const afterHydrate = hydrated.data as unknown as Partial<NodeData>;
  console.log('\nhydratePhase1 后 imagePreview:', JSON.stringify(afterHydrate.imagePreview));
  console.log('hydratePhase1 后 imageLocalRef:', afterHydrate.imageLocalRef);

  ok('hydratePhase1 后 imagePreview 为空（待 IDB 恢复）', !afterHydrate.imagePreview || afterHydrate.imagePreview === '', JSON.stringify(afterHydrate.imagePreview));
  ok('hydratePhase1 后 imageLocalRef 保留', Boolean(afterHydrate.imageLocalRef));

  // 步骤3：模拟 hydrateLocalMediaPreviews 的判断条件（第二层 hydrate）
  const shouldRecover = !shouldPreferRunReferencePreviewOverLocalMain(afterHydrate as Partial<NodeData>);
  console.log('\nshouldPreferRunReferencePreviewOverLocalMain:', shouldPreferRunReferencePreviewOverLocalMain(afterHydrate as Partial<NodeData>));
  ok('shouldPreferRunReferencePreviewOverLocalMain 返回 false（无 gp 参考图）', !shouldPreferRunReferencePreviewOverLocalMain(afterHydrate as Partial<NodeData>));

  const previewEmpty = !afterHydrate.imagePreview || isEphemeralMediaUrl(String(afterHydrate.imagePreview || ''), 'imagePreview');
  console.log('imagePreview 为空或 ephemeral:', previewEmpty);
  ok('imagePreview 为空或 ephemeral → 触发 IDB 恢复', previewEmpty);

  const canRecover = shouldRecover && previewEmpty;
  ok('整体判断：允许从 IDB 恢复主图', canRecover, `shouldRecover=${shouldRecover} previewEmpty=${previewEmpty}`);
}

console.log('\n=== 场景2：Banana 未运行，无 imageLocalRef（未写入 IDB）→ 无法恢复 ===\n');

{
  const beforePersist: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'blob:http://localhost:3001/xyz-no-idb',
    imageLocalRef: undefined, // 未写入 IDB
    imageName: 'test.png',
    panelMainSlotVisible: true,
    prompt: '',
    status: 'idle',
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  console.log('persist 后 imageLocalRef:', saved.imageLocalRef);
  ok('无 imageLocalRef → 无法从 IDB 恢复', !saved.imageLocalRef);

  const node = simNode({
    id: 'banana-2',
    type: NodeType.PROCESSOR,
    data: saved,
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  const afterHydrate = hydrated.data as unknown as Partial<NodeData>;
  console.log('hydratePhase1 后 imagePreview:', JSON.stringify(afterHydrate.imagePreview));
  console.log('hydratePhase1 后 imageLocalRef:', afterHydrate.imageLocalRef);
}

console.log('\n=== 场景3：Banana 未运行，有 panelMainImageUrl 备份（blob）→ hydrate 应清空走 IDB ===\n');

{
  const beforePersist: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    imagePreview: 'blob:http://localhost:3001/main-blob',
    panelMainImageUrl: 'blob:http://localhost:3001/main-blob', // 备份也是 blob
    panelMainSlotVisible: true,
    imageLocalRef: 'flowgen-local:uid_pid:node_main:Nano_Banana_20',
    imageName: 'test.png',
    prompt: '',
    status: 'idle',
  };

  const saved = sanitizePersistValueDeep(beforePersist) as Partial<NodeData>;
  console.log('persist 后 imagePreview:', JSON.stringify(saved.imagePreview));
  console.log('persist 后 panelMainImageUrl:', JSON.stringify(saved.panelMainImageUrl));
  console.log('persist 后 imageLocalRef:', saved.imageLocalRef);

  ok('imagePreview 被剥离', saved.imagePreview === undefined || saved.imagePreview === '');
  ok('panelMainImageUrl 也被剥离', saved.panelMainImageUrl === undefined || saved.panelMainImageUrl === '');
  ok('imageLocalRef 保留', Boolean(saved.imageLocalRef));

  const node = simNode({
    id: 'banana-3',
    type: NodeType.PROCESSOR,
    data: saved,
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  const afterHydrate = hydrated.data as unknown as Partial<NodeData>;
  console.log('hydratePhase1 后 imagePreview:', JSON.stringify(afterHydrate.imagePreview));

  const shouldClear = !afterHydrate.imagePreview || afterHydrate.imagePreview === '';
  ok('hydratePhase1 后 imagePreview 为空 → 待 IDB 恢复', shouldClear, JSON.stringify(afterHydrate.imagePreview));
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);