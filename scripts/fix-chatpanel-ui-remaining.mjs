/**
 * 修复 localize 脚本误伤与剩余 ? 占位
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  ['{/* 暂无历史。先发送一次消息即可生成并保存会话。???????*/}', '{/* 左侧：聊天历史 */}'],
  ['title="??"\n              >\n                <X size={16} />', 'title="关闭"\n              >\n                <X size={16} />'],
  ['title="???????????"\n                >\n                  ???', 'title="清空当前对话并重新开始"\n                >\n                  新对话'],
  [
    "title={selectedModel === 'qwen' ? '??????? Qwen ????' : '????????'}",
    "title={selectedModel === 'qwen' ? '加载本地保留的 Qwen 会话历史' : '加载当前会话历史'}",
  ],
  ["{historyLoading ? '????' : '????'}", "{historyLoading ? '加载中…' : '加载当前'}"],
  ['暂无历史。先发送一次消息即可生成并保存会话。???</div>', '暂无历史。先发送一次消息即可生成并保存会话。</div>'],
  ['title="暂无历史。先发送一次消息即可生成并保存会话。??"', 'title="加载该会话历史并继续聊天（右键可导出备份）"'],
  ['title="?????"', 'title="删除该会话"'],
  [
    'title={selectedNodes.length > 0 ? `?? ${selectedNodes.length} ????????` : "?????????"}',
    'title={selectedNodes.length > 0 ? `引用 ${selectedNodes.length} 个节点信息到对话` : "引用节点信息到对话"}',
  ],
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
  ['title="???????????????????????"', 'title="在下方对话中插入一条带表格的消息（不调用模型）"'],
  ['<span>?????????</span>\n                  </button>\n                </>\n              )}\n              {selectedNodes.length > 0', '<span>在对话中显示为表格</span>\n                  </button>\n                </>\n              )}\n              {selectedNodes.length > 0'],
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
    'title="???????????????????????"\n              >\n                ??????',
    'title="复制可直接粘贴到新对话的恢复文本"\n              >\n                复制恢复文本',
  ],
  ['<span className="flex-1">??????????</span>', '<span className="flex-1">正在引用图片进行对话</span>'],
  [
    'title="?????"\n              >\n                <X size={12} strokeWidth={2.5} />\n              <span>????</span>',
    'title="中止引用图片对话"\n              >\n                <X size={12} strokeWidth={2.5} />\n                <span>中止引用</span>',
  ],
  ['<span>???? ({attachedImages.length})</span>', '<span>附加图片 ({attachedImages.length})</span>'],
  [
    'onClick={removeAllAttachedImages}\n                className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-red-500/20 transition-all"\n                title="??????"',
    'onClick={removeAllAttachedImages}\n                className="ml-auto p-1 rounded text-gray-400 hover:text-white hover:bg-red-500/20 transition-all"\n                title="移除所有图片"',
  ],
  ['alt={`???? ${index + 1}`}', 'alt={`附加图片 ${index + 1}`}'],
  [
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="??????"',
    'onClick={() => removeAttachedImage(index)}\n                    className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"\n                    title="移除这张图片"',
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
  ['placeholder="?????Enter ???Shift+Enter ??"', 'placeholder="输入消息… Enter 发送，Shift+Enter 换行"'],
  ['placeholder="????? Enter ???Shift+Enter ??"', 'placeholder="输入消息… Enter 发送，Shift+Enter 换行"'],
  [
    'disabled={(input.trim() === \'\' && !referencedImage && attachedImages.length === 0) || isLoading}\n            title="删除该会话"',
    'disabled={(input.trim() === \'\' && !referencedImage && attachedImages.length === 0) || isLoading}\n            title="发送消息"',
  ],
];

let n = 0;
for (const [from, to] of pairs) {
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  }
}

fs.writeFileSync(path, t, 'utf8');
console.log('fixed', n, 'blocks');
