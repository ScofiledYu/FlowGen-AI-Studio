/**
 * 可灵3.0 Omni 四 tab：主图共用；参考图/顶栏视频/首尾帧独立
 * npx tsx scripts/kling-omni-tab-isolation-test.ts
 */
import type { NodeData } from '../types.ts';
import {
  buildKlingOmniFrameLocalRefForTab,
  buildKlingOmniReferenceLocalRefForTab,
  buildFrameLocalRefForModel,
  buildMainLocalRefForModel,
  buildReferenceLocalRefForModel,
} from '../utils/localNodeMediaStore.ts';
import {
  buildKlingOmniTabSwitchPatch,
  snapshotKlingOmniTabConfigsWithLivePanel,
} from '../utils/klingOmniTabPanelIsolation.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const SCOPE = 'uid_pid';
const NODE = 'omni_tab_node';
const OMNI = '可灵3.0 Omni';

console.log('\n=== 1. Omni 参考/首尾帧 IDB 键按 tab 隔离；主图模型级共用 ===\n');
const multiRef0 = buildKlingOmniReferenceLocalRefForTab(SCOPE, NODE, 'multi', 0);
const instRef0 = buildKlingOmniReferenceLocalRefForTab(SCOPE, NODE, 'instruction', 0);
const omniMain = buildMainLocalRefForModel(SCOPE, NODE, OMNI);
const omniFf = buildKlingOmniFrameLocalRefForTab(SCOPE, NODE, 'firstFrame');
const kelingFf = buildFrameLocalRefForModel(SCOPE, NODE, 'firstFrame', '可灵 2.5 Turbo');

ok('multi vs instruction 参考 ref 不同', multiRef0 !== instRef0);
ok('Omni 主图用模型级单键', omniMain.endsWith(':main:可灵30_Omni'));
ok('Omni 首尾帧 vs 可灵2.5 首尾帧不同', omniFf !== kelingFf);
ok('旧版共用 Omni 模型 ref 与 tab ref 不同', multiRef0 !== buildReferenceLocalRefForModel(SCOPE, NODE, OMNI, 0));

console.log('\n=== 2. tab 切换：主图四 tab 保留；首尾帧/顶栏视频独立 ===\n');

const mainUrl = 'blob:http://localhost/shared-main';
const base = {
  selectedModel: OMNI,
  klingOmniTab: 'multi',
  imagePreview: mainUrl,
  imageLocalRef: omniMain,
  firstFrameImage: 'blob:http://localhost/stale-ff',
  firstFrameLocalRef: omniFf,
  klingOmniMultiReferenceImages: ['blob:http://localhost/mref0'],
  klingOmniInstructionReferenceImages: ['blob:http://localhost/iref0'],
  klingOmniInstructionVideoPreviewUrl: 'blob:http://localhost/inst-vid',
} as NodeData;

const toInst = buildKlingOmniTabSwitchPatch(base, 'multi', 'instruction');
ok('multi→instruction 主图不在 patch 中（节点层保留）', toInst.imagePreview === undefined);
ok('multi→instruction 清空顶层首尾帧', !toInst.firstFrameImage && !toInst.firstFrameLocalRef);
ok('multi→instruction 不写入主图 tab 快照', !('multi' in (toInst.klingOmniTabConfigs || {})));

const withInstVideo = {
  ...base,
  ...toInst,
  klingOmniTab: 'instruction',
  klingOmniTabConfigs: {
    instruction: {
      klingOmniInstructionVideoPreviewUrl: 'blob:http://localhost/inst-vid-saved',
    },
  },
} as NodeData;

const instLoaded = buildKlingOmniTabSwitchPatch(withInstVideo, 'multi', 'instruction');
ok('instruction 恢复顶栏视频快照', instLoaded.klingOmniInstructionVideoPreviewUrl === 'blob:http://localhost/inst-vid-saved');

const framesSnap = snapshotKlingOmniTabConfigsWithLivePanel(
  {
    ...base,
    klingOmniTab: 'frames',
    firstFrameImage: 'blob:http://localhost/ff-a',
    lastFrameImage: 'blob:http://localhost/lf-a',
    firstFrameLocalRef: omniFf,
    lastFrameLocalRef: buildKlingOmniFrameLocalRefForTab(SCOPE, NODE, 'lastFrame'),
  } as NodeData,
  'frames'
);
ok('frames 快照仅首尾帧', framesSnap.frames?.firstFrameImage === 'blob:http://localhost/ff-a');

const toFrames = buildKlingOmniTabSwitchPatch(
  {
    ...base,
    klingOmniTabConfigs: { frames: framesSnap.frames },
  } as NodeData,
  'multi',
  'frames'
);
ok('multi→frames 不剥离主图', toFrames.imagePreview === undefined);
ok('multi→frames 恢复首帧', toFrames.firstFrameImage === 'blob:http://localhost/ff-a');
ok('multi→frames 恢复尾帧', toFrames.lastFrameImage === 'blob:http://localhost/lf-a');

const backMulti = buildKlingOmniTabSwitchPatch(
  {
    ...base,
    ...toFrames,
    imagePreview: mainUrl,
    klingOmniTabConfigs: toFrames.klingOmniTabConfigs,
  } as NodeData,
  'frames',
  'multi'
);
ok('frames→multi 不碰主图 patch', backMulti.imagePreview === undefined);
ok('frames→multi 清空 live 首尾帧', !backMulti.firstFrameImage && !backMulti.lastFrameImage);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
