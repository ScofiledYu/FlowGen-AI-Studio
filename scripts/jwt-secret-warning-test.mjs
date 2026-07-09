import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let pass = 0;
let fail = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`  [OK] ${name}`);
    pass++;
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
    fail++;
  }
};

console.log('=== JWT secret 默认值警告测试 ===\n');

// 用子进程隔离环境变量，避免 ESM 模块缓存影响
ok('未设 FLOWGEN_JWT_SECRET 时打印安全警告', () => {
  const r = spawnSync(process.execPath, ['-e', `
    delete process.env.FLOWGEN_JWT_SECRET;
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    import('./server/flowgen/jwt.mjs').then(() => {
      console.warn = orig;
      const joined = warns.join('\\n');
      const has = joined.includes('[flowgen][security]') && joined.includes('FLOWGEN_JWT_SECRET');
      console.log('RESULT:' + (has ? 'PASS' : 'FAIL|' + joined.replace(/\\n/g, ' ')));
    });
  `], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    timeout: 15000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes('RESULT:PASS'), `应打印警告，实际输出: ${out.slice(-300)}`);
});

ok('设了 FLOWGEN_JWT_SECRET 时不打印警告', () => {
  const r = spawnSync(process.execPath, ['-e', `
    process.env.FLOWGEN_JWT_SECRET = 'test-secret-only';
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    import('./server/flowgen/jwt.mjs').then(() => {
      console.warn = orig;
      const has = warns.some(w => w.includes('[flowgen][security]'));
      console.log('RESULT:' + (has ? 'FAIL' : 'PASS'));
    });
  `], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    timeout: 15000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes('RESULT:PASS'), `不应打印警告，实际输出: ${out.slice(-300)}`);
});

console.log(`\n=== 汇总：通过 ${pass}，失败 ${fail} ===`);
if (fail > 0) process.exit(1);
