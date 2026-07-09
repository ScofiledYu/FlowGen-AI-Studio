/**
 * 各模型尾帧图独立：拖入不同图 → 切模型 → 刷新后仍各自保留
 * npx tsx scripts/frame-model-switch-isolation-test.ts
 */
import type { NodeData } from '../types.ts';
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import {
  buildModelScopedFrameLocalRef,
  buildFrameLocalRefForModel,
  buildMainLocalRefForModel,
  buildReferenceLocalRefForModel,
  buildLocalMediaRef,
  modelFrameLocalRefKey,
  isLegacyFrameLocalRef,
  isLegacyMainLocalRef,
  isLegacyReferenceLocalRef,
  usesUnifiedSeedance20PanelLocalRef,
  usesUnifiedFrameLocalRef,
} from '../utils/localNodeMediaStore.ts';
import { needsHydrateFromLocalRef } from '../utils/hydratePanelReferenceLocalRefs.ts';
import { snapshotFrameSlotsFromNode } from '../utils/modelSwitchPanelIsolation.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const SCOPE = 'uid_pid';
const NODE = 'node_frame_test';
const MODEL_A = '可灵 2.5 Turbo';
const MODEL_B = 'vidu 2.0';
const MODEL_C = 'seedance1.5-pro';
const SD20_FAST = 'seedance2.0 (急速版)';
const SD20_HQ = 'seedance2.0 (高质量版)';

const refA = buildModelScopedFrameLocalRef(SCOPE, NODE, 'lastFrame', MODEL_A);
const refB = buildModelScopedFrameLocalRef(SCOPE, NODE, 'lastFrame', MODEL_B);
const refC = buildModelScopedFrameLocalRef(SCOPE, NODE, 'lastFrame', MODEL_C);
const legacyRef = `flowgen-local:${SCOPE}:${NODE}:lastFrame`;

const refAFirst = buildFrameLocalRefForModel(SCOPE, NODE, 'firstFrame', MODEL_A);
const refBFirst = buildFrameLocalRefForModel(SCOPE, NODE, 'firstFrame', MODEL_B);
const mainNano = buildMainLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0');
const mainImage2 = buildMainLocalRefForModel(SCOPE, NODE, 'image2');
const refNano0 = buildReferenceLocalRefForModel(SCOPE, NODE, 'Nano Banana 2.0', 0);
const refImage20 = buildReferenceLocalRefForModel(SCOPE, NODE, 'image2', 0);
const legacyMain = `flowgen-local:${SCOPE}:${NODE}:main`;
const legacyRef0 = `flowgen-local:${SCOPE}:${NODE}:ref:0`;

console.log('\n=== 1. 模型 scoped 首尾帧/主图/参考 localRef 互不相同 ===\n');
ok('可灵 vs vidu 尾帧 ref 不同', refA !== refB, `${refA} vs ${refB}`);
ok('可灵 vs vidu 首帧 ref 不同', refAFirst !== refBFirst, `${refAFirst} vs ${refBFirst}`);
ok('Nano vs image2 主图 ref 不同', mainNano !== mainImage2, `${mainNano} vs ${mainImage2}`);
ok('Nano vs image2 参考 ref 不同', refNano0 !== refImage20, `${refNano0} vs ${refImage20}`);
ok('vidu vs seedance ref 不同', refB !== refC, `${refB} vs ${refC}`);
ok('legacy 4 段 ref 可识别', isLegacyFrameLocalRef(legacyRef), legacyRef);
ok('scoped ref 非 legacy', !isLegacyFrameLocalRef(refA), refA);
ok('modelFrameLocalRefKey 稳定', modelFrameLocalRefKey(MODEL_A) === '可灵_25_Turbo', modelFrameLocalRefKey(MODEL_A));

console.log('\n=== 2. 切模型：各模型 modelConfigs 保存独立尾帧 ===\n');

const blobA = 'blob:http://localhost/last-a';
const blobB = 'blob:http://localhost/last-b';

/** 模拟 handleModelChange：保存当前模型首尾帧到 modelConfigs */
function saveFrameModelConfig(data: NodeData, model: string, configs: NodeData['modelConfigs']) {
  const snap = snapshotFrameSlotsFromNode(data);
  const next = { ...(configs || {}) } as NonNullable<NodeData['modelConfigs']>;
  (next as Record<string, unknown>)[model] = {
    ...((next as Record<string, unknown>)[model] as object),
    ...snap,
  };
  return next;
}

