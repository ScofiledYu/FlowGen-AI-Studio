import {
  shouldAppendRunMediaDiagnostics,
  isAitopPlatformError,
  formatAitopPlatformSupportHint,
  errorSuggestsMediaSpecIssue,
} from '../utils/runErrorDisplay.ts';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}`);
  if (cond) pass++;
  else fail++;
}

ok('skip prompt @ hint', !shouldAppendRunMediaDiagnostics('请在创意描述中用 @主图'));
ok('skip no @ in prompt', !shouldAppendRunMediaDiagnostics('创意描述中未使用 @ 引用'));
ok('skip empty prompt', !shouldAppendRunMediaDiagnostics('请先填写创意描述'));
ok('skip aitop empty data', !shouldAppendRunMediaDiagnostics('状态成功，进度100，但返回的data为{}'));
ok('skip generic API 500', !shouldAppendRunMediaDiagnostics('HTTP 500 API error'));
ok('append aspect ratio', shouldAppendRunMediaDiagnostics('视频尺寸不符合要求，宽高比不对'));
ok('append upload fail', shouldAppendRunMediaDiagnostics('参考图上传失败，请检查主图'));
ok('detect aitop platform', isAitopPlatformError('状态成功，进度100，但返回的data为{}'));
ok('detect aitop upload fail', isAitopPlatformError('**❌ AITOP 图片上传失败**\n**错误代码：** 1102'));
ok('aitop hint present', formatAitopPlatformSupportHint('data为{}').includes('AITOP100'));
ok(
  'aitop hint prints billing',
  formatAitopPlatformSupportHint('data为{}', {
    domainAccount: 'liangyu',
    scoreProjectId: 'proj-abc-123',
  }).includes('**域账号：** liangyu') &&
    formatAitopPlatformSupportHint('data为{}', {
      domainAccount: 'liangyu',
      scoreProjectId: 'proj-abc-123',
    }).includes('**项目 ID（scoreProjectId）：** proj-abc-123')
);
ok('media spec detect', errorSuggestsMediaSpecIssue('分辨率不符合要求'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
