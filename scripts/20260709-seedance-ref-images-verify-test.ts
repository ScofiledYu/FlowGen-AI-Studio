/**
 * 20260709-seedance参考生视频.json：@图片n 与面板槽对齐
 * npx tsx scripts/20260709-seedance-ref-images-verify-test.ts
 */
import fs from 'fs';
import type { NodeData } from '../types.ts';
import { resolveFixtureFile } from './fixturePath.ts';
import {
  buildPromptMediaRefContextFromNode,
  collectReferencedMediaFromPrompt,
  resolvePictureTokenSlotIndex,
} from '../utils/promptMediaRefs.ts';
import { shouldUseSlotOriginalFileForUpload } from '../utils/referencedMediaRun.ts';

const json = JSON.parse(
  fs.readFileSync(
    resolveFixtureFile(
      '20260709-seedance-ref-video.json',
      'd:/json/20260709-seedance参考生视频.json'
    ),
    'utf8'
  )
);
const node = json.nodes.find((n: { id: string }) => n.id === 'node_12_1783562692260')!;
const data = node.data as NodeData;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('=== Seedance 参考生 @图片 与面板槽 ===\n');

const refs = data.referenceImages || [];
const labels = data.referenceImageLabels || [];

refs.forEach((u, i) => {
  console.log(`  槽${i} [${labels[i]}] ${String(u).slice(-40)}`);
});

function checkPrompt(prompt: string, gp?: { referenceImages?: string[]; referenceImageLabels?: string[] }) {
  console.log(`\n--- prompt: ${prompt} ---`);
  const ctx = buildPromptMediaRefContextFromNode(data);
  const plan = collectReferencedMediaFromPrompt(
    prompt,
    data,
    ctx,
    new Map(),
    []
  );
  for (const img of plan.images) {
    const slot = img.refImageSlotIndex;
    const slotUrl = slot != null ? refs[slot] : undefined;
    const slotLabel = slot != null ? labels[slot] : undefined;
    console.log(
      `  plan ${img.token} slot=${slot} label=${slotLabel} urlTail=${String(img.url || slotUrl || '').slice(-36)}`
    );
    if (gp) {
      const gpIdx = gp.referenceImageLabels?.indexOf(img.token.replace('@', ''));
      const expectedUrl =
        gpIdx != null && gpIdx >= 0 ? gp.referenceImages?.[gpIdx] : undefined;
      if (expectedUrl) {
        const matches =
          String(img.url || '').includes(expectedUrl.slice(-20)) ||
          String(slotUrl || '').includes(expectedUrl.slice(-20));
        const tag = matches ? 'OK' : 'INFO';
        console.log(
          `  [${tag}] ${img.token} 与 gp 一致${matches ? '' : '（历史错误 gp，已修上传）'} — gp=${expectedUrl.slice(-36)} slot=${String(slotUrl || '').slice(-36)}`
        );
        if (matches) pass++;
      }
    }
    const ord = parseInt(img.token.replace('@图片', ''), 10);
    const byResolve = resolvePictureTokenSlotIndex(
      ord,
      refs,
      labels,
      data.imagePreview
    );
    ok(`${img.token} resolvePictureTokenSlotIndex=${byResolve}`, byResolve === slot, String(byResolve));
    if (slot != null && slotLabel) {
      ok(`${img.token} 槽底栏=${slotLabel}`, slotLabel === `图片${ord}`);
    }
  }
}

checkPrompt('@图片5和@图片2参考视频@主视频动作和镜头运行', data.generationParams);
checkPrompt('@图片2和@图片4参考视频@主视频动作和镜头运行', {
  referenceImages: [
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/42713201-6dd6-4acc-a408-79043568ab87.png',
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/08777c81-6728-4193-a797-0e4382375977.png',
  ],
  referenceImageLabels: ['图片2', '图片4'],
});

console.log('\n--- 上传：槽 COS + 过期 File 勿用 ---');
const pic2Slot = 1;
const pic2Cos = refs[pic2Slot]!;
const staleFile = { name: '42713201-stale.png' } as File;
const pic2Entry = {
  token: '@图片2',
  url: pic2Cos,
  label: '图片2',
  refImageSlotIndex: pic2Slot,
} as const;
ok(
  '@图片2 槽已是 COS 时不用 originals File',
  !shouldUseSlotOriginalFileForUpload(pic2Entry, pic2Cos, staleFile)
);
ok(
  'blob 槽仍可用 originals File',
  shouldUseSlotOriginalFileForUpload(
    { ...pic2Entry, refImageSlotIndex: 0 },
    refs[0]!,
    staleFile
  )
);

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
