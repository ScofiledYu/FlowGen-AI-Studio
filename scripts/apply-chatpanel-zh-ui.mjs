/**
 * 一次性汉化 ChatPanel 可见 UI（4490–5130 区域为主）
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  ["{ id: 'gemini-3-pro', name: 'Gemini 3.1 Pro', icon: '??' }", "{ id: 'gemini-3-pro', name: 'Gemini 3.1 Pro', icon: '💎' }"],
  ["{ id: 'claude-4.5', name: 'Claude 4.6', icon: '??' }", "{ id: 'claude-4.5', name: 'Claude 4.6', icon: '🎯' }"],
  ["{ id: 'qwen', name: 'Qwen', icon: '??' }", "{ id: 'qwen', name: 'Qwen', icon: '🤖' }"],
  ["{ label: '????', body: localizedProcess }", "{ label: '搜索过程', body: localizedProcess }"],
  ["{ label: '????', body: webSources, sourcesStyle: true }", "{ label: '检索来源', body: webSources, sourcesStyle: true }"],
  ["sections={[{ label: '????', body: thinkingBody }]}", "sections={[{ label: '思考过程', body: thinkingBody }]}"],
  ['title="??????"\n          className={`flex items-center justify-between px-3 py-1.5', 'title="打开聊天历史"\n          className={`flex items-center justify-between px-3 py-1.5'],
  ['<span className="text-xs font-medium truncate">????</span>', '<span className="text-xs font-medium truncate">聊天历史</span>'],
  [
    'onClick={() => setShowModelSelector(!showModelSelector)}\n            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border border-gray-700/60 hover:border-brand-500/40 text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px]"\n            title="????"',
    'onClick={() => setShowModelSelector(!showModelSelector)}\n            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border border-gray-700/60 hover:border-brand-500/40 text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px]"\n            title="选择模型"',
  ],
];

// getNodeTypeName block
const nodeBlockFrom = `const getNodeTypeName = (type: string): string => {
  switch (type) {
    case NodeType.INPUT:
      return '??';
    case NodeType.PROCESSOR:
      return '??';
    case NodeType.OUTPUT:
      return '??';
    case NodeType.MOV:
      return '??';
    case NodeType.CHAIN_FOLDER:
      return '????';
    default:
      return '??';
  }
};`;

const nodeBlockTo = `const getNodeTypeName = (type: string): string => {
  switch (type) {
    case NodeType.INPUT:
      return '输入';
    case NodeType.PROCESSOR:
      return '处理';
    case NodeType.OUTPUT:
      return '输出';
    case NodeType.MOV:
      return '视频';
    case NodeType.CHAIN_FOLDER:
      return '链路折叠';
    default:
      return '节点';
  }
};`;

if (t.includes(nodeBlockFrom)) {
  t = t.replace(nodeBlockFrom, nodeBlockTo);
  pairs.push(['__node__', '__done__']);
}

// 从备份读取 JSX 片段（2967–3577）替换当前 return 内 UI 尾部 — 用标记切片更安全
const backupPath = 'd:/aaa/20260515/flowgen-ai-studio/components/ChatPanel.tsx';
const backup = fs.readFileSync(backupPath, 'utf8');

function extractBetween(src, startMark, endMark) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error(`mark not found: ${startMark}`);
  return src.slice(a, b);
}

// 备份：头部到历史抽屉结束
const backupHeader = extractBetween(
  backup,
  '      {/* 头部 - 优化布局 */}',
  '      {/* 节点信息卡片 - 引用节点按钮始终可见 */}'
);

// 当前文件中对应区间
const curStart = t.indexOf('      <div className="relative h-[56px] border-b');
const curEnd = t.indexOf('      {(selectedNode || selectedNodes.length > 0) && (');
if (curStart < 0 || curEnd < 0) throw new Error('current header markers not found');

// 备份头部使用 deepThinking，当前用 thinkingMode — 只替换纯文案块，不整段替换
// 改为：备份中仅提取已知中文片段映射到 ? 串

