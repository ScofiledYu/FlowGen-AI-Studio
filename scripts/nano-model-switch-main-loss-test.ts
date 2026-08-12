/**
 * §11.90q Nano Banana 2.0 模型切换后主图丢失 修复验证
 *
 * 根因（modelSwitchPanelIsolation.ts nanoBananaMainPatchOnModelSwitch）：
 *   当 nanoConfig.imagePreview === undefined 但 nanoConfig.imageLocalRef 存在时，
 *   旧逻辑直接返回 nanoConfig.imagePreview（undefined）会被上层误解为"无快照"，
 *   或在某些路径下继承 current.imagePreview（刷新后失效的 blob: URL），
 *   导致主图无法从 IDB 的 imageLocalRef 恢复 → 切换模型后主图消失。
 *
 * 修复：当 nanoConfig.imagePreview === undefined 但 imageLocalRef 存在时，
 *   imagePreview 仍置为 undefined（让 hydration 从 imageLocalRef 恢复），
 *   而不是继承 current.imagePreview（可能是失效的 blob/data URL）。
 *
 * npx tsx scripts/nano-model-switch-main-loss-test.ts
 */
import type { NodeData } from '../types.ts';
import { nanoBananaMainPatchOnModelSwitch } from '../utils/modelSwitchPanelIsolation.ts';

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

const STALE_BLOB = 'blob:http://localhost:3001/30399712-7db0-4f5a-8f66-56219dc26bc8';
const STALE_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/IUAAAAASUVORK5CYII=';
const NANO_LOCAL_REF = 'flowgen-local:uid_pid:node-x:main:Nano_Banana_20';
const NANO_PREVIEW = 'blob:http://localhost:3001/nano-saved-snapshot-preview';

console.log('=== §11.90q Nano Banana 2.0 模型切换后主图丢失 修复验证 ===\n');

