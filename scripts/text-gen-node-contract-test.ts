/**
 * Text Node（文生节点）契约测试：
 * 1) 模型白名单 = Nano Banana 2.0 / image 2 / seedance2.0 x2（为 Image Node 已验收模型子集）
 * 2) 面板源码契约：模型下拉限定白名单、隐藏媒体区、禁用 @ 引用、seedance2.0 仅文生 tab
 * 3) 画布节点契约：textGenNode 空态不弹本地选择、不接收拖入媒体
 * 4) 菜单契约：Text Node 以 PROCESSOR + textGenNode:true 创建（复用全部运行链路）
 * 5) S 级保护：普通节点面板路径（INSPECTOR_SELECTABLE_MODELS 等）不受影响
 *
 * npx tsx scripts/text-gen-node-contract-test.ts
 */
import { readFileSync } from 'node:fs';
import {
  INSPECTOR_SELECTABLE_MODELS,
  MODEL_IMAGE_2,
  MODEL_MIDJOURNEY,
  MODEL_NANO_BANANA_2,
  TEXT_GEN_NODE_MODELS,
  isTextGenNodeModel,
} from '../types.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function readSrc(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}

console.log('\n=== 1. 模型白名单契约 ===\n');

ok('白名单长度 = 7', TEXT_GEN_NODE_MODELS.length === 7, TEXT_GEN_NODE_MODELS.join(' | '));
ok('含 Nano Banana 2.0', (TEXT_GEN_NODE_MODELS as readonly string[]).includes(MODEL_NANO_BANANA_2));
ok('含 image 2', (TEXT_GEN_NODE_MODELS as readonly string[]).includes(MODEL_IMAGE_2));
ok('含 MidJourney', (TEXT_GEN_NODE_MODELS as readonly string[]).includes(MODEL_MIDJOURNEY));
ok('含 seedance2.0 (4k版)', (TEXT_GEN_NODE_MODELS as readonly string[]).includes('seedance2.0 (4k版)'));
ok('含 seedance2.0 (高质量版)', (TEXT_GEN_NODE_MODELS as readonly string[]).includes('seedance2.0 (高质量版)'));
ok('含 seedance2.0 (急速版)', (TEXT_GEN_NODE_MODELS as readonly string[]).includes('seedance2.0 (急速版)'));
ok('含 seedance2.5', (TEXT_GEN_NODE_MODELS as readonly string[]).includes('seedance2.5'));
ok(
  '白名单除 MidJourney（Text Node 专属）外 ⊆ 面板可选模型（运行链路完全复用）',
  TEXT_GEN_NODE_MODELS.filter((m) => m !== MODEL_MIDJOURNEY).every((m) =>
    (INSPECTOR_SELECTABLE_MODELS as readonly string[]).includes(m)
  )
);
ok(
  'MidJourney 为 Text Node 专属（不进普通面板下拉）',
  !(INSPECTOR_SELECTABLE_MODELS as readonly string[]).includes(MODEL_MIDJOURNEY)
);
ok('不含可灵3.0 Omni', !isTextGenNodeModel('可灵3.0 Omni'));
ok('不含即梦3.0 Pro', !isTextGenNodeModel('即梦3.0 Pro'));
ok('不含 seedance1.5-pro', !isTextGenNodeModel('seedance1.5-pro'));
ok('isTextGenNodeModel(undefined) = false', !isTextGenNodeModel(undefined));
ok('isTextGenNodeModel(Nano) = true', isTextGenNodeModel(MODEL_NANO_BANANA_2));

console.log('\n=== 2. NodeInspector 面板源码契约 ===\n');

const inspector = readSrc('components/NodeInspector.tsx');