const zhFromBackup = [
  ['title="??????"', 'title="打开聊天历史"'],
  ['<span className="text-xs font-medium truncate">????</span>', '<span className="text-xs font-medium truncate">聊天历史</span>'],
  ['<div className="text-sm font-semibold text-gray-100">????</div>', '<div className="text-sm font-semibold text-gray-100">聊天历史</div>'],
  ['title="??"', 'title="关闭"'],
  ['title="???????????"', 'title="清空当前对话并重新开始"'],
  ['>\n                  ???\n                </button>', '>\n                  新对话\n                </button>'],
  [
    "title={selectedModel === 'qwen' ? '??????? Qwen ????' : '????????'}",
    "title={selectedModel === 'qwen' ? '加载本地保留的 Qwen 会话历史' : '加载当前会话历史'}",
  ],
  ["{historyLoading ? '????' : '????'}", "{historyLoading ? '加载中…' : '加载当前'}"],
  ['暂无历史。先发送一次消息即可生成并保存会话。</div>', '暂无历史。先发送一次消息即可生成并保存会话。</div>'],
  ['title="加载该会话历史并继续聊天（右键可导出备份）"', 'title="加载该会话历史并继续聊天（右键可导出备份）"'],
  [
    'onClick={() => void deleteStoredSession(s.id)}\n                        title="?????"',
    'onClick={() => void deleteStoredSession(s.id)}\n                        title="删除该会话"',
  ],
  ["s.title : '?????'}", "s.title : '未命名会话'}"],
  ['??????{selectedNodes.length', '当前选中节点{selectedNodes.length'],
  [
    'title={selectedNodes.length > 0 ? `?? ${selectedNodes.length} ????????` : "?????????"}',
    'title={selectedNodes.length > 0 ? `引用 ${selectedNodes.length} 个节点信息到对话` : "引用节点信息到对话"}',
  ],
  ['<span>????{selectedNodes.length', '<span>引用节点{selectedNodes.length'],
  ['<span>??? {nodesToDisplay.length} ???</span>', '<span>已选择 {nodesToDisplay.length} 个节点</span>'],
  ['`${nodesToDisplay.length} ???`', '`${nodesToDisplay.length} 个节点`'],
  ['???AI??...', '开始与AI对话...'],
  [
    'title="?????"\n                >\n                  ?????? ({firstVisibleMessageIndex})',
    'title="显示更早的消息（历史内容不丢失）"\n                >\n                  显示更早消息 ({firstVisibleMessageIndex})',
  ],
  ['<span className="text-sm font-medium">??????...</span>', '<span className="text-sm font-medium">正在生成回复...</span>'],
  ["handleSendPresetToModel('???????', DIRECTOR_STORYBOARD_CORE_MD)", "handleSendPresetToModel('核心版分镜技能', DIRECTOR_STORYBOARD_CORE_MD)"],
  ["handleSendPresetToModel('???????', DIRECTOR_STORYBOARD_ADVANCED_MD)", "handleSendPresetToModel('进阶版分镜技能', DIRECTOR_STORYBOARD_ADVANCED_MD)"],
  ['title="?? director-storyboard-core.md ???????"', 'title="发送 director-storyboard-core.md 内容到当前模型"'],
  ['<span>???????</span>\n              </button>\n              <button\n                onClick={() => handleSendPresetToModel(\'进阶版分镜技能\'', '<span>发送分镜核心版</span>\n              </button>\n              <button\n                onClick={() => handleSendPresetToModel(\'进阶版分镜技能\''],
  ['title="?? director-storyboard-advanced.md ???????"', 'title="发送 director-storyboard-advanced.md 内容到当前模型"'],
  ['<span>???????</span>\n              </button>\n              {selectedText.trim().length > 0', '<span>发送分镜进阶版</span>\n              </button>\n              {selectedText.trim().length > 0'],
  [
    'title="?? .csv ???? Excel ???????? ? ???/CSV??????? Excel ???UTF-8?"',
    'title="下载 .csv 文件：用 Excel 打开时选择「数据 → 自文本/CSV」或直接双击用 Excel 打开（UTF-8）"',
  ],
  ['<span>??? CSV?Excel ???</span>', '<span>导出为 CSV（Excel 可用）</span>'],
  [
    'title="???? .xlsx ?????? Microsoft Excel / WPS ??????"',
    'title="下载标准 .xlsx 文件，直接用 Microsoft Excel / WPS 双击打开即可"',
  ],
  ['<span>??? Excel?.xlsx?</span>', '<span>导出为 Excel（.xlsx）</span>'],
  ['title="??????????????????????????"', 'title="在下方对话中插入一条带表格的消息（不调用模型）"'],
  ['<span>?????????</span>', '<span>在对话中显示为表格</span>'],
  ['title={`??? ${selectedNodes.length} ????????`}', 'title={`发送到 ${selectedNodes.length} 个节点的创意描述`}'],
  ['<span>?????????</span>\n                    <span className="ml-auto', '<span>发送到节点创意描述</span>\n                    <span className="ml-auto'],
  ['<span>????????????</span>', '<span>发送到节点不希望呈现内容</span>'],
  [
    '<span>???????? Ctrl+C ??? Excel?????? CSV / Excel??????????????</span>',
    '<span>框选对话内容后可 Ctrl+C 复制到 Excel；右键可导出 CSV / Excel；发送到节点需先选中画布节点</span>',
  ],
  [
    'title="?????"\n              >\n                ???????JSON?',
    'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）',
  ],
  [
    'title="??????????????????????????"\n              >\n                ??????',
    'title="复制可直接粘贴到新对话的恢复文本"\n              >\n                复制恢复文本',
  ],
  ['<span className="flex-1">??????????</span>', '<span className="flex-1">正在引用图片进行对话</span>'],
  [
    'title="?????"\n              >\n                <X size={12} strokeWidth={2.5} />\n              <span>????</span>',
    'title="中止引用图片对话"\n              >\n                <X size={12} strokeWidth={2.5} />\n                <span>中止引用</span>',
  ],
  ['<span>???? ({attachedImages.length})</span>', '<span>附加图片 ({attachedImages.length})</span>'],
  ['title="??????"', 'title="移除所有图片"'],
  ['alt={`???? ${index + 1}`}', 'alt={`附加图片 ${index + 1}`}'],
  [
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="??????"',
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="移除这张图片"',
  ],
  [
    '<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-brand-500/80 text-white text-[8px] font-semibold rounded">\n                      ???\n                    </div>',
    '<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-brand-500/80 text-white text-[8px] font-semibold rounded">\n                      引用中\n                    </div>',
  ],
  [
    "title={selectedModel === 'qwen' ? 'Qwen ????????' : '???????????? Gemini / Claude ???'}",
    "title={selectedModel === 'qwen' ? 'Qwen 暂不支持联网搜索' : '是否允许模型联网检索（仅 Gemini / Claude 生效）'}",
  ],
  ['<span>????</span>\n              {useWebSearch', '<span>联网搜索</span>\n              {useWebSearch'],
  [
    "selectedModel === 'qwen'\n                  ? 'Qwen ????????'\n                  : '???? ? ? ? ???????'",
    "selectedModel === 'qwen'\n                  ? 'Qwen 暂不支持深度思考'\n                  : '思考：关 → 浅 → 深（循环切换）'",
  ],
  ["thinkingMode === 'deep' ? '????' : thinkingMode === 'light' ? '???' : '??'", "thinkingMode === 'deep' ? '深度思考' : thinkingMode === 'light' ? '浅思考' : '思考'"],
  ['placeholder="?????Enter ???Shift+Enter ??"', 'placeholder="输入消息… Enter 发送，Shift+Enter 换行"'],
  ['placeholder="????? Enter ???Shift+Enter ??"', 'placeholder="输入消息… Enter 发送，Shift+Enter 换行"'],
  [
    'disabled={(input.trim() === \'\' && !referencedImage && attachedImages.length === 0) || isLoading}\n            title="????"',
    'disabled={(input.trim() === \'\' && !referencedImage && attachedImages.length === 0) || isLoading}\n            title="发送消息"',
  ],
];

const all = [...pairs, ...zhFromBackup];
let n = 0;
for (const [from, to] of all) {
  if (from === '__node__') continue;
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  }
}

// 负向提示词 title 第二处（与创意描述相同模板）
t = t.replace(
  /onClick={handleSendSelectedTextToNegativePrompt}[\s\S]*?title={`发送到 \$\{selectedNodes\.length\} 个节点的创意描述`}/,
  (m) => m.replace('个节点的创意描述', '个节点的不希望呈现内容')
);

fs.writeFileSync(path, t, 'utf8');
console.log('applied', n, 'replacements; backup ref', backupHeader.length, 'chars unused');
