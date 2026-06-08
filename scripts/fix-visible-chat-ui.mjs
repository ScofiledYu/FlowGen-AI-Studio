/**
 * 修复 ChatPanel 用户可见 UI 中的 ? 乱码（长度不固定的占位符）
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');
let n = 0;

function rep(re, to) {
  const next = t.replace(re, to);
  if (next !== t) {
    t = next;
    n++;
  }
}

rep(
  /(onClick=\{handleLoadOlderMessages\}[\s\S]*?title=")\?+("\s*\n\s*>\s*\n\s*)\?+ \(\{firstVisibleMessageIndex\}\)/,
  '$1显示更早的消息（历史内容不丢失）$2显示更早消息 ({firstVisibleMessageIndex})'
);
rep(/>\?{3,}AI\?{2,}\.\.\.<\/div>/, '>开始与AI对话...</div>');
rep(/开始与AI对话\.\.\.<\/\/div>/, '开始与AI对话...</div>');
rep(
  /<div className="text-xs text-gray-600 font-medium">\?+<\/div>/,
  '<div className="text-xs text-gray-600 font-medium">在下方输入消息，支持联网搜索与深度思考</div>'
);
rep(
  /<span className="text-sm font-medium">\?{4,}\.\.\.<\/span>/,
  '<span className="text-sm font-medium">正在生成回复...</span>'
);
rep(/\{expanded \? '\?\?' : '\?\?'\}/g, "{expanded ? '收起' : '展开'}");
rep(/\|\| '\?\?\?\?';/g, "|| '思考中…';");
rep(/\|\| '\?\?\?\?\?\?';/g, "|| '联网检索中…';");
rep(/sectionLabel="\?+"/, 'sectionLabel="思考过程"');
rep(
  /title="\?+"\s*\n\s*>\s*\n\s*\?+\?JSON\?/,
  'title="导出轻量结构化备份（包含可粘贴恢复文本）"\n              >\n                导出对话备份（JSON）'
);
rep(
  /title="\?+"\s*\n\s*>\s*\n\s*\?+\s*\n\s*<\/button>\s*\n\s*<\/div>\s*\n\s*<\/div>\s*\n\s*\)\}\s*\n\s*<\/div>\s*\n\s*\{\/\* \?/,
  (m) => m // skip overly broad
);

// 导出菜单第二项（复制恢复文本）
rep(
  /onClick=\{\(\) => void copySessionRestoreText\(sessionExportMenu\.session\)\}[\s\S]*?title="\?+"\s*\n\s*>\s*\n\s*\?+\s*\n\s*<\/button>/,
  `onClick={() => void copySessionRestoreText(sessionExportMenu.session)}
                className="w-full text-left px-4 py-3 text-sm font-medium text-white hover:bg-gradient-to-r hover:from-brand-900/35 hover:to-gray-800 transition-all duration-200 border-t border-gray-700/60"
                title="复制可直接粘贴到新对话的恢复文本"
              >
                复制恢复文本
              </button>`
);

// buildRestoreTextFromBackup 块
if (t.includes("m.role === 'user' ? '??'")) {
  t = t.replace(
    /const buildRestoreTextFromBackup = \(backup: CompactChatBackupV1\): string => \{[\s\S]*?\};\n\n  const saveTextAsFile/,
    `const buildRestoreTextFromBackup = (backup: CompactChatBackupV1): string => {
    const dialogText = backup.messages
      .map((m) => \`\${m.role === 'user' ? '用户' : '助手'}：\${m.content}\`)
      .join('\\n\\n');
    return [
      \`【历史会话备份】\`,
      \`标题：\${backup.title}\`,
      \`模型：\${backup.modelId}\`,
      \`导出时间：\${backup.exportedAt}\`,
      '',
      '请基于下面历史内容继续对话：',
      dialogText || '(无可用历史内容)',
    ].join('\\n');
  };

  const saveTextAsFile`
  );
  n++;
}

rep(
  /if \(!ok\) throw new Error\('\?+JSON\?+'\);/,
  "if (!ok) throw new Error('当前环境不支持自动复制，请改用“导出对话备份（JSON）”后手动复制。');"
);
rep(/setHistoryError\(`\?+\$\{e/, 'setHistoryError(`导出失败：${e');
rep(
  /copySessionRestoreText[\s\S]*?setHistoryError\(`\?+\$\{e/,
  (block) => block.replace(/setHistoryError\(`\?+\$\{e/, 'setHistoryError(`复制失败：${e')
);

fs.writeFileSync(path, t, 'utf8');
console.log('fix-visible-chat-ui:', n, 'patterns');
