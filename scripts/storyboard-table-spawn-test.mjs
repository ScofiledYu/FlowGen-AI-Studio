/**
 * 分镜表批量生成下游节点 — 表头 / prompt / 时长绿黄判定
 * node scripts/storyboard-table-spawn-test.mjs
 */
import {
  STORYBOARD_TABLE_ERR,
  STORYBOARD_TEMPLATE_ASSET_ERR,
  STORYBOARD_TEMPLATE_ERR,
  applyShotDurationToNodeData,
  buildPromptFromRow,
  isProjectAssetLibraryImageUrl,
  parseStoryboardTableColumns,
  parseStoryboardSpawnRows,
  resolveSingleTemplateNode,
  validateStoryboardTableSpawn,
  validateTemplateUsesProjectAssetLibrary,
  getMissingStoryboardRequiredHeaders,
  getMissingStoryboardExcelRequiredHeaders,
  STORYBOARD_EXCEL_FORMAT_ERR,
  validateStoryboardExcelTableSpawn,
  checkStoryboardTemplateAssetBinding,
} from '../utils/storyboardTableSpawn.ts';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const sampleRows = [
  ['镜头编号', '单镜秒数', '关联剧本', '景别/视角/构图'],
  ['ep003_seq008_sc056', '15', '08场·颁奖台', '近景→特写/平视/渴望构图'],
  ['ep003_seq009_sc057', '5', '09场', '全景'],
];

ok('表头解析', !!parseStoryboardTableColumns(sampleRows));
ok('镜头编码别名', !!parseStoryboardTableColumns([
  ['镜头编码', '单镜秒数', '关联剧本'],
  ['ep003_seq008_sc056', '15', 'test'],
]));
ok('缺单镜秒数', !parseStoryboardTableColumns([['镜头编号', '关联剧本']]));

ok(
  '对话表 缺镜头编码',
  getMissingStoryboardRequiredHeaders(['单镜秒数', '关联剧本']).includes('镜头编码')
);
ok(
  '对话表 缺单镜秒数',
  getMissingStoryboardRequiredHeaders(['镜头编码', '关联剧本']).includes('单镜秒数')
);
ok(
  '对话表 表头完整',
  getMissingStoryboardRequiredHeaders(['镜头编码', '单镜秒数', '关联剧本']).length === 0
);
ok(
  '对话表 缺列两项',
  getMissingStoryboardRequiredHeaders(['关联剧本']).length === 2
);

ok(
  'Excel 严格 表头完整',
  getMissingStoryboardExcelRequiredHeaders(['镜头编码', '单镜秒数', '关联剧本']).length === 0
);
ok(
  'Excel 严格 接受镜头编号',
  getMissingStoryboardExcelRequiredHeaders(['镜头编号', '单镜秒数']).length === 0
);
ok(
  'Excel 严格 缺镜头编码',
  getMissingStoryboardExcelRequiredHeaders(['单镜秒数', '关联剧本']).includes('镜头编码（或镜头编号）')
);
ok(
  'Excel 严格 缺单镜秒数',
  getMissingStoryboardExcelRequiredHeaders(['镜头编码', '关联剧本']).includes('单镜秒数')
);
ok(
  'Excel 严格 模糊编号+时长不通过',
  !parseStoryboardTableColumns([['编号', '时长', '画面描述'], ['a', '5', 'x']], { strictExcelHeaders: true })
);
ok(
  'Excel 严格 时长别名不通过',
  !parseStoryboardTableColumns([['镜头编码', '时长'], ['a', '5']], { strictExcelHeaders: true })
);
ok(
  'Excel 严格 正确表头通过',
  !!parseStoryboardTableColumns([['镜头编码', '单镜秒数', '画面描述'], ['a', '5', 'x']], { strictExcelHeaders: true })
);

const prompt = buildPromptFromRow(sampleRows[1], [
  { header: '关联剧本', idx: 2 },
  { header: '景别/视角/构图', idx: 3 },
]);
ok('prompt 含关联剧本', prompt.includes('关联剧本：08场·颁奖台'));
ok('prompt 双换行分隔', prompt.includes('\n\n景别/视角/构图：'));

const seedanceGreen = applyShotDurationToNodeData(
  { label: 'x', selectedModel: 'seedance2.0 (高质量版)' },
  '15'
);
ok('Seedance 15s 绿', seedanceGreen.spawnHighlight === 'green' && seedanceGreen.patch.seedanceDuration === '15s');

const klingRed = applyShotDurationToNodeData(
  { label: 'x', selectedModel: '可灵 2.5 Turbo' },
  '15'
);
ok('可灵 15s 红', klingRed.spawnHighlight === 'red' && !klingRed.patch.duration);

const klingGreen = applyShotDurationToNodeData(
  { label: 'x', selectedModel: '可灵 2.5 Turbo' },
  '5s'
);
ok('可灵 5s 绿', klingGreen.spawnHighlight === 'green' && klingGreen.patch.duration === '5s');

const spawnRows = parseStoryboardSpawnRows(sampleRows, { label: 't', selectedModel: '可灵 2.5 Turbo' });
ok('解析 2 行', !('error' in spawnRows) && spawnRows.length === 2);
ok('首行镜头编号', !('error' in spawnRows) && spawnRows[0].shotId === 'ep003_seq008_sc056');

