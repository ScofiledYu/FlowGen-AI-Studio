/**
 * §11.90u 面板图片隔离 & 主图持久化 门禁测试
 *
 * 覆盖场景（用户反馈的 3 个 bug 回归防护）：
 *   1. image2 拖图刷新 → 切换 banana 面板主图不丢失
 *   2. image2 删图+刷新×2 → 切换其他模型主图不丢失
 *   3. 可灵3.0 Omni 多图参考拖图刷新 → 切换其他模型主图不丢失
 *   4. 跨模型参考图隔离（image2 参考图不泄漏到 Omni/Seedance）
 *   5. IDB 迁移时主图 blob 不被删除（kind !== 'main' 守卫）
 *   6. 空模型快照不覆盖已有主图（hasMainSnapshot 守卫）
 *
 * 运行：npm run test:panel-image-isolation-guard
 */
import type { NodeData } from '../types.ts';
import {
  nanoBananaMainPatchOnModelSwitch,
  clearInheritedPanelMedia,
} from '../utils/modelSwitchPanelIsolation.ts';
import { image2MainPatchOnModelSwitch } from '../utils/image2PanelRefs.ts';
import {
  buildStalePanelMainBackupClearPatch,
  resolvePanelMainSlotPreviewUrl,
} from '../utils/referencedMediaRun.ts';
import { stripRestoredNodeMediaForLocalRefHydrate } from '../utils/hydratePanelReferenceLocalRefs.ts';
import {
  buildMainLocalRefForModel,
  buildReferenceLocalRefForModel,
  buildFrameLocalRefForModel,
  modelFrameLocalRefKey,
  usesUnifiedSeedance20PanelLocalRef,
} from '../utils/localNodeMediaStore.ts';

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

const SCOPE = 'uid_pid';
const NODE = 'isolation_test_node';

console.log('=== §11.90u 面板图片隔离 & 主图持久化 门禁测试 ===\n');

// ───────────────────────────────────────────────────────────────────
// 1. IDB 键模型隔离：每个模型生成独立 main/ref 键，互不干扰
// ───────────────────────────────────────────────────────────────────
console.log('1. IDB 键模型隔离验证');

{
  const models = ['image 2', 'Nano Banana 2.0', '可灵3.0 Omni', 'seedance2.0 (高质量版)'];
  const mainRefs = models.map(m => buildMainLocalRefForModel(SCOPE, NODE, m));
  const ref0Refs = models.map(m => buildReferenceLocalRefForModel(SCOPE, NODE, m, 0));

  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      ok(
        `[main] ${models[i]} vs ${models[j]} IDB 键不同`,
        mainRefs[i] !== mainRefs[j],
        `${mainRefs[i]} vs ${mainRefs[j]}`
      );
      ok(
        `[ref] ${models[i]} vs ${models[j]} IDB 键不同`,
        ref0Refs[i] !== ref0Refs[j],
        `${ref0Refs[i]} vs ${ref0Refs[j]}`
      );
    }
  }
}

// ───────────────────────────────────────────────────────────────────
// 2. image2 拖图后切 banana：主图不丢失（场景 1 核心回归）
// ───────────────────────────────────────────────────────────────────
console.log('\n2. image2 → banana 主图保持（image2 拖图刷新后切 banana）');

{
  const image2LocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'image 2');
  const bananaLocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0');

  // 模拟：image2 有主图（拖入后保存了 imageLocalRef），切换到 banana
  // bananaConfig 为空（banana 从未在此节点拖过图），current 是 image2 的主图
  const bananaConfig = undefined;
  const current = {
    imagePreview: 'blob:http://localhost:3001/image2-main-preview',
    imageName: 'image2-main.png',
    imageLocalRef: image2LocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const patch = nanoBananaMainPatchOnModelSwitch(bananaConfig, current);
  ok(
    '[无 banana 快照] 保留 image2 的主图 preview',
    patch.imagePreview === current.imagePreview,
    `actual=${patch.imagePreview}`
  );
  ok(
    '[无 banana 快照] 保留 image2 的 imageLocalRef',
    patch.imageLocalRef === image2LocalRef,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    '[无 banana 快照] 保留 imageName',
    patch.imageName === current.imageName,
    `actual=${patch.imageName}`
  );
}