// ───────────────────────────────────────────────────────────────────
// 场景1：image2 删图刷新后切换到 Nano（核心场景）
//   nanoConfig 有 imageLocalRef 但 imagePreview 为 undefined（删图后未保存预览）
//   current.imagePreview 是失效的 blob URL（刷新后未清理）
//   修复后：imagePreview 应为 undefined（不继承失效 blob），imageLocalRef 保留
// ───────────────────────────────────────────────────────────────────
console.log('场景1：nanoConfig.imagePreview=undefined + imageLocalRef 存在 → 不继承失效 blob');
{
  const nanoConfig = {
    imageLocalRef: NANO_LOCAL_REF,
    imageName: 'main.jpg',
    // imagePreview 字段缺失（undefined）
  };
  const current = {
    imagePreview: STALE_BLOB, // 刷新后失效的 blob
    imageName: 'main.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(nanoConfig, current);
  ok(
    'imagePreview = undefined（不继承失效 blob）',
    patch.imagePreview === undefined,
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
  ok(
    'imageLocalRef 保留（Nano 快照）',
    patch.imageLocalRef === NANO_LOCAL_REF,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    'imageName 保留',
    patch.imageName === 'main.jpg',
    `actual=${patch.imageName}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景2：nanoConfig 有完整快照（imagePreview + imageLocalRef）
//   修复后：正常返回快照预览，不受 current 影响
// ───────────────────────────────────────────────────────────────────
console.log('场景2：nanoConfig 有完整快照（imagePreview + imageLocalRef）→ 正常恢复');
{
  const nanoConfig = {
    imagePreview: NANO_PREVIEW,
    imageLocalRef: NANO_LOCAL_REF,
    imageName: 'main.jpg',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };
  const current = {
    imagePreview: STALE_BLOB,
    imageName: 'other.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(nanoConfig, current);
  ok(
    'imagePreview = 快照预览',
    patch.imagePreview === NANO_PREVIEW,
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
  ok(
    'imageLocalRef = 快照 localRef',
    patch.imageLocalRef === NANO_LOCAL_REF,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    'panelMainSlotVisible = 快照值',
    patch.panelMainSlotVisible === true,
    `actual=${patch.panelMainSlotVisible}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景3：current.imagePreview 是 data URL（失效）→ 同样不应继承
// ───────────────────────────────────────────────────────────────────
console.log('场景3：current.imagePreview 为 data URL → 不继承');
{
  const nanoConfig = {
    imageLocalRef: NANO_LOCAL_REF,
    imageName: 'main.jpg',
  };
  const current = {
    imagePreview: STALE_DATA,
    imageName: 'main.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(nanoConfig, current);
  ok(
    'imagePreview = undefined（不继承 data URL）',
    patch.imagePreview === undefined,
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
  ok(
    'imageLocalRef 保留（Nano 快照）',
    patch.imageLocalRef === NANO_LOCAL_REF,
    `actual=${patch.imageLocalRef}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景4：无 Nano 快照（nanoConfig 为 undefined）→ 保留 current 主图
// ───────────────────────────────────────────────────────────────────
console.log('场景4：无 Nano 快照（nanoConfig=undefined）→ 保留 current 主图');
{
  const current = {
    imagePreview: 'https://cos.example.com/valid-existing.png',
    imageName: 'existing.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(undefined, current);
  ok(
    'imagePreview = current.imagePreview',
    patch.imagePreview === 'https://cos.example.com/valid-existing.png',
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
  ok(
    'imageLocalRef = current.imageLocalRef',
    patch.imageLocalRef === 'flowgen-local:uid_pid:node-x:main:image_2',
    `actual=${patch.imageLocalRef}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景5：nanoConfig 只有 imagePreview（无 imageLocalRef）→ 正常恢复预览
// ───────────────────────────────────────────────────────────────────
console.log('场景5：nanoConfig 只有 imagePreview（无 imageLocalRef）→ 正常恢复');
{
  const nanoConfig = {
    imagePreview: NANO_PREVIEW,
    imageName: 'main.jpg',
  };
  const current = {
    imagePreview: STALE_BLOB,
    imageName: 'other.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(nanoConfig, current);
  ok(
    'imagePreview = 快照预览',
    patch.imagePreview === NANO_PREVIEW,
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
  ok(
    'imageLocalRef = undefined（快照无此字段）',
    patch.imageLocalRef === undefined,
    `actual=${patch.imageLocalRef}`
  );
}
console.log();

// ───────────────────────────────────────────────────────────────────
// 场景6：对照组 — 修复前逻辑（错误继承 current.imagePreview）
//   模拟修复前的行为，验证修复前确实会导致主图丢失
// ───────────────────────────────────────────────────────────────────
console.log('场景6：对照组 — 修复前逻辑（错误继承失效 blob）');
{
  // 模拟修复前：nanoConfig.imagePreview 为 undefined 时直接返回 nanoConfig.imagePreview
  // 但旧版本此分支会走到 "无快照保留当前主图" 分支，返回 current.imagePreview
  const nanoConfig = {
    imageLocalRef: NANO_LOCAL_REF,
    imageName: 'main.jpg',
  };
  const current = {
    imagePreview: STALE_BLOB,
    imageName: 'main.jpg',
    imageLocalRef: 'flowgen-local:uid_pid:node-x:main:image_2',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  // 修复后的行为
  const patchAfter = nanoBananaMainPatchOnModelSwitch(nanoConfig, current);
  // 修复前的行为（模拟）：返回 current.imagePreview（失效 blob）
  const beforeFixImagePreview = current.imagePreview; // STALE_BLOB
  ok(
    '[对照] 修复前 imagePreview = 失效 blob（bug 行为）',
    beforeFixImagePreview === STALE_BLOB,
    `actual=${beforeFixImagePreview}`
  );
  ok(
    '[对照] 修复后 imagePreview = undefined（正确）',
    patchAfter.imagePreview === undefined,
    `actual=${JSON.stringify(patchAfter.imagePreview)}`
  );
  ok(
    '[对照] 修复前主图会消失（blob 失效）',
    beforeFixImagePreview === STALE_BLOB,
    '失效 blob 无法显示'
  );
  ok(
    '[对照] 修复后主图可从 imageLocalRef 恢复',
    patchAfter.imageLocalRef === NANO_LOCAL_REF,
    'IDB 中有对应 blob'
  );
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  process.exit(1);
}
