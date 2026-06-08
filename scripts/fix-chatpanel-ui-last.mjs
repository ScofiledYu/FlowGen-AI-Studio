import fs from 'fs';
const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');
const pairs = [
  ['<div className="text-xs text-gray-500 p-2">??????????????????????</div>', '<div className="text-xs text-gray-500 p-2">暂无历史。先发送一次消息即可生成并保存会话。</div>'],
  ['title="?????????????????????"', 'title="加载该会话历史并继续聊天（右键可导出备份）"'],
  ['title="???????????????????????"', 'title="在下方对话中插入一条带表格的消息（不调用模型）"'],
  ['<span>?????????</span>\n                    <span className="ml-auto', '<span>发送到节点创意描述</span>\n                    <span className="ml-auto'],
  ['title="?????"\n              >\n                ???????JSON?', 'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）'],
  ['title={`??? ${selectedNodes.length} ????????`}', 'title={`发送到 ${selectedNodes.length} 个节点的创意描述`}'],
  ['title={`??? ${selectedNodes.length} ???????????`}', 'title={`发送到 ${selectedNodes.length} 个节点的不希望呈现内容`}'],
  ['<span>????????????</span>', '<span>发送到节点不希望呈现内容</span>'],
  ['<span>???????? Ctrl+C ??? Excel?????? CSV / Excel??????????????</span>', '<span>框选对话内容后可 Ctrl+C 复制到 Excel；右键可导出 CSV / Excel；发送到节点需先选中画布节点</span>'],
  ['title="?????"\n              >\n                ???????JSON?', 'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）'],
  ['title="???????????????????????"\n              >\n                ??????', 'title="复制可直接粘贴到新对话的恢复文本"\n              >\n                复制恢复文本'],
  ['title="????????"\n              >\n                <X size={12} strokeWidth={2.5} />\n                <span>????</span>', 'title="中止引用图片对话"\n              >\n                <X size={12} strokeWidth={2.5} />\n                <span>中止引用</span>'],
  [
    'onClick={removeAllAttachedImages}\n                className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-red-500/20 transition-all"\n                title="打开聊天历史"',
    'onClick={removeAllAttachedImages}\n                className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-red-500/20 transition-all"\n                title="移除所有图片"',
  ],
  [
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="打开聊天历史"',
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="移除这张图片"',
  ],
  ["{expanded ? '??' : '??'}", "{expanded ? '收起' : '展开'}"],
  [
    '<ThinkingProcessCard\n          title={ASSISTANT_MARKER_THINKING}',
    '<AssistantProcessCard\n          title={ASSISTANT_MARKER_THINKING}',
  ],
  [
    'sectionLabel="思考过程"\n          body={thinkingBody}',
    'sectionLabel="思考过程"\n          body={thinkingBody}',
  ],
  ["sections={[{ label: '????', body: thinkingBody }]}", "sections={[{ label: '思考过程', body: thinkingBody }]}"],
  ["|| '??????'", "|| '联网检索中…'"],
  ["|| '????'", "|| '思考中…'"],
  [
    "if (e instanceof Error && e.message.includes('????')) {\n              throw e;\n            }",
    "if (isAitopFormattedStreamError(e)) {\n              throw e;\n            }",
  ],
  [
    `m.includes('**?') ||\n    /\\\\*\\\\*???\\\\*\\\\*/.test(m) ||\n    /\\\\*\\\\*??ID?\\\\*\\\\*/.test(m)`,
    "m.includes('\\u274c') ||\n    m.includes('\\u5bf9\\u8bddID\\uFF1A') ||\n    m.includes('\\u95ee\\u9898\\uFF1A')",
  ],
  [
    'title="?????"\n                >\n                  ?????? ({firstVisibleMessageIndex})',
    'title="显示更早的消息（历史内容不丢失）"\n                >\n                  显示更早消息 ({firstVisibleMessageIndex})',
  ],
  [
    'title="删除该会话"\n                >\n                  ?????? ({firstVisibleMessageIndex})',
    'title="显示更早的消息（历史内容不丢失）"\n                >\n                  显示更早消息 ({firstVisibleMessageIndex})',
  ],
  ['<div className="text-xs text-gray-600 font-medium">??????????????</div>', '<div className="text-xs text-gray-600 font-medium">在下方输入消息，支持联网搜索与深度思考</div>'],
  ['sectionLabel="????"', 'sectionLabel="思考过程"'],
  ["|| '????'", "|| '思考中…'"],
  [
    'title="????????????????????"\n              >\n                ???????JSON?',
    'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）',
  ],
  [
    'title="????????????????"\n              >\n                ??????',
    'title="复制可直接粘贴到新对话的恢复文本"\n              >\n                复制恢复文本',
  ],
];
let n = 0;
for (const [a, b] of pairs) {
  if (t.includes(a)) { t = t.split(a).join(b); n++; }
}
fs.writeFileSync(path, t);
console.log('fixed', n);