ok(
  '面板定义 isTextGenNode 标志',
  /const isTextGenNode = Boolean\(data\.textGenNode\)/.test(inspector)
);
ok(
  '模型下拉：文生节点用白名单',
  /\{\(isTextGenNode \? TEXT_GEN_NODE_MODELS : INSPECTOR_SELECTABLE_MODELS\)\.map/.test(inspector)
);
ok(
  '@ 引用：文生节点 promptMentionItems 置空',
  /isTextGenNode \? \[\] : buildInspectorPromptMentionItems/.test(inspector)
);
ok(
  'seedance2.0 tab 切换：文生节点拦截非 text',
  /if \(isTextGenNode && target !== 'text'\) return/.test(inspector)
);
ok(
  '切模型恢复：文生节点 seedance 模式强制 text',
  /: isTextGenNode\s*\n\s*\? 'text'/.test(inspector)
);
ok(
  '首次选模型：文生节点 seedance 默认 text（非 reference）',
  /\? 'image' : isTextGenNode \? 'text' : 'reference'/.test(inspector)
);
ok(
  '上传提示区：文生节点隐藏',
  /\{!isTextGenNode && !isKeling && !isJimeng && !isVidu && !isSeedance && \(/.test(inspector)
);
ok(
  'Nano 文生图：素材区整段隐藏（MJ 文生保留参考图区）',
  /\{!\(isTextGenNode && !isSeedance20 && !isImage2 && !isMidJourney\) && \(/.test(inspector)
);
ok(
  'MidJourney 面板：素材区含风格族/参考图折叠/风格下拉',
  /MJ_FAMILY_OPTIONS/.test(inspector) &&
    /mjRefImagesOpen/.test(inspector) &&
    /MJ_STYLE_OPTIONS/.test(inspector)
);
ok(
  'MidJourney 面板：设置区含版本/比例/中文画质/高级参数折叠',
  /MJ_VERSION_OPTIONS_REALISTIC/.test(inspector) &&
    /MJ_VERSION_OPTIONS_CARTOON/.test(inspector) &&
    /MJ_QUALITY_OPTIONS\.map\(\(q\) => \(/.test(inspector) &&
    /mjAdvancedOpen/.test(inspector)
);
ok(
  'MidJourney 面板：版本选项按风格族分流（realistic/cartoon）',
  /mjFamily === 'cartoon'/.test(inspector)
);
ok(
  'MidJourney 面板：上传 handler 转 COS URL（uploadImage）',
  /const handleMjReferenceFile = async \(kind: 'sref' \| 'cref' \| 'oref'/.test(inspector) &&
    /await uploadImage\(previewUrl\)/.test(inspector)
);
ok(
  'MidJourney 切模型：保存/恢复 modelConfigs（isMidJourneyFamilyModel）',
  /else if \(isMidJourneyFamilyModel\(oldModel\)\)/.test(inspector) &&
    /else if \(isMidJourneyFamilyModel\(model\)\)/.test(inspector)
);
ok(
  'image2 文生图：多图参考隐藏（保留风格）',
  /\{!isTextGenNode && \(\s*\n\s*<div>\s*\n\s*<div className="flex items-center justify-between mb-1\.5">/.test(inspector)
);
ok(
  '扫描 @素材按钮：文生节点隐藏',
  /\{projectAssetLibraryEnabled && !isTextGenNode && \(/.test(inspector)
);
ok(
  '创意描述 placeholder：文生节点纯文生文案',
  /isTextGenNode\s*\n\s*\? '输入文字描述生成图片\/视频（纯文生，无需 @ 引用素材）'/.test(inspector)
);

console.log('\n=== 3. CustomNode 画布节点契约 ===\n');

const customNode = readSrc('components/nodes/CustomNode.tsx');

ok(
  '画布定义 isTextGenNode 标志',
  /const isTextGenNode = Boolean\(data\.textGenNode\)/.test(customNode)
);
ok(
  '空态不提供本地文件选择',
  /showEmptyPickLocal = .*&&!isTextGenNode/.test(customNode.replace(/\s+/g, ' ')) ||
    /!isTextGenNode;/.test(customNode)
);
ok(
  '不接收拖入媒体（onDrop 早退）',
  /if \(isTextGenNode\) return;/.test(customNode)
);

console.log('\n=== 4. FlowEditor 菜单创建契约 ===\n');

const flowEditor = readSrc('components/FlowEditor.tsx');

ok(
  '菜单含 Text Node 入口',
  /Text Node/.test(flowEditor)
);
ok(
  'Text Node 以 PROCESSOR + textGenNode:true 创建',
  /addNodeFromMenu\(NodeType\.PROCESSOR, 'Text Node', \{ textGenNode: true \}\)/.test(flowEditor)
);

console.log('\n=== 5. S 级保护：普通节点路径不受影响 ===\n');

ok(
  'INSPECTOR_SELECTABLE_MODELS 为 8 项（含 seedance2.0 4k版）',
  INSPECTOR_SELECTABLE_MODELS.length === 8,
  INSPECTOR_SELECTABLE_MODELS.join(' | ')
);
ok(
  '面板普通分支仍引用 INSPECTOR_SELECTABLE_MODELS',
  /: INSPECTOR_SELECTABLE_MODELS\)\.map/.test(inspector)
);
ok(
  'image2 运行链路含文生空图守卫（bug 修复契约，勿移除）',
  /if \(!imageUrls\.length && !currentNode\.data\.textGenNode\)/.test(flowEditor)
);
ok(
  '运行链路仅此一处 textGenNode 分支（其余完全复用）',
  !/textGenNode/.test(
    flowEditor
      .replace(/addNodeFromMenu\(NodeType\.PROCESSOR, 'Text Node', \{ textGenNode: true \}\)/, '')
      .replace(/\/\/ Text Node（textGenNode）纯文生无参考图可上传，imageUrls 为空属正常，跳过图生图强制校验/, '')
      .replace(/if \(!imageUrls\.length && !currentNode\.data\.textGenNode\) \{/, '')
  )
);

console.log('\n=== 6. MidJourney/Niji 运行链路契约 ===\n');

ok(
  'FlowEditor 含 MJ 家族运行分支（isMidJourneyFamilyModel）',
  /else if \(isMidJourneyFamilyModel\(model\)\)/.test(flowEditor)
);
ok(
  'MJ 运行分支调用 createMjImagineTask',
  /createMjImagineTask\(prompt, \{/.test(flowEditor)
);
ok(
  'MJ 运行分支复用并行任务 + 轮询（runParallelGenerationTasks / pollImageTaskUntilUrl）',
  /runParallelGenerationTasks\(\s*finalImageCount/.test(flowEditor) &&
    /pollImageTaskUntilUrl\(taskId, \{\s*failLabel: model/.test(flowEditor)
);
ok(
  'MJ 运行分支透传面板参数（mjVersion/mjMode/mjRatio/sref/cref/oref）',
  /mjSrefUrl,\s*\n\s*mjCrefUrl,\s*\n\s*mjOrefUrl,/.test(flowEditor)
);
ok(
  'OUTPUT 节点继承白名单含 MJ 字段（mjVersion/mjRatio/mjMode）',
  /'mjVersion',/.test(flowEditor) && /'mjRatio',/.test(flowEditor) && /'mjMode',/.test(flowEditor)
);
ok(
  'Node Details Used Parameters 含 MJ 分支（isMjParams）',
  /else if \(isMjParams\)/.test(flowEditor)
);

const aitop = readSrc('services/aitop.ts');
ok(
  'aitop.createMjImagineTask：platform=MidJourney + model/mode 必填',
  /platform: 'MidJourney',/.test(aitop) && /model: options\.mjVersion/.test(aitop)
);
ok(
  'aitop.createMjImagineTask：angle/camera/light/art 透传',
  /payload\.angle = options\.mjAngle/.test(aitop) &&
    /payload\.camera = options\.mjCamera/.test(aitop) &&
    /payload\.light = options\.mjLight/.test(aitop) &&
    /payload\.art = options\.mjArt/.test(aitop)
);
ok(
  'aitop.createMjImagineTask：sref/cref/oref 仅透传 http(s)（blob 防护）',
  /\/\^https\?:\\\/\\\/\/i\.test\(s\) \? s : ''/.test(aitop)
);

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);
