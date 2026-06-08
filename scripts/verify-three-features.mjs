/**
 * 交付前自检：三项功能是否已进入生产包（dist/FlowEditor-*.js）
 * 用法: node scripts/verify-three-features.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distAssets = path.join(root, 'dist', 'assets');

const flowEditorFiles = fs
  .readdirSync(distAssets)
  .filter((f) => f.startsWith('FlowEditor-') && f.endsWith('.js'));
if (flowEditorFiles.length !== 1) {
  console.error('FAIL: expected exactly one FlowEditor-*.js in dist/assets, got:', flowEditorFiles);
  process.exit(1);
}
const bundlePath = path.join(distAssets, flowEditorFiles[0]);
const bundle = fs.readFileSync(bundlePath, 'utf8');

const checks = [
  { id: '1-select-run-ui', needle: '选择运行', desc: '选择运行按钮文案' },
  { id: '1-select-run-confirm', needle: '没有可运行的选中节点', desc: '选择运行校验提示' },
  { id: '1-select-run-naming', needle: '生成的视频节点命名继承队列中上一节点的名称', desc: '选择运行命名说明' },
  { id: '1-select-run-stagger', needle: '每隔 ${Qs/1e3} 秒启动下一个', desc: '15s 错峰确认文案' },
  { id: '2-ref-video-omni-alt', needle: 'referenceMovs', desc: 'referenceMovs 字段' },
  { id: '2-ref-video-ui', needle: 'Reference Videos', desc: 'Node Details 参考视频区' },
  { id: '2-ref-video-no-ref', needle: 'No Reference Videos', desc: 'Node Details 无参考视频占位' },
  { id: '3-backdrop-menu', needle: '创建背景框', desc: '创建背景框菜单' },
  { id: '3-backdrop-hint', needle: '拖入框内可联动移动', desc: '背景框拖入提示' },
  { id: '3-selection-context-menu', needle: 'onSelectionContextMenu', desc: '框选区域右键' },
  { id: '3-backdrop-child-data', needle: 'backdropChildIds', desc: '背景框子节点 data 字段' },
];

// 构建后函数名会被压缩；以下用源码存在性二次校验
const source = fs.readFileSync(path.join(root, 'components', 'FlowEditor.tsx'), 'utf8');
const sourceChecks = [
  { id: 'src-select-run', needle: 'collectSelectedRunQueue', desc: '源码：选中运行队列' },
  { id: 'src-ref-video', needle: 'hasReferenceInputVideos', desc: '源码：参考视频省略首帧' },
  { id: 'src-ref-video-omni', needle: 'omniHasRefVideo', desc: '源码：Omni 参考视频不写首帧' },
  { id: 'src-backdrop-type', needle: 'NodeType.BACKDROP', desc: '源码：背景框节点类型' },
  { id: 'src-backdrop-geo', needle: 'setBackdropChildrenFromGeometry', desc: '源码：背景框几何成员' },
  { id: 'src-backdrop-inside', needle: 'collectNodeIdsInsideBackdropFrame', desc: '源码：框内节点检测' },
];

let failed = 0;
for (const c of checks) {
  const ok = bundle.includes(c.needle);
  console.log(`${ok ? 'OK' : 'FAIL'} [dist:${c.id}] ${c.desc}`);
  if (!ok) failed++;
}
for (const c of sourceChecks) {
  const ok = source.includes(c.needle);
  console.log(`${ok ? 'OK' : 'FAIL'} [src:${c.id}] ${c.desc}`);
  if (!ok) failed++;
}

const indexFiles = fs.readdirSync(distAssets).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
const indexJs = fs.readFileSync(path.join(distAssets, indexFiles[0]), 'utf8');
const feName = flowEditorFiles[0];
if (!indexJs.includes(feName)) {
  console.error('FAIL: index chunk does not reference current', feName);
  failed++;
} else {
  console.log('OK [dist-sync] index 引用的 FlowEditor 与 dist 一致:', feName);
}

console.log('\nBundle:', bundlePath, `(${(bundle.length / 1024).toFixed(0)} KB)`);
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll static checks passed.');
