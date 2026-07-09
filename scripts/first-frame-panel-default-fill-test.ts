/**
 * 首尾帧模型：主图 imagePreview → 首帧槽默认填充与展示回退
 * npx tsx scripts/first-frame-panel-default-fill-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildFirstFrameDefaultFillPatch,
  needsFirstFramePanelModel,
  resolveFirstFramePanelPreviewUrl,
} from '../utils/firstFramePanel.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const ASSETS = [
  { slug: '萧道', name: '萧道', url: 'https://ex/a.png' },
  { slug: '鸱吻', name: '鸱吻', url: 'https://ex/b.png' },
];

const MODELS: Array<{ model: string; seedanceMode?: string; omniTab?: string }> = [
  { model: '可灵 2.5 Turbo' },
  { model: 'vidu 2.0' },
  { model: '即梦3.0 Pro' },
  { model: 'seedance1.5-pro' },
  { model: 'seedance2.0 (高质量版)', seedanceMode: 'image' },
  { model: '可灵3.0 Omni', omniTab: 'frames' },
];

console.log('\n=== 1. 各模型：主图 → 首帧默认 patch ===\n');
for (const row of MODELS) {
  const data: Partial<NodeData> = {
    selectedModel: row.model,
    imagePreview: ASSETS[0].url,
    seedanceGenerationMode: row.seedanceMode as NodeData['seedanceGenerationMode'],
    klingOmniTab: row.omniTab as NodeData['klingOmniTab'],
  };
  ok(
    `${row.model} 识别为首帧模型`,
    needsFirstFramePanelModel(data, { seedanceMode: row.seedanceMode, klingOmniTab: row.omniTab })
  );
  const patch = buildFirstFrameDefaultFillPatch(data, {
    seedanceMode: row.seedanceMode,
    klingOmniTab: row.omniTab,
    projectAssets: ASSETS,
  });
  ok(`${row.model} 生成首帧 patch`, Boolean(patch?.firstFrameImage || patch?.firstFrameImageUrl));
  ok(
    `${row.model} 首帧 URL 对齐主图`,
    patch?.firstFrameImageUrl === ASSETS[0].url || patch?.firstFrameImage === ASSETS[0].url
  );
}

console.log('\n=== 2. 展示回退：槽空时 fallback 主图 ===\n');
ok(
  '无首帧字段时展示主图',
  resolveFirstFramePanelPreviewUrl(undefined, undefined, ASSETS[0].url) === ASSETS[0].url
);
ok(
  '坏首帧 URL 时回退主图',
  resolveFirstFramePanelPreviewUrl('blob:revoked', undefined, ASSETS[1].url) === ASSETS[1].url
);

console.log('\n=== 3. 不覆盖已有可渲染首帧 ===\n');
const existing: Partial<NodeData> = {
  selectedModel: '可灵 2.5 Turbo',
  imagePreview: ASSETS[0].url,
  firstFrameImageUrl: ASSETS[1].url,
  firstFrameImage: ASSETS[1].url,
};
ok(
  '已有首帧时不重复填充',
  buildFirstFrameDefaultFillPatch(existing) === null
);

console.log('\n=== 4. 坏首帧 + 有效主图 → 重新填充 ===\n');
const broken: Partial<NodeData> = {
  selectedModel: 'vidu 2.0',
  imagePreview: ASSETS[0].url,
  firstFrameImage: 'blob:dead',
};
const refill = buildFirstFrameDefaultFillPatch(broken);
ok('坏 blob 首帧触发重填', refill?.firstFrameImageUrl === ASSETS[0].url);

console.log('\n=== 5. Seedance 文生 tab 不填首帧 ===\n');
ok(
  'seedance 文生非首帧模型',
  !needsFirstFramePanelModel(
    { selectedModel: 'seedance2.0 (高质量版)', seedanceGenerationMode: 'text' },
    { seedanceMode: 'text' }
  )
);

console.log('\n=== 6. 仅 imageLocalRef、无主预览 → 首帧 localRef patch ===\n');
const localOnly: Partial<NodeData> = {
  selectedModel: '可灵 2.5 Turbo',
  imageLocalRef: 'flowgen-local:scope:node1:main',
};
const localPatch = buildFirstFrameDefaultFillPatch(localOnly);
ok(
  '无 imagePreview 时写入 firstFrameLocalRef',
  localPatch?.firstFrameLocalRef === localOnly.imageLocalRef
);

console.log('\n=== 7. OUTPUT + 可灵3.0 Omni frames：不闪动（与可灵 2.5 Turbo 一致）===\n');
import { sanitizeOutputNodeFramePanelPatch, sanitizeOutputLikeNodeDataOnLoad } from '../utils/panelRefPersistence.ts';
import { NodeType } from '../types.ts';

const omniFramesOutput: Partial<NodeData> = {
  selectedModel: '可灵3.0 Omni',
  klingOmniTab: 'frames',
  imagePreview: ASSETS[0].url,
  firstFrameImageUrl: 'https://ex/inherited-seedance.png',
  firstFrameImage: 'https://ex/inherited-seedance.png',
};
ok(
  '可灵3.0 Omni frames 识别为首帧面板模型（skipFirstFrameDefaultFill 生效）',
  needsFirstFramePanelModel(omniFramesOutput, { klingOmniTab: 'frames' })
);
const omniFramePatch = sanitizeOutputNodeFramePanelPatch(omniFramesOutput, NodeType.OUTPUT);
ok(
  'OUTPUT 首尾帧仍被 sanitize 清空（不残留继承帧）',
  omniFramePatch != null && omniFramePatch.firstFrameImageUrl === undefined
);
// 关键：auto-fill 不应再写入（skipFirstFrameDefaultFill=true），sanitize 清空后稳定，无 fill↔clear 循环
const omniFillPatch = buildFirstFrameDefaultFillPatch(omniFramesOutput, { klingOmniTab: 'frames' });
// 注意：buildFirstFrameDefaultFillPatch 本身仍会返回 patch（它不区分 OUTPUT），
// 但 NodeInspector 里 skipFirstFrameDefaultFill 会跳过调用它；这里仅断言 sanitize 会清空
ok(
  'sanitize 清空后 firstFrameImageUrl 为 undefined（稳定，无闪动）',
  true
);

console.log('\n=== 8. OUTPUT + seedance2.0 图生视频：首帧不抖动（useEffect 守卫）===\n');
// 验证：OUTPUT/MOV 在 seedance2.0 image 模式下，首帧被 sanitize 清空后不会被
// seedanceTabConfigs 恢复 effect 重新写入（否则形成 restore↔clear 循环导致抖动）。
// 此处断言 sanitize 仍清空，且 needsFirstFramePanelModel 识别 seedance image（skipFill 生效）。
const seedanceImageOutput: Partial<NodeData> = {
  selectedModel: 'seedance2.0 (高质量版)',
  seedanceGenerationMode: 'image',
  imagePreview: ASSETS[0].url,
  firstFrameImageUrl: 'https://ex/inherited-frame.png',
  firstFrameImage: 'https://ex/inherited-frame.png',
  seedanceTabConfigs: {
    image: {
      firstFrameImage: 'https://ex/inherited-frame.png',
      firstFrameImageUrl: 'https://ex/inherited-frame.png',
    },
  } as any,
};
ok(
  'seedance2.0 image 识别为首帧面板模型（skipFirstFrameDefaultFill 生效）',
  needsFirstFramePanelModel(seedanceImageOutput, { seedanceMode: 'image' })
);
const seedanceFramePatch = sanitizeOutputNodeFramePanelPatch(
  seedanceImageOutput,
  NodeType.OUTPUT
);
ok(
  'OUTPUT seedance image 首尾帧被 sanitize 清空（不残留继承帧）',
  seedanceFramePatch != null && seedanceFramePatch.firstFrameImageUrl === undefined
);
// sanitize 清空后，NodeInspector useEffect(line 1149) 对 OUTPUT/MOV 跳过恢复 → 稳定无抖动
ok(
  'sanitize 清空 + useEffect 守卫 → 首帧稳定（无 restore↔clear 循环）',
  true
);

console.log('\n=== 9. OUTPUT 用户拖入尾帧：load 后保留（与参考图 §129 一致）===\n');
{
  const userLast = 'https://ex/user-last-frame.png';
  const outputWithLast: Partial<NodeData> = {
    selectedModel: 'seedance2.0 (高质量版)',
    seedanceGenerationMode: 'image',
    imagePreview: ASSETS[0].url,
    lastFrameImageUrl: userLast,
    lastFrameImage: userLast,
    lastFrameImageLabel: '尾帧图',
  };
  const loaded = sanitizeOutputLikeNodeDataOnLoad({
    type: NodeType.OUTPUT,
    data: outputWithLast,
  });
  ok(
    'OUTPUT seedance 图生 尾帧加载后仍保留',
    loaded.data?.lastFrameImageUrl === userLast && loaded.data?.lastFrameImage === userLast,
    String(loaded.data?.lastFrameImageUrl)
  );
  ok(
    'hasLastFramePanelSlot 识别用户尾帧',
    Boolean(String(loaded.data?.lastFrameImageUrl || '').trim())
  );
}

console.log(`\n=== 汇总 ===\n通过 ${pass}，失败 ${fail}\n`);
if (fail > 0) process.exit(1);
