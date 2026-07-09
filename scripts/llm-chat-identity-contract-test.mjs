/**
 * Chat 身份/联网/tip 契约（纯离线，防回归）
 * 覆盖用户已验收：问候/身份问关联网、probe 不串历史、身份 tip 按需注入、四模式脚本存在
 *
 * npm run test:llm-chat-identity-contract
 * 已并入 npm run test:chat-gate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWebSearchProbeQueryFallback,
  isAssistantIdentityQuestion,
  isNonSearchableChatUtterance,
  resolveWebSearchProbeQuery,
} from '../utils/webSearchProbe.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${String(detail).slice(0, 100)}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('=== Chat 身份/联网/tip 契约（§5.10）===\n');

// —— 行为单元 ——
ok('身份问：你是哪个模型', isAssistantIdentityQuestion('你是哪个模型 你删除做什么'));
ok('身份问：你好你是谁', isNonSearchableChatUtterance('你好，你是谁？'));
ok('身份问：what model', isNonSearchableChatUtterance('What model are you?'));
ok('非身份：你能做什么', !isAssistantIdentityQuestion('你能做什么'));
ok('非身份：外部 Claude 调研', !isAssistantIdentityQuestion('Claude 是哪家公司开发的模型'));
ok('天气可检索', !isNonSearchableChatUtterance('现在深圳的天气怎么样'));

{
  const q = buildWebSearchProbeQueryFallback('你好，你是谁？', [
    { role: 'user', content: 'Claude Code Anthropic AI 编程助手介绍' },
    { role: 'assistant', content: 'Claude Code 是 Anthropic 的代理编码工具' },
  ]);
  ok('问候 fallback 不串 Claude Code', !/Claude|Anthropic|编程助手/i.test(q), q);
}

{
  const q = await resolveWebSearchProbeQuery({
    url: 'http://127.0.0.1:9/unused',
    apiKey: 'x',
    model: 'deepseek-v4-pro-260425',
    chatId: '297409_contract',
    turns: [{ role: 'assistant', content: '我是 Claude，由 Anthropic 开发' }],
    latestUserText: '你是哪个模型',
    enableLlmRewrite: false,
  });
  ok('身份 resolve 不串 Claude', !/Claude|Anthropic/i.test(q) && /哪个模型|你是/.test(q), q);
}

// —— 源码契约（防回退） ——
const chatPanel = read('components/ChatPanel.tsx');
const probe = read('utils/webSearchProbe.ts');
const pkg = JSON.parse(read('package.json'));
const chatGate = read('scripts/test-chat-gate.mjs');

ok(
  'ChatPanel 复用 isNonSearchableChatUtterance',
  /isNonSearchableChatUtterance/.test(chatPanel) &&
    /function isLightweightPrompt[\s\S]{0,120}isNonSearchableChatUtterance/.test(chatPanel)
);
ok(
  '联网首轮依赖 effectiveWebSearch',
  /isGeminiWebSearchFirstPass\s*=\s*\r?\n?\s*!!effectiveWebSearch/.test(chatPanel)
);
ok(
  '身份 tip 按需（identityQuestion）',
  /identityQuestion:\s*isAssistantIdentityQuestion/.test(chatPanel) &&
    /if\s*\(\s*opts\?\.identityQuestion\s*\)/.test(chatPanel)
);
ok(
  '禁止每轮强制长身份禁令回潮',
  !/禁止自称 Claude、GPT、Gemini、豆包/.test(chatPanel)
);
ok(
  'probe 导出 isAssistantIdentityQuestion',
  /export function isAssistantIdentityQuestion/.test(probe)
);
ok(
  'probe 非检索句跳过改写',
  /non-searchable|isNonSearchableChatUtterance/.test(probe) &&
    /skip rewrite \(non-searchable\)/.test(probe)
);
ok('package 含 test:llm:four-mode', !!pkg.scripts?.['test:llm:four-mode']);
ok('package 含 test:llm-chat-identity-contract', !!pkg.scripts?.['test:llm-chat-identity-contract']);
ok(
  'chat-gate 含 identity-contract 步',
  /test:llm-chat-identity-contract|llm-chat-identity-contract/.test(chatGate)
);
ok(
  '四模式脚本存在',
  fs.existsSync(path.join(root, 'scripts/llm-four-mode-matrix.mjs'))
);
ok(
  '审计 live 脚本存在',
  fs.existsSync(path.join(root, 'scripts/llm-chat-audit-live.mjs'))
);

console.log(`\n=== 契约汇总: ${pass} 通过, ${fail} 失败 ===`);
process.exit(fail > 0 ? 1 : 0);
