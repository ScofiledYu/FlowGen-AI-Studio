/**
 * 修复对话区用户可见中文（欢迎语、加载提示、切换模型等）
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  [
    "'?????AI???????????????????\\n\\n?? ?????????????????????????????????'",
    "'您好！我是AI对话助手，可以帮您解答问题、分析内容。\\n\\n💡 提示：您可以点击「引用节点」按钮来引用当前选中的节点信息进行分析。'",
  ],
  ['content: `????????????????`', 'content: `✅ 已加载历史，会话可继续对话。`'],
  [
    'content: `?? ${failedLabel} ?????????? ${fallbackLabel} ?????`',
    'content: `⚠️ ${failedLabel} 请求失败，正在自动切换到 ${fallbackLabel} 重试…`',
  ],
  [
    'content: `?? ${failedLabel} ???????????? ${fallbackLabel} ???`',
    'content: `⚠️ ${failedLabel} 本轮请求失败，已自动切换到 ${fallbackLabel} 继续回答（聊天历史保留）。`',
  ],
  [
    'content: `?? ???? ${modelLabelById(fromModel)} ??? ${modelLabelById(toModel)}\\n\\n${switchHint}`',
    'content: `🔄 已切换模型：${modelLabelById(fromModel)} → ${modelLabelById(toModel)}\\n\\n${switchHint}`',
  ],
  [
    '<div className="text-xs text-gray-600 font-medium">Start a conversation to get intelligent insights</div>',
    '<div className="text-xs text-gray-600 font-medium">开始对话，获取智能分析与建议</div>',
  ],
  ["return turns.map((t) => `${t.role === 'user' ? '??' : '??'}?${t.content}`)", "return turns.map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`)"],
  ["const label = t.role === 'user' ? '??' : '??';", "const label = t.role === 'user' ? '用户' : '助手';"],
  [".map((m) => `${m.role === 'user' ? '??' : '??'}?${m.content}`)", ".map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)"],
  ["title: session.title?.trim() || '?????'", "title: session.title?.trim() || '未命名会话'"],
  [
    "'**????** AITop100?AiTop??????aitop100-api.hytch.com????????????????'",
    "'**服务方：** AITop100（AiTop）聚合接口（aitop100-api.hytch.com）。以下为接口或网关返回的信息。'",
  ],
  ['return `**? Qwen**`', 'return `**❌ Qwen**`'],
  ['return `**? ${modelLabel}**`', 'return `**❌ ${modelLabel}**`'],
  ['**??ID?**', '**对话ID：**'],
  ['**??ID?**', '**请求ID：**'],
  [
    '`?? ?? ${index + 1}??{node.data.label}\\n`',
    '`📌 节点 ${index + 1}：${displayLabel}\\n`',
  ],
  [
    '`- ??????{getNodeTypeName(node.type)}\\n`',
    '`- 节点类型：${getNodeTypeName(node.type)}\\n`',
  ],
  ['`- ????${node.data.prompt}\\n`', '`- 提示词：${node.data.prompt}\\n`'],
  [
    '`- ??????{node.data.selectedModel}\\n`',
    '`- 使用模型：${node.data.selectedModel}\\n`',
  ],
  ['`- ??????`', '`- 包含图片预览`'],
  [
    '`?? ?? ${nodesToReference.length} ??????\\n\\n${nodeInfos.join',
    '`📌 引用 ${nodesToReference.length} 个节点信息：\\n\\n${nodeInfos.join',
  ],
  [
    'content: `? ??? ${nodesToReference.length} ????${nodeNames}?????????????????????????????????????`',
    'content: `✅ 已引用 ${nodesToReference.length} 个节点（${nodeNames}）的信息。我可以帮您分析这些节点的内容，请告诉我您想了解什么？`',
  ],
  [".join('?')", ".join('、')"],
];

let n = 0;
for (const [from, to] of pairs) {
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  }
}

// switchHint if corrupted
if (t.includes('switchHint') && t.includes('????')) {
  t = t.replace(
    /const switchHint = '[^']*';/,
    "const switchHint = '💡 当前对话历史已保留，可以继续对话。';"
  );
  n++;
}

fs.writeFileSync(path, t, 'utf8');
console.log('fixed', n, 'patterns');
