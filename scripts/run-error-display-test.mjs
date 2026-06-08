import { shouldAppendRunMediaDiagnostics } from '../utils/runErrorDisplay.ts';

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
ok('append API error', shouldAppendRunMediaDiagnostics('HTTP 500 API error'));
ok('append generic', shouldAppendRunMediaDiagnostics('上传失败'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