/** 模拟 handleModelChange：恢复目标模型首尾帧 */
function restoreFrameFromConfig(
  model: string,
  configs: NodeData['modelConfigs']
): Partial<NodeData> {
  const cfg = ((configs || {}) as Record<string, Partial<NodeData>>)[model] || {};
  return {
    selectedModel: model,
    lastFrameImage: cfg.lastFrameImage,
    lastFrameImageUrl: cfg.lastFrameImageUrl,
    lastFrameLocalRef: cfg.lastFrameLocalRef,
    lastFrameImageLabel: cfg.lastFrameImageLabel,
    firstFrameImage: cfg.firstFrameImage,
    firstFrameImageUrl: cfg.firstFrameImageUrl,
    firstFrameLocalRef: cfg.firstFrameLocalRef,
    firstFrameImageLabel: cfg.firstFrameImageLabel,
  };
}

let modelConfigs: NodeData['modelConfigs'] = {};

// 用户在可灵 2.5 拖入尾帧 A
const onKeling = {
  selectedModel: MODEL_A,
  lastFrameImage: blobA,
  lastFrameLocalRef: refA,
  lastFrameImageLabel: '尾帧A',
} as NodeData;
modelConfigs = saveFrameModelConfig(onKeling, MODEL_A, modelConfigs);

// 切到 vidu 2.0，拖入尾帧 B
const onVidu = restoreFrameFromConfig(MODEL_B, modelConfigs) as NodeData;
Object.assign(onVidu, {
  lastFrameImage: blobB,
  lastFrameLocalRef: refB,
  lastFrameImageLabel: '尾帧B',
});
modelConfigs = saveFrameModelConfig(onVidu, MODEL_B, modelConfigs);

ok('modelConfigs 可灵 lastFrameLocalRef = refA', modelConfigs?.[MODEL_A]?.lastFrameLocalRef === refA, String(modelConfigs?.[MODEL_A]?.lastFrameLocalRef));
ok('modelConfigs vidu lastFrameLocalRef = refB', (modelConfigs as Record<string, { lastFrameLocalRef?: string }>)['vidu 2.0']?.lastFrameLocalRef === refB, String((modelConfigs as Record<string, { lastFrameLocalRef?: string }>)['vidu 2.0']?.lastFrameLocalRef));

// 切回可灵 2.5
const backKeling = restoreFrameFromConfig(MODEL_A, modelConfigs);
ok('切回可灵尾帧 ref 仍是 refA', backKeling.lastFrameLocalRef === refA, String(backKeling.lastFrameLocalRef));
ok('切回可灵尾帧 blob 仍是 A', backKeling.lastFrameImage === blobA, String(backKeling.lastFrameImage));
ok('切回可灵尾帧标签仍是 尾帧A', backKeling.lastFrameImageLabel === '尾帧A', String(backKeling.lastFrameImageLabel));

// 再切 vidu
const backVidu = restoreFrameFromConfig(MODEL_B, modelConfigs);
ok('再切 vidu 尾帧 ref 仍是 refB', backVidu.lastFrameLocalRef === refB, String(backVidu.lastFrameLocalRef));
ok('再切 vidu 尾帧 blob 仍是 B', backVidu.lastFrameImage === blobB, String(backVidu.lastFrameImage));

console.log('\n=== 3. 刷新 sanitize：localRef 保留、blob 剥离 ===\n');

const sanitized = sanitizePersistValueDeep({ data: onKeling }).data as NodeData;
ok('sanitize 后 lastFrameLocalRef 保留', sanitized.lastFrameLocalRef === refA, String(sanitized.lastFrameLocalRef));
ok('sanitize 后 lastFrame blob 剥离', !String(sanitized.lastFrameImage || '').startsWith('blob:'), String(sanitized.lastFrameImage));
ok('sanitize 后待 hydrate', needsHydrateFromLocalRef(sanitized.lastFrameImage) && Boolean(sanitized.lastFrameLocalRef), String(sanitized.lastFrameImage));

