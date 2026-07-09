/**
 * Seedance 2.0 参考生运行后面板 slot0 不被误隐藏（§10.38 imagePreview=首个@参考图 与 slot0 同 URL）
 *
 * 现象：Seedance 参考生 @图片1+@图片4 运行后，imagePreview=URL1（@图片1=slot0），
 *   isPanelRefDuplicateOfMainImageSlot 按 imagePreview 去重把 slot0 误判为「与主图重复」而隐藏，
 *   面板只剩 3 槽（slot1/2/3），slot0（图片1）丢失。
 *
 * 修复：panelMainSlotVisible===false 时 imagePreview 是@参考图非主图，不按 imagePreview 去重，
 *   只按 panelMainImageUrl（备份主图）去重。
 *
 * npx tsx scripts/seedance-panel-slot0-not-hidden-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  isPanelRefDuplicateOfMainImageSlot,
  filterPanelReferenceDisplayEntriesExcludingMainPreview,
  buildPanelReferenceDisplayEntries,
} from '../utils/referenceImageSlotLabels.ts';
import {
  shouldDedupePanelRefsAgainstMainPreview,
  shouldShowPanelMainImageSlot,
  panelReferenceLabelImagePreview,
} from '../utils/referencedMediaRun.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
}

const URL1 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/d46611d7.png';
const URL2 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/38fa157a.png';
const BLOB3 = 'blob:http://localhost:3001/2453096a-11eb-49f2-8b51-d99bbc1d9116';
const URL4 = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/9d40e364.png';
const MAIN_BACKUP = 'blob:http://localhost:3001/c64fa17a-23b4-4325-b5d5-33ffa1c8d94b';

const data = {
  label: 'n',
  selectedModel: 'seedance2.0 (急速版)',
  seedanceGenerationMode: 'reference',
  referenceImages: [URL1, URL2, BLOB3, URL4],
  referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
  imagePreview: URL1, // §10.38: imagePreview = 首个@参考图 = slot0 = URL1
  panelMainImageUrl: MAIN_BACKUP,
  panelMainSlotVisible: false,
  prompt: '@图片1和@图片4的角色镜头融合',
} as NodeData;

console.log('\n=== 场景1：isPanelRefDuplicateOfMainImageSlot 不应按 imagePreview 隐藏 slot0 ===\n');
ok('slot0(图片1=URL1=imagePreview) 不被去重', !isPanelRefDuplicateOfMainImageSlot(URL1, data, undefined), `URL1===imagePreview=${URL1 === data.imagePreview}`);
ok('slot1(图片2) 不被去重', !isPanelRefDuplicateOfMainImageSlot(URL2, data, undefined));
ok('slot2(图片3) 不被去重', !isPanelRefDuplicateOfMainImageSlot(BLOB3, data, undefined));
ok('slot3(图片4) 不被去重', !isPanelRefDuplicateOfMainImageSlot(URL4, data, undefined));
ok('与备份主图同 URL 的项仍去重', isPanelRefDuplicateOfMainImageSlot(MAIN_BACKUP, data, undefined));

console.log('\n=== 场景2：buildPanelReferenceDisplayEntries 4 槽全显示（用 backup 主图作 mainForDedupe）===\n');
const mainForDedupe = panelReferenceLabelImagePreview(data) ?? data.imagePreview;
ok('mainForDedupe = backup 主图（非 imagePreview）', mainForDedupe === MAIN_BACKUP, `mainForDedupe=${String(mainForDedupe).slice(0, 40)}`);
const entries = buildPanelReferenceDisplayEntries(data.referenceImages, {
  referenceImageLabels: data.referenceImageLabels,
  imagePreview: mainForDedupe,
  dedupeAgainstMain: shouldDedupePanelRefsAgainstMainPreview(data),
});
ok('面板显示 4 槽', entries.length === 4, `len=${entries.length}`);
ok('slot0 在显示列表', entries.some((e) => e.slotIndex === 0), JSON.stringify(entries.map((e) => e.slotIndex)));

console.log('\n=== 场景3：编辑态（panelMainSlotVisible 未设）仍按 imagePreview 去重（不破坏现有逻辑）===\n');
const editData = { ...data, panelMainSlotVisible: undefined, panelMainImageUrl: undefined, imagePreview: MAIN_BACKUP } as NodeData;
ok('编辑态 slot=主图URL 仍去重', isPanelRefDuplicateOfMainImageSlot(MAIN_BACKUP, editData, undefined), '应按 imagePreview 去重');

console.log('\n=== 场景4：Banana/image2 运行后（panelMainSlotVisible=false，slot 是 blob，imagePreview 是 COS）不受影响 ===\n');
const bananaData = {
  label: 'n',
  selectedModel: 'Nano Banana 2.0',
  referenceImages: ['blob:http://localhost:3001/ref0', 'blob:http://localhost:3001/ref1'],
  referenceImageLabels: ['图片1', '图片2'],
  imagePreview: 'https://aitop-cos/signed/REF1.png', // §10.38: COS URL
  panelMainImageUrl: 'blob:http://localhost:3001/main-backup',
  panelMainSlotVisible: false,
} as NodeData;
ok('Banana slot0(blob) 不被去重', !isPanelRefDuplicateOfMainImageSlot('blob:http://localhost:3001/ref0', bananaData, undefined));
ok('Banana slot1(blob) 不被去重', !isPanelRefDuplicateOfMainImageSlot('blob:http://localhost:3001/ref1', bananaData, undefined));
ok('Banana 主图备份仍去重', isPanelRefDuplicateOfMainImageSlot('blob:http://localhost:3001/main-backup', bananaData, undefined));

console.log(`\n=== 汇总：${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
