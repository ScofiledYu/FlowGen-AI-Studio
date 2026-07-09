/**
 * Chat/LLM 日常门禁（纯离线，不调 API）
 * npm run test:chat-gate
 *
 * 含 §5.10 已验收：身份/问候关联网、probe 不串历史、身份 tip 按需、模型注册契约
 */
import { spawnSync } from 'node:child_process';

const steps = [
  { label: 'layout', cmd: 'npm', args: ['run', 'test:layout'] },
  { label: 'chat-pipeline', cmd: 'npm', args: ['run', 'test:chat-pipeline'] },
  { label: 'web-search-probe-unit', cmd: 'npm', args: ['run', 'test:llm:probe'], env: { CHAT_GATE_OFFLINE: '1' } },
  { label: 'llm-chat-identity-contract', cmd: 'npm', args: ['run', 'test:llm-chat-identity-contract'] },
  { label: 'llm-model-contract', cmd: 'npm', args: ['run', 'test:llm-model-contract'] },
];

console.log('=== FlowGen test:chat-gate（Chat/LLM 离线门禁）===\n');

for (const step of steps) {
  console.log(`--- [chat-gate] ${step.label} ---`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(step.env || {}) },
  });
  if (result.status !== 0) {
    console.error(`\n❌ test:chat-gate 失败于: ${step.label}`);
    process.exit(result.status || 1);
  }
}

console.log('\n✅ test:chat-gate 全部通过');