console.log('\n=== 4. legacy 共享 ref 问题复现（旧版会丢独立尾帧）===\n');
const legacyConfigs = {
  [MODEL_A]: { lastFrameLocalRef: legacyRef, lastFrameImage: blobA, lastFrameImageLabel: 'A' },
  [MODEL_B]: { lastFrameLocalRef: legacyRef, lastFrameImage: blobB, lastFrameImageLabel: 'B' },
} as NodeData['modelConfigs'];
ok('legacy：两模型共享同一 ref 字符串', legacyConfigs?.[MODEL_A]?.lastFrameLocalRef === legacyConfigs?.['vidu 2.0']?.lastFrameLocalRef, 'same');
ok('scoped：两模型 ref 字符串不同', refA !== refB, 'different');

console.log('\n=== 5. Seedance2.0 急速/高质量共用首尾帧（回退 per-model 隔离）===\n');

ok('usesUnifiedFrameLocalRef 急速', usesUnifiedFrameLocalRef(SD20_FAST), String(usesUnifiedFrameLocalRef(SD20_FAST)));
ok('usesUnifiedFrameLocalRef 高质量', usesUnifiedFrameLocalRef(SD20_HQ), String(usesUnifiedFrameLocalRef(SD20_HQ)));
ok('seedance1.5 不共用', !usesUnifiedFrameLocalRef(MODEL_C), String(usesUnifiedFrameLocalRef(MODEL_C)));

const sd20SharedLast = buildFrameLocalRefForModel(SCOPE, NODE, 'lastFrame', SD20_FAST);
const sd20SharedFromHq = buildFrameLocalRefForModel(SCOPE, NODE, 'lastFrame', SD20_HQ);
const sd15Scoped = buildFrameLocalRefForModel(SCOPE, NODE, 'lastFrame', MODEL_C);
ok('急速/高质量 lastFrame ref 相同', sd20SharedLast === sd20SharedFromHq, `${sd20SharedLast}`);
ok('急速版 ref 为 legacy 4 段', isLegacyFrameLocalRef(sd20SharedLast), sd20SharedLast);
ok('seedance1.5 仍为 scoped', !isLegacyFrameLocalRef(sd15Scoped), sd15Scoped);

const sd20Blob = 'blob:http://localhost/sd20-last';
let sd20Configs: NodeData['modelConfigs'] = {};
const onSd20Fast = {
  selectedModel: SD20_FAST,
  lastFrameImage: sd20Blob,
  lastFrameLocalRef: sd20SharedLast,
  lastFrameImageLabel: 'SD20尾帧',
} as NodeData;
sd20Configs = saveFrameModelConfig(onSd20Fast, SD20_FAST, sd20Configs);

const onSd20Hq = restoreFrameFromConfig(SD20_HQ, sd20Configs) as NodeData;
// 急速↔高质量切换：resolveSeedanceConfigForModelSwitch 以当前面板同步
Object.assign(onSd20Hq, {
  selectedModel: SD20_HQ,
  lastFrameImage: onSd20Fast.lastFrameImage,
  lastFrameLocalRef: onSd20Fast.lastFrameLocalRef,
  lastFrameImageLabel: onSd20Fast.lastFrameImageLabel,
});
sd20Configs = saveFrameModelConfig(onSd20Hq, SD20_HQ, sd20Configs);

ok('高质量 modelConfigs 与急速共用 ref', (sd20Configs as Record<string, { lastFrameLocalRef?: string }>)[SD20_HQ]?.lastFrameLocalRef === sd20SharedLast, String((sd20Configs as Record<string, { lastFrameLocalRef?: string }>)[SD20_HQ]?.lastFrameLocalRef));
const backSd20Fast = restoreFrameFromConfig(SD20_FAST, sd20Configs);
ok('切回急速尾帧 ref 不变', backSd20Fast.lastFrameLocalRef === sd20SharedLast, String(backSd20Fast.lastFrameLocalRef));
ok('切回急速尾帧图不变', backSd20Fast.lastFrameImage === sd20Blob, String(backSd20Fast.lastFrameImage));

console.log('\n=== 6. 首帧/主图/参考图 per-model 独立（参考尾帧）===\n');