ok('多选模板报错', resolveSingleTemplateNode([{ id: 'a' }, { id: 'b' }], null) === null);
ok('单选模板', resolveSingleTemplateNode([{ id: 'a' }], null)?.id === 'a');

const badTable = validateStoryboardTableSpawn([['镜头编号', 'x']], [{ id: 'n1' }], null);
ok('缺列报错', !badTable.ok && badTable.error === STORYBOARD_TABLE_ERR);

const noNode = validateStoryboardTableSpawn(sampleRows, [], null);
ok('无节点报错', !noNode.ok && noNode.error === STORYBOARD_TEMPLATE_ERR);

const assetUrl = '/flowgen-api/projects/p1/assets/a1/file';

const fuzzyExcel = validateStoryboardExcelTableSpawn(
  [['编号', '时长', '画面'], ['x', '5', 'y']],
  [{ id: 'tpl', data: { label: 't', imagePreview: assetUrl } }],
  null
);
ok(
  'Excel 校验 随机表拒绝',
  !fuzzyExcel.ok && fuzzyExcel.error === STORYBOARD_EXCEL_FORMAT_ERR
);

ok(
  '本地 blob 节点不可作分镜模板',
  checkStoryboardTemplateAssetBinding({
    label: 't',
    imagePreview: 'blob:http://localhost/abc',
  }).ok === false
);
ok(
  '资产库节点可作分镜模板',
  checkStoryboardTemplateAssetBinding({
    label: 't',
    imagePreview: assetUrl,
  }).ok === true
);

ok('资产库 URL 识别', isProjectAssetLibraryImageUrl(assetUrl));
ok('blob 非资产库', !isProjectAssetLibraryImageUrl('blob:http://localhost/abc'));

const blobTpl = validateStoryboardTableSpawn(
  sampleRows,
  [{ id: 'tpl', data: { label: 't', imagePreview: 'blob:http://localhost/abc' } }],
  null
);
ok(
  '本地 blob 模板拒绝',
  !blobTpl.ok && blobTpl.error.includes('资产库')
);

const assetIdOnlyLocalRef = validateStoryboardTableSpawn(
  sampleRows,
  [
    {
      id: 'tpl',
      data: {
        label: 't',
        imagePreview: 'blob:http://localhost/fake',
        imageLocalRef: 'flowgen-local:u1:p1:n1:main',
        projectAssetId: 'a1',
      },
    },
  ],
  null,
  undefined,
  'p1'
);
ok('projectAssetId + 项目 id 即通过（忽略 blob/localRef）', assetIdOnlyLocalRef.ok === true);

const noImgTpl = validateStoryboardTableSpawn(
  sampleRows,
  [{ id: 'tpl', data: { label: 't' } }],
  null
);
ok(
  '无图模板拒绝',
  !noImgTpl.ok && noImgTpl.error.includes(STORYBOARD_TEMPLATE_ASSET_ERR.slice(0, 12))
);

const good = validateStoryboardTableSpawn(
  sampleRows,
  [{ id: 'tpl', data: { label: 't', imagePreview: assetUrl } }],
  null
);
ok('资产库模板校验通过', good.ok && good.spawnRows.length === 2);

const assetWithLocalRef = validateTemplateUsesProjectAssetLibrary({
  label: 't',
  imagePreview: assetUrl,
  imageLocalRef: 'flowgen-local:u1:p1:n1:main',
});
ok(
  '资产库 URL + imageLocalRef 缓存仍通过',
  assetWithLocalRef.ok === true
);

const blobWithAssetId = validateTemplateUsesProjectAssetLibrary(
  {
    label: 't',
    imagePreview: 'blob:http://10.98.98.211/abc',
    imageLocalRef: 'flowgen-local:u1:p1:n1:main',
    projectAssetId: 'a1',
  },
  'p1'
);
ok('blob 预览 + projectAssetId 仍通过', blobWithAssetId.ok === true);

const liveData = { label: 't', imagePreview: 'blob:http://localhost/stale' };
const liveGetter = (id) => (id === 'tpl' ? { label: 't', imagePreview: assetUrl } : undefined);
const staleProps = validateStoryboardTableSpawn(
  sampleRows,
  [{ id: 'tpl', data: liveData }],
  null,
  liveGetter
);
ok('live 数据覆盖 props 后通过', staleProps.ok);

const blobOnlyAssetId = validateStoryboardTableSpawn(
  sampleRows,
  [
    {
      id: 'tpl',
      data: {
        label: 't',
        imagePreview: 'blob:http://localhost/fake',
        imageLocalRef: 'flowgen-local:u:p:n:main',
        projectAssetId: 'a1',
      },
    },
  ],
  null,
  undefined,
  'p1'
);
ok('blob+localRef+assetId+projectId 通过', blobOnlyAssetId.ok === true);

const urlOnlyNoExplicitPid = validateStoryboardTableSpawn(
  sampleRows,
  [
    {
      id: 'tpl',
      data: {
        label: 't',
        imagePreview: '/flowgen-api/projects/p-from-url/assets/a-from-url/file',
        imageLocalRef: 'flowgen-local:u:p:n:main',
      },
    },
  ],
  null
);
ok('预览 URL 含资产链时忽略 localRef', urlOnlyNoExplicitPid.ok === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
