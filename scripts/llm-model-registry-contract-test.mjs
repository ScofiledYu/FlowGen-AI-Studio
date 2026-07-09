/**
 * LLM 模型注册契约（纯离线：解析 aitopChatModels + ChatPanel 路由）
 * node scripts/llm-model-registry-contract-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REGISTRY = path.join(ROOT, 'utils', 'aitopChatModels.ts');
const CHAT_PANEL = path.join(ROOT, 'components', 'ChatPanel.tsx');
const SERVER = path.join(ROOT, 'server.js');
const VITE = path.join(ROOT, 'vite.config.ts');

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseAitopRegistry(src) {
  const uiIds = [];
  for (const m of src.matchAll(/uiId:\s*'([^']+)'/g)) {
    uiIds.push(m[1]);
  }
  const apiModels = [];
  for (const m of src.matchAll(/apiModelName:\s*'([^']+)'/g)) {
    apiModels.push(m[1]);
  }
  const displayLabels = [];
  for (const m of src.matchAll(/displayLabel:\s*'([^']+)'/g)) {
    displayLabels.push(m[1]);
  }
  const fallbackOrder = [];
  const fbBlock = src.match(/AITOP_CHAT_FALLBACK_ORDER[^=]*=\s*\[([\s\S]*?)\]/);
  if (fbBlock) {
    for (const m of fbBlock[1].matchAll(/'([^']+)'/g)) {
      fallbackOrder.push(m[1]);
    }
    if (/QWEN_CHAT_UI_ID/.test(fbBlock[1]) && !fallbackOrder.includes('qwen')) {
      fallbackOrder.push('qwen');
    }
  }
  return { uiIds, apiModels, displayLabels, fallbackOrder };
}

/** 与 utils/aitopChatModels.normalizeChatModelId 对齐 */
function normalizeChatModelId(modelId) {
  if (modelId === 'gemini3pro') return 'gemini-3-pro';
  if (modelId === 'claude45') return 'claude-4.5';
  if (modelId === 'qwen') return 'qwen';
  if (AITOP_UI_IDS.includes(modelId)) return modelId;
  return 'claude-4.5';
}

function chatModelFallbackChain(primaryUiId) {
  if (primaryUiId === 'qwen') return [];
  return FALLBACK_ORDER.filter((id) => id !== primaryUiId);
}

const registrySrc = read(REGISTRY);
const { uiIds: AITOP_UI_IDS, apiModels, displayLabels, fallbackOrder: FALLBACK_ORDER } =
  parseAitopRegistry(registrySrc);
const UI_MODELS = [...AITOP_UI_IDS, 'qwen'];
const chatSrc = read(CHAT_PANEL);

console.log('\n=== LLM 模型注册契约 ===\n');

ok('AITOP 注册表至少 4 项', AITOP_UI_IDS.length >= 4, AITOP_UI_IDS.join(', '));
ok('含 deepseek-v4-pro', AITOP_UI_IDS.includes('deepseek-v4-pro'));
ok('含 doubao-seed-2.0', AITOP_UI_IDS.includes('doubao-seed-2.0'));
ok('DeepSeek API 名', apiModels.some((n) => n === 'deepseek-v4-pro-260425'));
ok('DouBao API 名', apiModels.some((n) => n === 'doubao-seed-2-0-pro-260215'));
ok('UI 模型 id 唯一', new Set(UI_MODELS).size === UI_MODELS.length, UI_MODELS.join(','));

for (const id of UI_MODELS) {
  ok(`${id}: normalize 保留`, normalizeChatModelId(id) === id);
  const labelIdx = AITOP_UI_IDS.indexOf(id);
  if (labelIdx >= 0) {
    ok(`${id}: displayLabel 非空`, (displayLabels[labelIdx] || '').length > 1, displayLabels[labelIdx]);
  }
  const chain = chatModelFallbackChain(id);
  ok(`${id}: fallback 不含自身`, !chain.includes(id), chain.join('->'));
  for (const fb of chain) {
    ok(`${id}: fallback→${fb} 已注册`, UI_MODELS.includes(fb));
  }
}

ok('fallback 链含 deepseek 与 doubao', FALLBACK_ORDER.includes('deepseek-v4-pro') && FALLBACK_ORDER.includes('doubao-seed-2.0'));
ok('alias gemini3pro', normalizeChatModelId('gemini3pro') === 'gemini-3-pro');
ok('alias claude45', normalizeChatModelId('claude45') === 'claude-4.5');
ok('未知 id 默认 claude', normalizeChatModelId('unknown-model-xyz') === 'claude-4.5');

ok('ChatPanel 引用 aitopChatModels', /from\s+['"]\.\.\/utils\/aitopChatModels['"]/.test(chatSrc));
ok('AI_MODELS 来自 buildChatAiModelsForUi', /buildChatAiModelsForUi\(\)/.test(chatSrc));
ok('sendByModel isAitopLlmUiModel', /isAitopLlmUiModel\(modelId\)/.test(chatSrc));
ok('sendByModel handleAitopLlmSend', /handleAitopLlmSend\(modelId/.test(chatSrc));
ok('Qwen 联网 UI disabled', /isQwenChatUiModel\(selectedModel\)[\s\S]{0,200}disabled/.test(chatSrc));

const qwenName = chatSrc.match(/QWEN_API_CONFIG[\s\S]*?MODEL_NAME:\s*'([^']+)'/);
ok('QWEN MODEL_NAME', Boolean(qwenName?.[1]?.includes('Qwen')));

const serverSrc = read(SERVER);
const viteSrc = read(VITE);
ok('server /aitop-llm-see', serverSrc.includes("app.post('/aitop-llm-see'"));
ok('vite /aitop-llm-see 代理', viteSrc.includes("'/aitop-llm-see'"));

console.log(`\n=== 契约汇总: ${pass} 通过, ${fail} 失败 ===\n`);
if (fail > 0) process.exit(1);
