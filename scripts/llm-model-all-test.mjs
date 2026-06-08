/**
 * 运行全部 LLM / 模型相关测试
 * node scripts/llm-model-all-test.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function runScript(relPath) {
  const file = path.join(ROOT, relPath);
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}\n>>> ${relPath}\n${'='.repeat(60)}`);
    const child = spawn(process.execPath, [file], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const suites = [
    'scripts/llm-context-switch-test.mjs',
    'scripts/llm-model-switch-matrix.mjs',
    'scripts/llm-combo-test.mjs',
  ];
  const results = [];
  for (const s of suites) {
    results.push([s, await runScript(s)]);
  }
  console.log(`\n${'='.repeat(60)}\n=== ALL LLM TESTS ===`);
  let failed = false;
  for (const [name, code] of results) {
    const ok = code === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failed = true;
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