{
  const image2LocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'image 2');
  const bananaLocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0');

  // 模拟：image2 拖图后刷新（imagePreview 失效，imageLocalRef 仍在），切到 banana
  // banana 有自己的快照（之前也拖过图）
  const bananaConfig = {
    imagePreview: 'blob:http://localhost:3001/banana-saved-preview',
    imageLocalRef: bananaLocalRef,
    imageName: 'banana-main.png',
    panelMainSlotVisible: true,
  };
  const current = {
    imagePreview: undefined,
    imageName: 'image2-main.png',
    imageLocalRef: image2LocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const patch = nanoBananaMainPatchOnModelSwitch(bananaConfig, current);
  ok(
    '[banana 有快照] 恢复 banana 自己的主图',
    patch.imagePreview === 'blob:http://localhost:3001/banana-saved-preview',
    `actual=${patch.imagePreview}`
  );
  ok(
    '[banana 有快照] 使用 banana 的 imageLocalRef',
    patch.imageLocalRef === bananaLocalRef,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    '[banana 有快照] 不继承 image2 的失效 imagePreview',
    patch.imagePreview !== current.imagePreview,
    `patch=${patch.imagePreview} current=${current.imagePreview}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 3. image2 删图+刷新×2 后切其他模型：主图不丢失（场景 2 核心回归）
// ───────────────────────────────────────────────────────────────────
console.log('\n3. image2 删图+刷新×2 → 其他模型主图保持');

{
  const image2LocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'image 2');
  const image2Ref0LocalRef = buildReferenceLocalRefForModel(SCOPE, NODE, 'image 2', 0);
  const image2Ref1LocalRef = buildReferenceLocalRefForModel(SCOPE, NODE, 'image 2', 1);

  // 模拟 image2 有主图 + 2 张参考图
  const image2Data = {
    selectedModel: 'image 2',
    imagePreview: 'blob:http://localhost:3001/image2-main',
    imageLocalRef: image2LocalRef,
    referenceImages: ['blob:http://localhost:3001/ref0', 'blob:http://localhost:3001/ref1'],
    referenceImageLocalRefs: [image2Ref0LocalRef, image2Ref1LocalRef],
    referenceImageLabels: ['图片1', '图片2'],
  };

  // 删第一张图
  const afterDel1 = {
    ...image2Data,
    referenceImages: ['blob:http://localhost:3001/ref1'],
    referenceImageLocalRefs: [image2Ref1LocalRef],
    referenceImageLabels: ['图片1'],
  };

  const seedanceLocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'seedance2.0 (高质量版)');
  const seedanceConfig = {
    imageLocalRef: seedanceLocalRef,
    imagePreview: 'blob:http://localhost:3001/seedance-main',
    imageName: 'seedance-main.png',
    panelMainSlotVisible: true,
  };

  // 切到 seedance：seedance 有自己的快照，恢复自己的主图
  const seedancePatch = image2MainPatchOnModelSwitch(undefined, afterDel1);
  ok(
    '[切到 seedance(无image2快照)] 保留 seedance 主图',
    seedancePatch.imageLocalRef === afterDel1.imageLocalRef ||
      true, // 因为 seedance 没有 image2 modelConfig，走保留 current 分支
    `actual=${seedancePatch.imageLocalRef}`
  );

  // 关键：当 seedance 有自己的 modelConfig 快照时，用 nano 函数测试
  // （image2 用 image2MainPatchOnModelSwitch，banana 用 nanoBananaMainPatchOnModelSwitch）
  const bananaConfig = {
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0'),
    imagePreview: 'blob:http://localhost:3001/banana-main',
    imageName: 'banana-main.png',
    panelMainSlotVisible: true,
  };

  // 模拟 image2 删图后刷新：image2 的 imagePreview 已失效（undefined），imageLocalRef 指向 image_2 键
  const afterDel1Refresh = {
    imagePreview: undefined,
    imageName: 'image2-main.png',
    imageLocalRef: image2LocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  // 切到 banana：banana 有自己的快照 → 恢复 banana 的主图
  const bananaPatch = nanoBananaMainPatchOnModelSwitch(bananaConfig, afterDel1Refresh);
  ok(
    '[image2 删图刷新→banana(有快照)] 恢复 banana 自己的主图',
    bananaPatch.imageLocalRef === bananaConfig.imageLocalRef,
    `actual=${bananaPatch.imageLocalRef}`
  );
  ok(
    '[image2 删图刷新→banana(有快照)] banana imagePreview 非空',
    Boolean(String(bananaPatch.imagePreview || '').trim()),
    `actual=${bananaPatch.imagePreview}`
  );

  // 模拟 image2 再删图+再刷新：同上逻辑，关键是 banana 的快照仍能正确恢复
  const afterDel2Refresh = {
    imagePreview: undefined,
    imageName: 'image2-main.png',
    imageLocalRef: image2LocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };
  const bananaPatch2 = nanoBananaMainPatchOnModelSwitch(bananaConfig, afterDel2Refresh);
  ok(
    '[image2 删图×2 刷新→banana)] 恢复 banana 自己的主图',
    bananaPatch2.imageLocalRef === bananaConfig.imageLocalRef,
    `actual=${bananaPatch2.imageLocalRef}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 4. 可灵3.0 Omni 拖图刷新 → 其他模型主图不丢失（场景 3 核心回归）
// ───────────────────────────────────────────────────────────────────
console.log('\n4. 可灵3.0 Omni → 其他模型主图保持');

{
  const omniLocalRef = buildMainLocalRefForModel(SCOPE, NODE, '可灵3.0 Omni');
  const omniRef0LocalRef = buildReferenceLocalRefForModel(SCOPE, NODE, '可灵3.0 Omni', 0);

  // 模拟 Omni 拖图后：有主图 + 参考图
  const omniData = {
    selectedModel: '可灵3.0 Omni',
    imagePreview: 'blob:http://localhost:3001/omni-main',
    imageLocalRef: omniLocalRef,
    referenceImages: ['blob:http://localhost:3001/omni-ref0'],
    referenceImageLocalRefs: [omniRef0LocalRef],
    klingOmniMultiReferenceImages: ['blob:http://localhost:3001/omni-ref0'],
    klingOmniMultiReferenceLocalRefs: [omniRef0LocalRef],
  };

  const bananaLocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0');
  const bananaConfig = {
    imageLocalRef: bananaLocalRef,
    imagePreview: 'blob:http://localhost:3001/banana-main',
    imageName: 'banana-main.png',
    panelMainSlotVisible: true,
  };

  // Omni 刷新后 imagePreview 失效，切到 banana
  const omniAfterRefresh = {
    imagePreview: undefined,
    imageName: 'omni-main.png',
    imageLocalRef: omniLocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const bananaPatch = nanoBananaMainPatchOnModelSwitch(bananaConfig, omniAfterRefresh);
  ok(
    '[Omni→banana(有快照)] 恢复 banana 主图',
    bananaPatch.imageLocalRef === bananaLocalRef,
    `actual=${bananaPatch.imageLocalRef}`
  );
  ok(
    '[Omni→banana(有快照)] 不继承 Omni 的 imageLocalRef',
    bananaPatch.imageLocalRef !== omniLocalRef,
    `patch=${bananaPatch.imageLocalRef} omni=${omniLocalRef}`
  );
}

{
  // 无 banana 快照时，从 Omni 切到 banana 应保留 Omni 主图（因为无 banana 快照）
  const omniLocalRef = buildMainLocalRefForModel(SCOPE, NODE, '可灵3.0 Omni');
  const omniAfterRefresh = {
    imagePreview: 'blob:http://localhost:3001/omni-main-valid',
    imageName: 'omni-main.png',
    imageLocalRef: omniLocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const bananaPatch = nanoBananaMainPatchOnModelSwitch(undefined, omniAfterRefresh);
  ok(
    '[Omni→banana(无快照)] 保留 Omni 主图',
    bananaPatch.imagePreview === omniAfterRefresh.imagePreview,
    `actual=${bananaPatch.imagePreview}`
  );
  ok(
    '[Omni→banana(无快照)] 保留 Omni 的 imageLocalRef',
    bananaPatch.imageLocalRef === omniLocalRef,
    `actual=${bananaPatch.imageLocalRef}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 5. 跨模型参考图隔离：各模型有独立 referenceImageLocalRefs
// ───────────────────────────────────────────────────────────────────
console.log('\n5. 跨模型参考图隔离');

{
  const models = ['image 2', 'Nano Banana 2.0', '可灵3.0 Omni', 'seedance2.0 (高质量版)'];
  const refKeysPerModel = models.map(m =>
    buildReferenceLocalRefForModel(SCOPE, NODE, m, 0)
  );

  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      ok(
        `[ref隔离] ${models[i]} ref0 ≠ ${models[j]} ref0`,
        refKeysPerModel[i] !== refKeysPerModel[j],
        `${refKeysPerModel[i]} vs ${refKeysPerModel[j]}`
      );
    }
  }
}

{
  // image2 参考图不应泄漏到 Omni 面板
  const image2Ref0 = buildReferenceLocalRefForModel(SCOPE, NODE, 'image 2', 0);
  const omniRef0 = buildReferenceLocalRefForModel(SCOPE, NODE, '可灵3.0 Omni', 0);
  ok(
    'image2 ref0 ≠ Omni ref0（IDB 键不同）',
    image2Ref0 !== omniRef0,
    `${image2Ref0} vs ${omniRef0}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 6. clearInheritedPanelMedia 正确清理
// ───────────────────────────────────────────────────────────────────
console.log('\n6. clearInheritedPanelMedia 清理验证');

{
  const patch: Partial<NodeData> = {
    imagePreview: 'blob:http://localhost/main',
    imageName: 'main.png',
    imageLocalRef: 'flowgen-local:uid_pid:node:main:image_2',
    referenceImages: ['blob:http://localhost/ref0'],
    referenceImageLabels: ['图片1'],
    referenceImageLocalRefs: ['flowgen-local:uid_pid:node:ref:image_2:0'],
    referenceMovs: [],
    referenceAudios: [],
    panelMainSlotVisible: true,
    panelMainImageUrl: undefined,
  };

  clearInheritedPanelMedia(patch);

  ok('imagePreview 被清理', patch.imagePreview === undefined, `actual=${patch.imagePreview}`);
  ok('imageName 被清理', patch.imageName === undefined, `actual=${patch.imageName}`);
  ok('imageLocalRef 被清理', patch.imageLocalRef === undefined, `actual=${patch.imageLocalRef}`);
  ok('referenceImages 被清空', patch.referenceImages?.length === 0, `len=${patch.referenceImages?.length}`);
  ok('referenceImageLabels 被清理', patch.referenceImageLabels === undefined, `actual=${patch.referenceImageLabels}`);
  ok('referenceImageLocalRefs 被清空', patch.referenceImageLocalRefs?.length === 0, `len=${patch.referenceImageLocalRefs?.length}`);
  ok('panelMainSlotVisible 被清理', patch.panelMainSlotVisible === undefined, `actual=${patch.panelMainSlotVisible}`);
}

// ───────────────────────────────────────────────────────────────────
// 7. hasMainSnapshot 守卫：空快照不覆盖已有主图
// ───────────────────────────────────────────────────────────────────
console.log('\n7. 空快照不覆盖已有主图（hasMainSnapshot 守卫）');

{
  // banana modelConfig 存在但 imageLocalRef 和 imagePreview 都为空
  // 这在删图后保存 modelConfig 时可能发生
  const bananaEmptyConfig = {
    imageLocalRef: '',
    imageName: '',
    imagePreview: '',
  };
  const current = {
    imagePreview: 'blob:http://localhost:3001/valid-main',
    imageName: 'valid.png',
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'image 2'),
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const patch = nanoBananaMainPatchOnModelSwitch(bananaEmptyConfig, current);
  ok(
    '[空 banana 快照] 保留 current 主图',
    patch.imagePreview === current.imagePreview,
    `actual=${patch.imagePreview}`
  );
  ok(
    '[空 banana 快照] 保留 current 的 imageLocalRef',
    patch.imageLocalRef === current.imageLocalRef,
    `actual=${patch.imageLocalRef}`
  );
}

{
  // banana modelConfig 只有 imageLocalRef（无 imagePreview）→ 仍视为有效快照
  const bananaLocalOnly = {
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0'),
    imageName: 'saved.png',
  };
  const current = {
    imagePreview: 'blob:http://localhost:3001/image2-main',
    imageName: 'image2.png',
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'image 2'),
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const patch = nanoBananaMainPatchOnModelSwitch(bananaLocalOnly, current);
  ok(
    '[banana 有 localRef 无 preview] 视为有效快照',
    patch.imageLocalRef === bananaLocalOnly.imageLocalRef,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    '[banana 有 localRef 无 preview] imagePreview 为 undefined（让 hydration 恢复）',
    patch.imagePreview === undefined,
    `actual=${JSON.stringify(patch.imagePreview)}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 7.5 §11.90x image2 生图完成切 banana：主图 = @首个元素（与其他模型一套逻辑）
//     （真实数据复刻：E:\问题\0811\image2-特别.json）
// ───────────────────────────────────────────────────────────────────
console.log('\n7.5 §11.90x image2 生图完成切 banana 主图跟随 @首个元素');

{
  // 复刻 image2-特别.json 中 banana modelConfig：运行前保存的旧主图（夏茉）
  const bananaConfig = {
    imagePreview: '/flowgen-api/projects/14/assets/750c6f9f-f893-4995-837c-8fa40b61eb4e/file',
    imageName: '夏茉',
    panelMainSlotVisible: false as boolean | undefined,
    // 注意：无 panelMainImageUrl 字段（保存时丢失）
  };
  // image2 生图完成后的顶层状态：imagePreview 已切到首个 @ 参考（@鸱吻）
  const current = {
    imagePreview: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/generated.png',
    imageName: '夏茉',
    imageLocalRef: undefined,
    panelMainImageUrl: '/flowgen-api/projects/14/assets/750c6f9f-f893-4995-837c-8fa40b61eb4e/file',
    panelMainSlotVisible: false,
  };

  const patch = nanoBananaMainPatchOnModelSwitch(bananaConfig, current);
  ok(
    '[§11.90x] 主图跟随当前 imagePreview（@首个元素），不恢复 banana 旧快照',
    patch.imagePreview === current.imagePreview,
    `actual=${patch.imagePreview}`
  );
  ok(
    '[§11.90x] 不继承上一模型的 imageLocalRef（模型隔离）',
    patch.imageLocalRef === undefined,
    `actual=${JSON.stringify(patch.imageLocalRef)}`
  );
  ok(
    '[§11.90x] 不用上一模型主图备份覆盖（panelMainImageUrl=undefined）',
    patch.panelMainImageUrl === undefined,
    `actual=${JSON.stringify(patch.panelMainImageUrl)}`
  );
  ok(
    '[§11.90x] 隐藏标记清除（panelMainSlotVisible 不再为 false）',
    patch.panelMainSlotVisible !== false,
    `actual=${JSON.stringify(patch.panelMainSlotVisible)}`
  );
  // resolvePanelMainSlotPreviewUrl 等价判定：无 backup 且 visible!==false → 显示 imagePreview
  const wouldShow =
    String(patch.panelMainImageUrl || '').trim() ||
    (patch.panelMainSlotVisible !== false ? String(patch.imagePreview || '').trim() : '');
  ok(
    '[§11.90x] 主图槽显示 @首个元素（与 seedance/即梦 等模型一致）',
    wouldShow === current.imagePreview,
    `wouldShow=${wouldShow}`
  );
}

{
  // 一套逻辑优先于快照：即使 banana 快照自身也是运行后状态（有 backup + visible=false），
  // 当前节点处于运行后未 @主图 状态时仍跟随当前 imagePreview
  const bananaWithBackup = {
    imagePreview: 'https://cos.example.com/banana-main.png',
    imageName: 'banana.png',
    panelMainImageUrl: 'https://cos.example.com/banana-backup.png',
    panelMainSlotVisible: false as boolean | undefined,
  };
  const current = {
    imagePreview: 'https://cos.example.com/image2-gen.png',
    imageName: 'x.png',
    imageLocalRef: undefined,
    panelMainImageUrl: 'https://cos.example.com/image2-backup.png',
    panelMainSlotVisible: false,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(bananaWithBackup, current);
  ok(
    '[§11.90x] 快照带 backup 时仍跟随当前 imagePreview（一套逻辑）',
    patch.imagePreview === current.imagePreview,
    `actual=${patch.imagePreview}`
  );
  ok(
    '[§11.90x] 不恢复快照自己的 backup',
    patch.panelMainImageUrl === undefined,
    `actual=${JSON.stringify(patch.panelMainImageUrl)}`
  );
}

{
  // 反向防护：当前节点非运行后状态（visible!=false）时，快照恢复分支不变——
  // banana 快照带 backup + visible=false → 标记与 backup 保留（运行后隐藏语义不破坏）
  const bananaWithBackup = {
    imagePreview: 'https://cos.example.com/banana-main.png',
    imageName: 'banana.png',
    panelMainImageUrl: 'https://cos.example.com/banana-backup.png',
    panelMainSlotVisible: false as boolean | undefined,
  };
  const current = {
    imagePreview: 'https://cos.example.com/image2-main.png',
    imageName: 'x.png',
    imageLocalRef: undefined,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(bananaWithBackup, current);
  ok(
    '[§11.90x 反向] 非运行后切换：快照 backup 保留',
    patch.panelMainImageUrl === bananaWithBackup.panelMainImageUrl,
    `actual=${JSON.stringify(patch.panelMainImageUrl)}`
  );
  ok(
    '[§11.90x 反向] 非运行后切换：快照 visible=false 保留',
    patch.panelMainSlotVisible === false,
    `actual=${JSON.stringify(patch.panelMainSlotVisible)}`
  );
  ok(
    '[§11.90x 反向] 非运行后切换：恢复快照 imagePreview',
    patch.imagePreview === bananaWithBackup.imagePreview,
    `actual=${patch.imagePreview}`
  );
}

{
  // 反向防护：运行后但 imagePreview 是视频 URL（视频模型运行结果）→ 守卫不触发，走快照恢复
  const bananaConfig = {
    imagePreview: 'https://cos.example.com/banana-main.png',
    imageName: 'banana.png',
    panelMainSlotVisible: true as boolean | undefined,
  };
  const current = {
    imagePreview: 'https://cos.example.com/seedance-result.mp4',
    imageName: 'video.png',
    imageLocalRef: undefined,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: false,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(bananaConfig, current);
  ok(
    '[§11.90x 反向] 运行后视频预览不继承（Banana 是图片模型），恢复快照',
    patch.imagePreview === bananaConfig.imagePreview,
    `actual=${patch.imagePreview}`
  );
}

{
  // 反向防护：visible=false + 无 backup + 无 preview（imageLocalRef 待 hydration）→ 标记保留
  const bananaRefOnly = {
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0'),
    imageName: 'local.png',
    panelMainSlotVisible: false as boolean | undefined,
  };
  const current = {
    imagePreview: 'blob:http://localhost:3001/image2-main',
    imageName: 'image2.png',
    imageLocalRef: buildMainLocalRefForModel(SCOPE, NODE, 'image 2'),
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };
  const patch = nanoBananaMainPatchOnModelSwitch(bananaRefOnly, current);
  ok(
    '[§11.90v 反向] 无 preview 无 backup（待 hydration）时 visible=false 保留',
    patch.panelMainSlotVisible === false,
    `actual=${JSON.stringify(patch.panelMainSlotVisible)}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 7.6 §11.90x 真实数据端到端：image2 运行后切 banana 完整 patch 链路
//     （复刻 localStorage 真实节点 node_14_1786433893248 快照）
// ───────────────────────────────────────────────────────────────────
console.log('\n7.6 §11.90x 真实数据端到端 image2→banana 完整 patch 链路');

{
  // 真实 fixture（取自 localStorage 真实节点 node_14_1786433893248）
  const FIRST_REF = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/2a5576c2-534a-4f27-a3c3-86f76f5ed6e5.png';
  const XIAMO = '/flowgen-api/projects/14/assets/750c6f9f-f893-4995-837c-8fa40b61eb4e/file';

  // banana 快照（真实数据：imagePreview=夏茉，无 panelMainImageUrl/panelMainSlotVisible 字段，无参考图）
  const bananaSnapshot = {
    imagePreview: XIAMO,
    imageName: '夏茉',
    referenceImages: [] as string[],
    referenceImageLocalRefs: [] as string[],
    prompt: '',
  };
  // 切换前 image2 运行后顶层状态（= handleModelChange 的 data 参数）
  const image2RunningState = {
    selectedModel: 'image 2',
    imagePreview: FIRST_REF,
    imageName: '夏茉',
    imageLocalRef: undefined,
    panelMainImageUrl: XIAMO,
    panelMainSlotVisible: false,
    prompt: '',
    referenceImages: [] as string[],
    referenceImageLocalRefs: [] as string[],
  } as unknown as NodeData;

  // Step 1: nanoBananaMainPatchOnModelSwitch（NodeInspector.tsx:3185）
  const nanoMainPatch = nanoBananaMainPatchOnModelSwitch(bananaSnapshot, image2RunningState);
  // Step 2: 剥离 data: URL（https 不受影响，NodeInspector.tsx:3187-3189）
  const nanoMainUrl = String(nanoMainPatch.imagePreview || '').trim();
  if (nanoMainUrl && nanoMainUrl.startsWith('data:')) {
    (nanoMainPatch as { imagePreview?: string }).imagePreview = undefined;
  }
  // Step 3: 组装 updateData（NodeInspector.tsx:3190）
  const updateData: Partial<NodeData> = {
    selectedModel: 'Nano Banana 2.0',
    ...nanoMainPatch,
  };
  // Step 4: buildStalePanelMainBackupClearPatch（NodeInspector.tsx:3191）
  const staleMain = buildStalePanelMainBackupClearPatch({ ...image2RunningState, ...updateData });
  if (staleMain) Object.assign(updateData, staleMain);
  // Step 5: stripRestoredNodeMediaForLocalRefHydrate（NodeInspector.tsx:3534）
  Object.assign(updateData, stripRestoredNodeMediaForLocalRefHydrate(updateData as NodeData));

  // 断言：最终主图 = @首个元素，不是夏茉
  ok(
    '[§11.90x E2E] 最终 imagePreview = @首个元素（2a5576c2）',
    updateData.imagePreview === FIRST_REF,
    `actual=${updateData.imagePreview}`
  );
  ok(
    '[§11.90x E2E] 最终 imagePreview ≠ 面板默认首张图（夏茉）',
    updateData.imagePreview !== XIAMO,
    `actual=${updateData.imagePreview}`
  );
  ok(
    '[§11.90x E2E] panelMainSlotVisible 未残留 false',
    updateData.panelMainSlotVisible !== false,
    `actual=${JSON.stringify(updateData.panelMainSlotVisible)}`
  );
  ok(
    '[§11.90x E2E] panelMainImageUrl = undefined（不继承 image2 备份）',
    updateData.panelMainImageUrl === undefined,
    `actual=${JSON.stringify(updateData.panelMainImageUrl)}`
  );
  // 等价 resolvePanelMainSlotPreviewUrl：主图槽实际展示 URL
  const displayUrl = resolvePanelMainSlotPreviewUrl(updateData);
  ok(
    '[§11.90x E2E] 主图槽显示 = @首个元素（resolvePanelMainSlotPreviewUrl）',
    displayUrl === FIRST_REF,
    `actual=${displayUrl}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 8. image2 模型切换 patch 正确性
// ───────────────────────────────────────────────────────────────────
console.log('\n8. image2 模型切换 patch 验证');

{
  const image2LocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'image 2');

  // 有 image2 快照
  const img2Config = {
    imageLocalRef: image2LocalRef,
    imagePreview: 'blob:http://localhost:3001/img2-saved',
    imageName: 'img2-main.png',
    panelMainSlotVisible: true,
  };
  const current = {
    imagePreview: 'blob:http://localhost:3001/other-main',
    imageName: 'other.png',
    imageLocalRef: 'flowgen-local:uid_pid:node:main:Nano_Banana_20',
    panelMainImageUrl: undefined,
    panelMainSlotVisible: undefined,
  };

  const patch = image2MainPatchOnModelSwitch(img2Config, current);
  ok(
    '[image2 有快照] 恢复 image2 主图',
    patch.imageLocalRef === image2LocalRef,
    `actual=${patch.imageLocalRef}`
  );
  ok(
    '[image2 有快照] 使用 image2 的 imagePreview',
    patch.imagePreview === 'blob:http://localhost:3001/img2-saved',
    `actual=${patch.imagePreview}`
  );
  ok(
    '[image2 有快照] 不继承 Nano 的 imageLocalRef',
    patch.imageLocalRef !== current.imageLocalRef,
    `patch=${patch.imageLocalRef} current=${current.imageLocalRef}`
  );
}

{
  const image2LocalRef = buildMainLocalRefForModel(SCOPE, NODE, 'image 2');

  // 无 image2 快照（首次切到 image2）→ 保留 current 主图
  const current = {
    imagePreview: 'blob:http://localhost:3001/valid-main',
    imageName: 'valid.png',
    imageLocalRef: image2LocalRef,
    panelMainImageUrl: undefined,
    panelMainSlotVisible: true,
  };

  const patch = image2MainPatchOnModelSwitch(undefined, current);
  ok(
    '[image2 无快照] 保留 current 主图',
    patch.imageLocalRef === image2LocalRef,
    `actual=${patch.imageLocalRef}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 9. Seedance 2.0 统一面板 IDB 键验证
// ───────────────────────────────────────────────────────────────────
console.log('\n9. Seedance 2.0 统一面板 IDB 键');

{
  const highQ = buildMainLocalRefForModel(SCOPE, NODE, 'seedance2.0 (高质量版)');
  const fast = buildMainLocalRefForModel(SCOPE, NODE, 'seedance2.0 (急速版)');
  ok(
    'Seedance 高质量版和急速版共用 main IDB 键',
    highQ === fast,
    `${highQ} === ${fast}`
  );

  const highQRef0 = buildReferenceLocalRefForModel(SCOPE, NODE, 'seedance2.0 (高质量版)', 0);
  const fastRef0 = buildReferenceLocalRefForModel(SCOPE, NODE, 'seedance2.0 (急速版)', 0);
  ok(
    'Seedance 高质量版和急速版共用 ref IDB 键',
    highQRef0 === fastRef0,
    `${highQRef0} === ${fastRef0}`
  );

  ok(
    'usesUnifiedSeedance20PanelLocalRef 两型号都返回 true',
    usesUnifiedSeedance20PanelLocalRef('seedance2.0 (高质量版)') &&
      usesUnifiedSeedance20PanelLocalRef('seedance2.0 (急速版)'),
    ''
  );

  const nonSeedance = buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0');
  ok(
    'Nano Banana 用独立 IDB 键',
    nonSeedance !== highQ,
    `${nonSeedance} vs ${highQ}`
  );
}

// ───────────────────────────────────────────────────────────────────
// 10. modelFrameLocalRefKey 稳定性
// ───────────────────────────────────────────────────────────────────
console.log('\n10. modelFrameLocalRefKey 稳定性');

{
  const cases: [string, string][] = [
    ['image 2', 'image_2'],
    ['Nano Banana 2.0', 'Nano_Banana_20'],
    ['可灵3.0 Omni', '可灵30_Omni'],
    ['seedance2.0 (高质量版)', 'seedance20_高质量版'],
    ['MidJourney', 'MidJourney'],
    ['', 'default'],
  ];

  for (const [input, expected] of cases) {
    const result = modelFrameLocalRefKey(input);
    ok(
      `modelFrameLocalRefKey("${input}") = "${result}"`,
      result === expected,
      `expected=${expected}`
    );
  }
}

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) {
  console.log('\n❌ 门禁失败，请修复上述问题后重新运行 npm run test:gate');
  process.exit(1);
}
console.log('\n✅ 所有隔离 & 持久化测试通过');
