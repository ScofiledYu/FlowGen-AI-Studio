/**
 * 汉化 ChatPanel 可见 UI（修复 ? 乱码）
 * Run: node scripts/localize-chatpanel-ui.mjs
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  // 模型图标
  ["{ id: 'gemini-3-pro', name: 'Gemini 3.1 Pro', icon: '??' }", "{ id: 'gemini-3-pro', name: 'Gemini 3.1 Pro', icon: '💎' }"],
  ["{ id: 'claude-4.5', name: 'Claude 4.6', icon: '??' }", "{ id: 'claude-4.5', name: 'Claude 4.6', icon: '🎯' }"],
  ["{ id: 'qwen', name: 'Qwen', icon: '??' }", "{ id: 'qwen', name: 'Qwen', icon: '🤖' }"],
  // 过程卡片子标题
  ["{ label: '????', body: localizedProcess }", "{ label: '搜索过程', body: localizedProcess }"],
  ["{ label: '????', body: webSources, sourcesStyle: true }", "{ label: '检索来源', body: webSources, sourcesStyle: true }"],
  ["sections={[{ label: '????', body: thinkingBody }]}", "sections={[{ label: '思考过程', body: thinkingBody }]}"],
  // 顶栏
  ['title="??????"', 'title="打开聊天历史"'],
  ['<span className="text-xs font-medium truncate">????</span>', '<span className="text-xs font-medium truncate">聊天历史</span>'],
  [
    'onClick={() => setShowModelSelector(!showModelSelector)}\n            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border border-gray-700/60 hover:border-brand-500/40 text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px]"\n            title="????"',
    'onClick={() => setShowModelSelector(!showModelSelector)}\n            className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gradient-to-br from-gray-800/90 to-gray-900/90 hover:from-gray-750/90 hover:to-gray-800/90 border border-gray-700/60 hover:border-brand-500/40 text-white text-xs font-semibold transition-all duration-300 shadow-lg hover:shadow-brand-500/20 backdrop-blur-md group w-[150px]"\n            title="选择模型"',
  ],
  // 历史抽屉
  ['<div className="text-sm font-semibold text-gray-100">????</div>', '<div className="text-sm font-semibold text-gray-100">聊天历史</div>'],
  [
    'className="p-2 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white transition-colors"\n            title="????"',
    'className="p-2 rounded-lg hover:bg-gray-800/50 text-gray-400 hover:text-white transition-colors"\n                title="关闭"',
  ],
  ['title="??????"\n                >\n                  ??', 'title="清空当前对话并重新开始"\n                >\n                  新对话'],
  [
    "title={selectedModel === 'qwen' ? '???? Qwen ??' : '??????'}",
    "title={selectedModel === 'qwen' ? '加载本地保留的 Qwen 会话历史' : '加载当前会话历史'}",
  ],
  ["{historyLoading ? '????' : '??'}", "{historyLoading ? '加载中…' : '加载当前'}"],
  ['???????????????????', '暂无历史。先发送一次消息即可生成并保存会话。'],
  ['title="??????????????"', 'title="加载该会话历史并继续聊天（右键可导出备份）"'],
  ['title="????"', 'title="删除该会话"'],
  ["s.title : '?????'}", "s.title : '未命名会话'}"],
  // 节点区
  ['??????{selectedNodes.length', '当前选中节点{selectedNodes.length'],
  [
    'title={selectedNodes.length > 0 ? `?? ${selectedNodes.length} ??????` : \'???????\'}',
    'title={selectedNodes.length > 0 ? `引用 ${selectedNodes.length} 个节点信息到对话` : "引用节点信息到对话"}',
  ],
  ['<span>????{selectedNodes.length', '<span>引用节点{selectedNodes.length'],
  ['<span>?? {nodesToDisplay.length} ???</span>', '<span>已选择 {nodesToDisplay.length} 个节点</span>'],
  [
    '? {previewImages.length} ??????? {nodesToDisplay.length} ????',
    '共 {previewImages.length} 张预览图，共 {nodesToDisplay.length} 个节点',
  ],
  // 空状态 / 加载
  ['???AI??...', '开始与AI对话...'],
  ['title="????"\n                >\n                  ??????', 'title="显示更早的消息（历史内容不丢失）"\n                >\n                  显示更早消息'],
  ['<span className="text-sm font-medium">??????...</span>', '<span className="text-sm font-medium">正在生成回复...</span>'],
  // 右键菜单
  ["handleSendPresetToModel('???????', DIRECTOR_STORYBOARD_CORE_MD)", "handleSendPresetToModel('核心版分镜技能', DIRECTOR_STORYBOARD_CORE_MD)"],
  ["handleSendPresetToModel('???????', DIRECTOR_STORYBOARD_ADVANCED_MD)", "handleSendPresetToModel('进阶版分镜技能', DIRECTOR_STORYBOARD_ADVANCED_MD)"],
  ['title="?? director-storyboard-core.md ???????"', 'title="发送 director-storyboard-core.md 内容到当前模型"'],
  ['<span>????</span>\n              </button>\n              <button\n                onClick={() => handleSendPresetToModel(\'进阶版分镜技能\'', '<span>发送分镜核心版</span>\n              </button>\n              <button\n                onClick={() => handleSendPresetToModel(\'进阶版分镜技能\''],
  ['title="?? director-storyboard-advanced.md ???????"', 'title="发送 director-storyboard-advanced.md 内容到当前模型"'],
  ['<span>????</span>\n              </button>\n              {selectedText.trim().length > 0', '<span>发送分镜进阶版</span>\n              </button>\n              {selectedText.trim().length > 0'],
  ['title="?? .csv??? Excel / WPS ?????? CSV?UTF-8"', 'title="下载 .csv 文件：用 Excel 打开时选择「数据 → 自文本/CSV」或直接双击用 Excel 打开（UTF-8）"'],
  ['<span>?? CSV?Excel ???</span>', '<span>导出为 CSV（Excel 可用）</span>'],
  ['title="?? .xlsx?Microsoft Excel / WPS ?????"', 'title="下载标准 .xlsx 文件，直接用 Microsoft Excel / WPS 双击打开即可"'],
  ['<span>?? Excel?.xlsx?</span>', '<span>导出为 Excel（.xlsx）</span>'],
  ['title="??????????"', 'title="在下方对话中插入一条带表格的消息（不调用模型）"'],
  ['<span>??????</span>\n                  </button>\n                </>\n              )}\n              {selectedNodes.length > 0', '<span>在对话中显示为表格</span>\n                  </button>\n                </>\n              )}\n              {selectedNodes.length > 0'],
  ['title={`??? ${selectedNodes.length} ?????????`}', 'title={`发送到 ${selectedNodes.length} 个节点的创意描述`}'],
  ['<span>?????</span>\n                    <span className="ml-auto text-xs text-gray-400 group-hover:text-gray-300">({selectedNodes.length})</span>\n                  </button>\n                  <button\n                    onClick={handleSendSelectedTextToNegativePrompt}', '<span>发送到节点创意描述</span>\n                    <span className="ml-auto text-xs text-gray-400 group-hover:text-gray-300">({selectedNodes.length})</span>\n                  </button>\n                  <button\n                    onClick={handleSendSelectedTextToNegativePrompt}'],
  ['<span>????????</span>', '<span>发送到节点不希望呈现内容</span>'],
  ['???????Ctrl+C ????????????', '框选对话内容后可 Ctrl+C 复制到 Excel；右键可导出 CSV / Excel；发送到节点需先选中画布节点'],
  // 会话导出菜单
  ['title="????"\n              >\n                ???????JSON?', 'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）'],
  ['title="??????????"\n              >\n                ??????', 'title="复制可直接粘贴到新对话的恢复文本"\n              >\n                复制恢复文本'],
  // 输入区
  ['<span className="flex-1">??????????</span>', '<span className="flex-1">正在引用图片进行对话</span>'],
  ['title="????"\n              >\n                <X size={12} strokeWidth={2.5} />\n              <span>????</span>', 'title="中止引用图片对话"\n              >\n                <X size={12} strokeWidth={2.5} />\n                <span>中止引用</span>'],
  ['<span>???? ({attachedImages.length})</span>', '<span>附加图片 ({attachedImages.length})</span>'],
  ['title="??????"', 'title="移除所有图片"'],
  ['alt={`?? ${index + 1}`}', 'alt={`附加图片 ${index + 1}`}'],
  ['title="??"\n                  >\n                    <X size={10}', 'title="移除这张图片"\n                  >\n                    <X size={10}'],
  ['<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-brand-500/80 text-white text-[8px] font-semibold rounded">\n                      ??\n                    </div>', '<div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-brand-500/80 text-white text-[8px] font-semibold rounded">\n                      引用中\n                    </div>'],
  ['title={selectedModel === \'qwen\' ? \'Qwen ???????\' : \'?????Gemini / Claude ???\'}', "title={selectedModel === 'qwen' ? 'Qwen 暂不支持联网搜索' : '是否允许模型联网检索（仅 Gemini / Claude 生效）'}"],
  ['<span>??</span>\n              {useWebSearch', '<span>联网搜索</span>\n              {useWebSearch'],
  [
    "selectedModel === 'qwen'\n                  ? 'Qwen ???????'\n                  : '???? ? ? ? ???????'",
    "selectedModel === 'qwen'\n                  ? 'Qwen 暂不支持深度思考'\n                  : '思考：关 → 浅 → 深（循环切换）'",
  ],
  ["thinkingMode === 'deep' ? '????' : thinkingMode === 'light' ? '???' : '??'", "thinkingMode === 'deep' ? '深度思考' : thinkingMode === 'light' ? '浅思考' : '思考'"],
  ['placeholder="??????Enter ???Shift+Enter ???"', 'placeholder="输入问题，Enter 发送，Shift+Enter 换行"'],
  ['title="??"\n          >\n              {isLoading ?', 'title="发送消息"\n          >\n              {isLoading ?'],
  // 节点类型
  [`const getNodeTypeName = (type: string): string => {
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
      return '??';
    default:
      return '??';
  }
};`, `const getNodeTypeName = (type: string): string => {
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
};`],
  // 角色标签
  ["`${t.role === 'user' ? '??' : '??'}?${t.content}`", "`${t.role === 'user' ? '用户' : '助手'}：${t.content}`"],
  ["const label = t.role === 'user' ? '??' : '??';", "const label = t.role === 'user' ? '用户' : '助手';"],
  [".map((m) => `${m.role === 'user' ? '??' : '??'}??{m.content}`)", ".map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)"],
];

let n = 0;
const missed = [];
for (const [from, to] of pairs) {
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  } else {
    missed.push(from.slice(0, 60));
  }
}

fs.writeFileSync(path, t, 'utf8');
console.log('applied', n, 'of', pairs.length, 'replacements');
if (missed.length) console.log('missed', missed.length, ':\n', missed.slice(0, 8).join('\n'));
