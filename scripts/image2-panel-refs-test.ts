/**
 * image2 面板参考图：压紧槽位、模型切换不与 Nano 串数据
 * npx tsx scripts/image2-panel-refs-test.ts
 */
import type { NodeData } from '../types.ts';
import { MODEL_IMAGE_2, MODEL_NANO_BANANA_2 } from '../types.ts';
import {
  compactImage2PanelReferences,
  image2MaxReferenceSlots,
  image2MainPatchOnModelSwitch,
  patchImage2ReferenceAtRefSlot,
} from '../utils/image2PanelRefs.ts';

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

ok('有主图时最多 2 参考', image2MaxReferenceSlots(data) === 2);
const compact = compactImage2PanelReferences(data);
ok('压紧后仅 2 条参考', compact.referenceImages.length === 2, JSON.stringify(compact.referenceImages));
ok('不含隐藏第4张', !compact.referenceImages.includes('https://hidden.png'));

const replaced = patchImage2ReferenceAtRefSlot(
  { ...data, referenceImages: compact.referenceImages, referenceImageLabels: compact.referenceImageLabels },
  0,
  'https://new0.png',
  '新0'
);
ok('槽0 覆盖替换', replaced.referenceImages?.[0] === 'https://new0.png');

const mainKeep = image2MainPatchOnModelSwitch(undefined, {
  imagePreview: 'https://canvas-main.png',
  imageName: '主图资产',
});
ok('无 image2 快照时保留主图', mainKeep.imagePreview === 'https://canvas-main.png');
ok('无 image2 快照时保留 imageName', mainKeep.imageName === '主图资产');

const mainRestore = image2MainPatchOnModelSwitch(
  {
    imagePreview: 'https://saved-ref.png',
    imageName: '已存',
    panelMainSlotVisible: false,
  },
  { imagePreview: 'https://canvas-main.png', imageName: '主图资产', panelMainSlotVisible: undefined }
);
ok('有 image2 快照时用快照', mainRestore.imagePreview === 'https://saved-ref.png');
ok('有 image2 快照时恢复 panelMainSlotVisible', mainRestore.panelMainSlotVisible === false);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
console.log('image2 面板参考测试通过。');
