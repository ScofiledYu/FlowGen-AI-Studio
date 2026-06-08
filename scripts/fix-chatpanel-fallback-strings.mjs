/**
 * 修复模型失败/切换/错误格式化等用户可见中文（避免 prebuild 模式不一致漏修）
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  [
    /const AITOP_BASE_TIP_ZH =\s*\n\s*'[^']*';/,
    "const AITOP_BASE_TIP_ZH =\n  '请使用简体中文（中国大陆）回复，不要使用繁体中文。涉及行程、日程、列表、步骤时须写完整条目，勿用「…」或「...」省略未展开的内容。';",
  ],
  [
    /const AITOP_PROCESS_EXTRA_TIP_ZH =[\s\S]*?';/,
    "const AITOP_PROCESS_EXTRA_TIP_ZH =\n  '过程说明请用中文；可保留 Search results for / I\\'ll search for 等检索原文于过程区，正文写面向用户的完整回答。';",
  ],
  [
    /const AITOP_THINKING_ZH_TIP =\s*\n\s*'[^']*';/,
    "const AITOP_THINKING_ZH_TIP =\n  '若启用思考，思考过程必须全程使用简体中文（含小标题与每一段说明），禁止使用英文。';",
  ],
  ['return `**? ${modelLabel}**`', 'return `**❌ ${modelLabel}**`'],
  ['return `**? Qwen**`', 'return `**❌ Qwen**`'],
  [
    '**服务方：** AITop100（AiTop）聚合接口（aitop100-api.hytch.com）。以下为接口或网关返回的信息。',
    '**服务方：** AITop100（AiTop）聚合接口（aitop100-api.hytch.com）。以下为接口或网关返回的信息。',
  ],
  [
    "content: `?? ${failedLabel} ???????????? ${fallbackLabel} ???`",
    "content: `⚠️ ${failedLabel} 本轮请求失败，已自动切换到 ${fallbackLabel} 继续回答（聊天历史保留）。`",
  ],
  [
    "content: `?? ${failedLabel} ?????????? ${fallbackLabel} ?????`",
    "content: `⚠️ ${failedLabel} 请求失败，正在自动切换到 ${fallbackLabel} 重试…`",
  ],
  [
    "content: `?? ??????${modelLabelById(fromModel)} ? ${modelLabelById(toModel)}\\n\\n${switchHint}`",
    "content: `🔄 已切换模型：${modelLabelById(fromModel)} → ${modelLabelById(toModel)}\\n\\n${switchHint}`",
  ],
  [
    ': `**? ${primaryLabel} ??**\\n\\n${String(primaryError)}`',
    ': `**❌ ${primaryLabel} 失败**\\n\\n${String(primaryError)}`',
  ],
  [
    '? `**? ${fallbackLabel} ??**\\n\\n${fallbackError.message}`',
    '? `**❌ ${fallbackLabel} 失败**\\n\\n${fallbackError.message}`',
  ],
  [
    ': `**? ${fallbackLabel} ??**\\n\\n${String(fallbackError)}`',
    ': `**❌ ${fallbackLabel} 失败**\\n\\n${String(fallbackError)}`',
  ],
  [
    "content: `? ??????????????`",
    "content: `✅ 已加载历史，会话可继续对话。`",
  ],
  [
    'proxyHint:\n      \'????????????/api/fangte ? /api/v1????????????? [chat][Qwen][debug][json] ?????????\'',
    "proxyHint:\n      'Qwen 走本地代理：文本 /api/fangte，多模态 /api/v1；详情见控制台 [chat][Qwen][debug][json]'",
  ],
  [
    "note: '???????????? Qwen ???? Claude/Gemini ?? webSearch'",
    "note: 'Qwen 路径不含 Claude/Gemini 的 webSearch/thinking 参数'",
  ],
];

let n = 0;
for (const [from, to] of pairs) {
  if (from === to) continue;
  if (from instanceof RegExp) {
    if (from.test(t)) {
      t = t.replace(from, to);
      n++;
    }
    continue;
  }
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  }
}

// appendErrorIds
t = t.replace(
  /if \(ids\.chatId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.chatId\}\`\);/,
  "if (ids.chatId && !/\\*\\*对话ID\\*\\*/i.test(out)) lines.push(`**对话ID：** ${ids.chatId}`);"
);
t = t.replace(
  /if \(ids\.requestId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.requestId\}\`\);/,
  "if (ids.requestId && !/\\*\\*请求ID\\*\\*/i.test(out)) lines.push(`**请求ID：** ${ids.requestId}`);"
);
t = t.replace(
  /if \(ids\.taskId && !\/\\\*\*Task ID\\\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.taskId\}\`\);/,
  "if (ids.taskId && !/\\*\\*Task ID\\*\\*/i.test(out)) lines.push(`**Task ID：** ${ids.taskId}`);"
);
// remove broken idHint block if present
t = t.replace(
  /\n  const idHint = ids\.requestId[\s\S]*?return `\$\{out\}\\n\\n\$\{lines\.join\('\\n'\)\}\$\{idHint\}`;/,
  "\n  return `${out}\\n\\n${lines.join('\\n')}`;"
);

// formatQwenFailure detail line
t = t.replace(
  /return `\*\*❌ Qwen\*\*\\n\\n\$\{detail\}\\n\\n\*\*[^`]+\*\*[^`]*`;/,
  "return `**❌ Qwen**\\n\\n${detail}\\n\\n**处理建议：** 若持续失败，请联系集团IT协助排查。`;"
);
t = t.replace(
  /return `\*\*\? Qwen\*\*\\n\\n\$\{detail\}\\n\\n\*\*[^`]+\*\*[^`]*`;/,
  "return `**❌ Qwen**\\n\\n${detail}\\n\\n**处理建议：** 若持续失败，请联系集团IT协助排查。`;"
);

// switchHint：仅修复含 ? 的 switchHint 块
if (/const switchHint =[\s\S]{0,400}\?/.test(t)) {
  t = t.replace(
    /const switchHint =[\s\S]*?;\n\n      const switchMessage: ChatMessage/,
    `const switchHint =
        normalizedTarget === 'qwen'
          ? hadThinkingOrWeb
            ? '💡 Qwen 暂不支持联网搜索与深度思考，已关闭相关选项。'
            : '💡 当前对话历史已保留，可以继续对话。'
          : hadThinkingOrWeb
            ? '💡 已切换模型，联网搜索/思考模式设置已保留。'
            : '💡 当前对话历史已保留，可以继续对话。';

      const switchMessage: ChatMessage`
  );
  n++;
}

// 兜底：错误标题（apply 可能再次写回 ?）
t = t.replace(
  /return `\*\*\? \$\{modelLabel\}\*\*\\n\$\{AITOP100_SERVICE_LINE\}/g,
  'return `**❌ ${modelLabel}**\\n${AITOP100_SERVICE_LINE}'
);
if (t.includes('**❌ ${modelLabel}**')) n++;
if (t.includes('return `**? Qwen**`')) {
  t = t.replace(
    /return `\*\*\? Qwen\*\*\\n\\n\$\{detail\}\\n\\n\*\*[^`]+`;/,
    "return `**❌ Qwen**\\n\\n${detail}\\n\\n**处理建议：** 若持续失败，请联系集团IT协助排查。`;"
  );
  n++;
}
t = t.replace(
  /content: `[^`]*\$\{failedLabel\}[^`]*\$\{fallbackLabel\}[^`]*`,\n            timestamp: new Date\(\),\n          \},\n        \]\);/,
  "content: `⚠️ ${failedLabel} 本轮请求失败，已自动切换到 ${fallbackLabel} 继续回答（聊天历史保留）。`,\n            timestamp: new Date(),\n          },\n        ]);"
);
t = t.replace(
  /payload\.thinkingLevel =\s*\n\s*<span>\{thinkingMode[^<]*<\/span>/g,
  "payload.thinkingLevel =\n        !useDegraded && !lightweight && thinkingMode === 'deep' ? 'high' : 'low'"
);

fs.writeFileSync(path, t, 'utf8');
console.log('fix-chatpanel-fallback-strings:', n, 'pairs');
