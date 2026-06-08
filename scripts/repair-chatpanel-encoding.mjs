/**
 * Restore ChatPanel.tsx Chinese text from 20260515 reference + dist-known strings.
 * Run: node scripts/repair-chatpanel-encoding.mjs
 */
import fs from 'fs';

const TARGET = 'components/ChatPanel.tsx';
const REF = 'd:/aaa/20260515/flowgen-ai-studio/components/ChatPanel.tsx';

const MANUAL = [
  [
    /\/\/ Qwen\?+API\?+ test2\.py \/ test\.py \?+const QWEN_API_CONFIG/,
    `// Qwen 内网 API 配置（对齐 test2.py / test.py）
const QWEN_API_CONFIG`,
  ],
  [/\/\*\* \?+test2\.py \?+ \/fangte\/v1\/chat\/completions \*\//, '/** 文本：test2.py 走 /fangte/v1/chat/completions */'],
  [/\/\*\* \?+test\.py \?+ \/v1\/chat\/completions \*\//, '/** 视觉：test.py 走 /v1/chat/completions */'],
  [
    /\/\*\* \?+\*\/\s*\n\s*MAX_TOKENS_CHAT: 8192/,
    `/** 实际请求上限（避免切换模型后携带长历史时生成过慢导致超时） */
  MAX_TOKENS_CHAT: 8192`,
  ],
  [/\/\/ Gemini\?+API\?\?/, '// Gemini（AITop）API 配置'],
  [/\/\/ Claude\?+API\?\?/, '// Claude（AITop）API 配置'],
  [/\/\/ \?+\?/, '// 代理配置'],
  [/\/\/ \?+userID/, '// 厂商提供的 userID'],
  [
    /const AITOP100_SERVICE_LINE =\s*\n\s*'\*\*\?+\*\* AITop100\?AiTop\?+aitop100-api\.hytch\.com\?+;/,
    `const AITOP100_SERVICE_LINE =
  '**服务方：** AITop100（AiTop）聚合接口（aitop100-api.hytch.com）。以下为接口或网关返回的信息。';`,
  ],
  [/return `\*\*\?\?/g, 'return `**❌ '],
];

function skeleton(line) {
  return line
    .replace(/[\u4e00-\u9fff？]+/g, '#')
    .replace(/\?+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairFromRef(bad, refLines) {
  const refMap = new Map();
  for (const line of refLines) {
    const sk = skeleton(line);
    if (sk && sk.includes('#')) refMap.set(sk, line);
  }
  const out = [];
  for (const line of bad.split('\n')) {
    if (!line.includes('?')) {
      out.push(line);
      continue;
    }
    const sk = skeleton(line);
    const hit = refMap.get(sk);
    if (hit) {
      out.push(hit);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

let text = fs.readFileSync(TARGET, 'utf8');
const refLines = fs.readFileSync(REF, 'utf8').split('\n');
text = repairFromRef(text, refLines);
for (const [re, rep] of MANUAL) {
  text = text.replace(re, rep);
}

// Fix merged comment lines (imageUrl + imageUrls on one line)
text = text.replace(
  /imageUrl\?: string; \/\/ #+  imageUrls\?: string\[\]; \/\/ #+/,
  `imageUrl?: string; // 保留用于向后兼容，显示第一张图片
  imageUrls?: string[]; // 支持多张图片`
);

fs.writeFileSync(TARGET, text, 'utf8');
console.log('repaired', TARGET);