ok('首帧 legacy 可识别', isLegacyFrameLocalRef(buildLocalMediaRef(SCOPE, NODE, 'firstFrame')), buildLocalMediaRef(SCOPE, NODE, 'firstFrame'));
ok('主图 legacy 可识别', isLegacyMainLocalRef(legacyMain), legacyMain);
ok('参考 legacy 可识别', isLegacyReferenceLocalRef(legacyRef0), legacyRef0);
ok('主图 scoped 非 legacy', !isLegacyMainLocalRef(mainNano), mainNano);
ok('参考 scoped 非 legacy', !isLegacyReferenceLocalRef(refNano0), refNano0);

const ffA = 'blob:http://localhost/ff-a';
const ffB = 'blob:http://localhost/ff-b';
let ffConfigs: NodeData['modelConfigs'] = {};
const onKelingFf = {
  selectedModel: MODEL_A,
  firstFrameImage: ffA,
  firstFrameLocalRef: refAFirst,
  firstFrameImageLabel: '首帧A',
} as NodeData;
ffConfigs = saveFrameModelConfig(onKelingFf, MODEL_A, ffConfigs);
const onViduFf = restoreFrameFromConfig(MODEL_B, ffConfigs) as NodeData;
Object.assign(onViduFf, {
  firstFrameImage: ffB,
  firstFrameLocalRef: refBFirst,
  firstFrameImageLabel: '首帧B',
});
ffConfigs = saveFrameModelConfig(onViduFf, MODEL_B, ffConfigs);
ok('切回可灵首帧 ref 独立', restoreFrameFromConfig(MODEL_A, ffConfigs).firstFrameLocalRef === refAFirst, String(restoreFrameFromConfig(MODEL_A, ffConfigs).firstFrameLocalRef));
ok('切回可灵首帧图独立', restoreFrameFromConfig(MODEL_A, ffConfigs).firstFrameImage === ffA, String(restoreFrameFromConfig(MODEL_A, ffConfigs).firstFrameImage));

let imgConfigs = {
  'Nano Banana 2.0': {
    imagePreview: 'blob:http://localhost/nano-main',
    imageLocalRef: mainNano,
    referenceImages: ['blob:http://localhost/nano-ref'],
    referenceImageLocalRefs: [refNano0],
  },
  image2: {
    imagePreview: 'blob:http://localhost/img2-main',
    imageLocalRef: mainImage2,
    referenceImages: ['blob:http://localhost/img2-ref'],
    referenceImageLocalRefs: [refImage20],
  },
} as NodeData['modelConfigs'];
ok('Nano 主图 ref 独立', (imgConfigs as Record<string, { imageLocalRef?: string }>)['Nano Banana 2.0']?.imageLocalRef === mainNano, String((imgConfigs as Record<string, { imageLocalRef?: string }>)['Nano Banana 2.0']?.imageLocalRef));
ok('image2 主图 ref 独立', (imgConfigs?.image2 as { imageLocalRef?: string } | undefined)?.imageLocalRef === mainImage2, String((imgConfigs?.image2 as { imageLocalRef?: string } | undefined)?.imageLocalRef));
ok('Nano 参考 ref 独立', (imgConfigs?.['Nano Banana 2.0']?.referenceImageLocalRefs || [])[0] === refNano0, JSON.stringify(imgConfigs?.['Nano Banana 2.0']?.referenceImageLocalRefs));
ok('image2 参考 ref 独立', (imgConfigs?.image2?.referenceImageLocalRefs || [])[0] === refImage20, JSON.stringify(imgConfigs?.image2?.referenceImageLocalRefs));

const sd20Main = buildMainLocalRefForModel(SCOPE, NODE, SD20_FAST);
const sd20MainHq = buildMainLocalRefForModel(SCOPE, NODE, SD20_HQ);
const sd20Ref0 = buildReferenceLocalRefForModel(SCOPE, NODE, SD20_FAST, 0);
const sd20Ref0Hq = buildReferenceLocalRefForModel(SCOPE, NODE, SD20_HQ, 0);
ok('SD2.0 主图急速/高质量共用', sd20Main === sd20MainHq, sd20Main);
ok('SD2.0 参考急速/高质量共用', sd20Ref0 === sd20Ref0Hq, sd20Ref0);
ok('SD2.0 主图为 legacy', isLegacyMainLocalRef(sd20Main), sd20Main);
ok('usesUnifiedSeedance20PanelLocalRef', usesUnifiedSeedance20PanelLocalRef(SD20_FAST) && usesUnifiedFrameLocalRef(SD20_HQ), 'ok');

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
