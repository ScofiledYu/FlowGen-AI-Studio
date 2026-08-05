/**
 * 复现 + 锁定修复：运行失败刷新后主图 blob 丢失（§10.69）
 *
 * 根因：运行失败 catch 回滚 imagePreview=panelMainImageUrl 备份（blob）+ panelMainSlotVisible:true。
 *   刷新后 hydrateNodeImagePreviewFromPersisted 的 shouldClearForLocalMainRestore
 *   未覆盖"imagePreview 是失效 blob + 有 imageLocalRef + 主图格显示"→ 不清空 → 不走 IDB 恢复 → blob 丢失。
 *
 * 修复：shouldClearForLocalMainRestore 新增条件
 *   (!isPersistableMediaUrl(current) && hasLocalMainRef && !panelMainHidden)
 *   → 清空 imagePreview='' 让 hydrateLocalMediaPreviews 从 IDB 恢复原主图。
 *
 * npx tsx scripts/run-error-hydrate-blob-recovery-test.ts
 */
import type { NodeData, GenerationParams } from '../types.ts';
import { NodeType } from '../types.ts';
import type { Node as RFNode } from 'reactflow';
import { hydrateNodeImagePreviewFromPersisted } from '../utils/hydratePersistedNodePreviews.ts';

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
    type: partial.type || NodeType.INPUT,
    position: { x: 0, y: 0 },
    data: { label: 'n', ...partial.data } as NodeData,
  };
}

console.log('\n=== 场景1：运行失败回滚后刷新（blob 备份 + imageLocalRef）→ hydrate 清空让 IDB 恢复 ===\n');

{
  // 运行失败 catch 回滚后：imagePreview=blob 备份 + panelMainSlotVisible=true + imageLocalRef
  const node = simNode({
    id: 'run-1',
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'blob:https://app/abc-123', // panelMainImageUrl 备份的 blob（失效）
      panelMainSlotVisible: true, // catch 回滚为 true
      panelMainImageUrl: undefined, // catch 已清备份
      imageLocalRef: 'idb-key-main-001', // IDB 有原主图
      referenceImages: ['https://cos.example.com/ref-first.jpg', 'https://cos.example.com/ref-second.jpg'],
      generationParams: { model: 'Nano Banana 2.0', referenceImages: ['https://cos.example.com/ref-first.jpg'] } as GenerationParams,
    },
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  ok('hydrate 后 imagePreview 被清空（让 IDB 恢复）', hydrated.data.imagePreview === '', String(hydrated.data.imagePreview));
  ok('imageLocalRef 保留', hydrated.data.imageLocalRef === 'idb-key-main-001');
}

console.log('\n=== 场景2：运行成功未 @主图（参考 COS URL + panelMainSlotVisible:false）→ 不清空 ===\n');

{
  const node = simNode({
    id: 'run-2',
    data: {
      selectedModel: 'image 2',
      imagePreview: 'https://cos.example.com/ref-first-attributed.jpg', // 运行后切为首个 @参考 COS
      panelMainSlotVisible: false, // 运行后隐藏主图格
      imageLocalRef: 'idb-key-main-002',
      referenceImages: ['https://cos.example.com/ref-first.jpg'],
      generationParams: { model: 'image 2', referenceImages: ['https://cos.example.com/ref-first.jpg'] } as GenerationParams,
    },
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  ok('hydrate 后 imagePreview 保留参考 COS URL', hydrated.data.imagePreview === 'https://cos.example.com/ref-first-attributed.jpg', String(hydrated.data.imagePreview));
}

console.log('\n=== 场景3：运行成功 @主图（主图 COS URL + panelMainSlotVisible:true）→ 不清空 ===\n');

{
  const node = simNode({
    id: 'run-3',
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'https://cos.example.com/main-uploaded.jpg', // @主图 上传后 COS
      panelMainSlotVisible: true,
      imageLocalRef: 'idb-key-main-003',
      referenceImages: ['https://cos.example.com/ref-other.jpg'], // 参考图是其他图，不含主图
      generationParams: { model: 'Nano Banana 2.0' } as GenerationParams,
    },
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  ok('hydrate 后 imagePreview 保留主图 COS URL', hydrated.data.imagePreview === 'https://cos.example.com/main-uploaded.jpg', String(hydrated.data.imagePreview));
}

console.log('\n=== 场景4：无 imageLocalRef（blob + 无 IDB 备份）→ 不清空（避免丢图，无 IDB 可恢复） ===\n');

{
  const node = simNode({
    id: 'run-4',
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'blob:https://app/xyz', // blob 但无 imageLocalRef
      panelMainSlotVisible: true,
      imageLocalRef: undefined, // 无 IDB 备份
      referenceImages: ['https://cos.example.com/ref.jpg'],
      generationParams: { model: 'Nano Banana 2.0' } as GenerationParams,
    },
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  // 无 imageLocalRef 时不清空（hasLocalMainRef=false，新增条件不触发），保持原样
  ok('hydrate 后 imagePreview 保持原样（无 IDB 可恢复）', hydrated.data.imagePreview === 'blob:https://app/xyz', String(hydrated.data.imagePreview));
}

console.log('\n=== 场景5：对照旧行为 —— 修复前场景1 会保持失效 blob（防回退） ===\n');

{
  // 旧行为：shouldClearForLocalMainRestore 不含新条件 → imagePreview 保持失效 blob
  // 修复后：新条件触发 → imagePreview=''
  // 此场景与场景1相同，验证修复生效（若回退修复，此场景会 FAIL）
  const node = simNode({
    id: 'run-5',
    data: {
      selectedModel: 'Nano Banana 2.0',
      imagePreview: 'blob:https://app/old-backup',
      panelMainSlotVisible: true,
      imageLocalRef: 'idb-key-main-005',
      referenceImages: ['https://cos.example.com/ref.jpg'],
      generationParams: { model: 'Nano Banana 2.0' } as GenerationParams,
    },
  });
  const hydrated = hydrateNodeImagePreviewFromPersisted(node);
  ok('修复后 imagePreview 被清空（旧行为会保持失效 blob → 主图丢失）', hydrated.data.imagePreview === '', `imagePreview=${hydrated.data.imagePreview}（旧行为=blob 失效）`);
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
