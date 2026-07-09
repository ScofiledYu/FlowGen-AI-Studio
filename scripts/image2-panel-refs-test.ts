/**
 * image2 面板参考图：压紧槽位、模型切换不与 Nano 串数据
 * npx tsx scripts/image2-panel-refs-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  buildImage2PanelDisplayEntries,
  compactImage2PanelReferences,
  compactImage2PanelLocalRefs,
  image2MaxReferenceSlots,
  image2MainPatchOnModelSwitch,
  patchImage2ReferenceAtRefSlot,
  removeImage2PanelReferenceAtDisplaySlot,
} from '../utils/image2PanelRefs.ts';
import {
  mergePanelWithPersistedRefsIfPromptNeeds,
  panelReferenceSlotsFromGenerationParamsSnapshot,
  buildPanelReferenceImagesRestorePatchForEditing,
} from '../utils/panelRefPersistence.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const data = {
  imagePreview: 'https://main.png',
  referenceImages: ['https://a.png', 'https://b.png', 'https://c.png', 'https://hidden.png'],
  referenceImageLabels: ['A', 'B', 'C', 'H'],
} as NodeData;

ok('有主图时最多 3 参考', image2MaxReferenceSlots(data) === 3);
const compact = compactImage2PanelReferences(data);
ok('压紧后仅 3 条参考', compact.referenceImages.length === 3, JSON.stringify(compact.referenceImages));
ok('不含隐藏第4张', !compact.referenceImages.includes('https://hidden.png'));

const dupMainData = {
  imagePreview: 'https://main.png',
  panelMainSlotVisible: true,
  referenceImages: ['https://main.png', 'https://other.png'],
  referenceImageLabels: ['图片1', '图片2'],
} as NodeData;
const compactDup = compactImage2PanelReferences(dupMainData);
ok('压紧时去掉主图重复首槽', compactDup.referenceImages.length === 1 && compactDup.referenceImages[0] === 'https://other.png');

const replaced = patchImage2ReferenceAtRefSlot(
  { ...data, referenceImages: compact.referenceImages, referenceImageLabels: compact.referenceImageLabels },
  0,
  'https://new0.png',
  '新0'
);
ok('槽0 覆盖替换', replaced.referenceImages?.[0] === 'https://new0.png');

const removeCase = {
  referenceImages: ['https://a.png', 'https://b.png'],
  referenceImageLabels: ['A', 'B'],
  referenceImageLocalRefs: ['local:a', 'local:b'],
} as NodeData;
const removed = removeImage2PanelReferenceAtDisplaySlot(removeCase, 0);
ok('移除 display 0 后剩 1 张', removed?.referenceImages.length === 1, JSON.stringify(removed?.referenceImages));
ok('移除后 localRef 同步', removed?.referenceImageLocalRefs?.[0] === 'local:b');
ok('返回 removedLocalRef', removed?.removedLocalRef === 'local:a');

const mainKeep = image2MainPatchOnModelSwitch(undefined, {
  imagePreview: 'https://canvas-main.png',
  imageName: '主图资产',
  imageLocalRef: 'flowgen-local:u:p:n:main:Nano_Banana_20',
});
ok('无 image2 快照时保留主图', mainKeep.imagePreview === 'https://canvas-main.png');
ok('无 image2 快照时保留 imageName', mainKeep.imageName === '主图资产');
ok('无 image2 快照时保留 imageLocalRef', mainKeep.imageLocalRef === 'flowgen-local:u:p:n:main:Nano_Banana_20');

const emptyCfgRestore = image2MainPatchOnModelSwitch(
  { prompt: 'empty', imagePreview: undefined } as NonNullable<NodeData['modelConfigs']>['image2'],
  { imagePreview: 'blob:http://localhost/keep', imageName: '主图', imageLocalRef: 'flowgen-local:u:p:n:main:image2', panelMainSlotVisible: undefined }
);
ok('空 imagePreview 快照不覆盖当前主图', emptyCfgRestore.imagePreview === 'blob:http://localhost/keep');

const inheritMain = image2MainPatchOnModelSwitch(undefined, {
  imagePreview: 'blob:http://localhost/nano-main',
  imageName: '主图',
  imageLocalRef: 'flowgen-local:u:p:n:main:Nano_Banana_20',
  panelMainSlotVisible: false,
});
ok('无 image2 快照继承主图时清除 panelMainSlotVisible=false', inheritMain.panelMainSlotVisible === undefined);
ok('无 image2 快照继承主图时保留 preview', inheritMain.imagePreview === 'blob:http://localhost/nano-main');

const localRefOnly = image2MainPatchOnModelSwitch(
  {
    imageLocalRef: 'flowgen-local:u:p:n:main:image2',
    panelMainSlotVisible: undefined,
  },
  { imagePreview: '', panelMainSlotVisible: false }
);
ok('仅 localRef 快照恢复 imageLocalRef', localRefOnly.imageLocalRef === 'flowgen-local:u:p:n:main:image2');
ok('仅 localRef 快照 imagePreview 为空待 hydrate', !String(localRefOnly.imagePreview || '').trim());

const mainRestore = image2MainPatchOnModelSwitch(
  {
    imagePreview: 'https://saved-ref.png',
    imageName: '已存',
    imageLocalRef: 'flowgen-local:u:p:n:main:image2',
    panelMainSlotVisible: false,
  },
  { imagePreview: 'https://canvas-main.png', imageName: '主图资产', imageLocalRef: 'flowgen-local:u:p:n:main:Nano_Banana_20', panelMainSlotVisible: undefined }
);
ok('有 image2 快照时用快照', mainRestore.imagePreview === 'https://saved-ref.png');
ok('有 image2 快照时恢复 imageLocalRef', mainRestore.imageLocalRef === 'flowgen-local:u:p:n:main:image2');
ok('有 image2 快照时恢复 panelMainSlotVisible', mainRestore.panelMainSlotVisible === false);

console.log('\n--- image2 展示：主图格 + 误写重复首槽 ---\n');

{
  const main = 'https://cos.example.com/street-main.png';
  const other = 'https://cos.example.com/other-ref.png';
  const dupFirst = {
    imagePreview: main,
    panelMainSlotVisible: true,
    referenceImages: [main, other],
    referenceImageLabels: ['图片1', '图片2'],
  } as NodeData;
  const entries = buildImage2PanelDisplayEntries(dupFirst);
  ok('跳过与主图重复的首槽', entries.length === 1 && entries[0].url === other, JSON.stringify(entries));
  ok('保留真实 slotIndex', entries[0]?.slotIndex === 1, String(entries[0]?.slotIndex));
}

console.log('\n--- image2 展示：@主图+@图片1 同 URL 仍双格 ---\n');

{
  const same = 'https://cos.example.com/same.png';
  const onlySame = {
    imagePreview: same,
    panelMainSlotVisible: true,
    referenceImages: [same],
    referenceImageLabels: ['图片1'],
  } as NodeData;
  const entries = buildImage2PanelDisplayEntries(onlySame);
  ok('仅一张同 URL 参考仍展示', entries.length === 1 && entries[0].url === same);
}

console.log('\n--- 再点运行：面板脏槽从 gp 恢复 @图片1 ---\n');

{
  const main = 'https://cos.example.com/openApi/main-new.png';
  const style = 'https://cos.example.com/openApi/style-ref.png';
  const stale = {
    imagePreview: main,
    panelMainSlotVisible: true,
    prompt: '@主图按@图片1风格生成',
    referenceImages: [main],
    referenceImageLabels: ['图片1'],
    generationParams: {
      referenceImages: [main, style],
      referenceImageLabels: ['图片1'],
    },
  } as NodeData;
  const prompt = stale.prompt!;
  const slots = panelReferenceSlotsFromGenerationParamsSnapshot(stale, prompt);
  ok('gp 快照去掉 API 主图槽', slots.length === 1 && slots[0] === style, JSON.stringify(slots));
  const merged = mergePanelWithPersistedRefsIfPromptNeeds(
    stale.referenceImages,
    stale.generationParams!.referenceImages!,
    prompt,
    main
  );
  ok('运行前合并恢复 style 槽', merged.length === 1 && merged[0] === style, JSON.stringify(merged));
  const patch = buildPanelReferenceImagesRestorePatchForEditing(stale);
  ok('选中节点 restore patch', patch?.referenceImages?.[0] === style);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('image2 面板参考测试通过。');
