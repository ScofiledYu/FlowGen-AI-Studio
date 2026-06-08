import fs from 'fs';

const p = 'components/ChatPanel.tsx';
const s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('/** 过程区卡片：联网检索');
const end = s.indexOf('/** 单行消息独立 memo');
if (start < 0 || end < 0) throw new Error('markers not found');

const block = `/** 过程区卡片：联网检索 / 思考过程统一样式 */
function AssistantProcessCard(props: {
  title: string;
  sections: Array<{ label: string; body: string; sourcesStyle?: boolean }>;
}) {
  const visible = props.sections.filter((sec) => (sec.body || '').trim());
  if (!visible.length) return null;
  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-900/55 px-3 py-2 text-gray-400">
      <div className="text-xs font-semibold tracking-wide mb-2">{props.title}</div>
      {visible.map((sec, i) => (
        <div key={sec.label} className={i > 0 ? 'mt-2 pt-2 border-t border-gray-700/40' : ''}>
          <motion.div className="text-[11px] font-medium text-gray-500 mb-1">{sec.label}</motion.div>
          <motion.div
            className={
              sec.sourcesStyle
                ? 'text-xs leading-relaxed whitespace-pre-wrap font-[450] select-text text-gray-500 max-h-48 overflow-y-auto'
                : 'text-sm leading-relaxed whitespace-pre-wrap font-[450] select-text text-gray-400'
            }
          >
            {sec.body}
          </motion.div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function renderAssistantProcessPanels(content: string): React.ReactNode {
  const parsed = parseAssistantMessage(content || '');
  const { webSearch, thinking } = parsed;
  const cleanedWebSearch = sanitizeWebSearchProcessText(webSearch);
  const { process: webProcess, sources: webSources } = splitWebSearchForDisplay(cleanedWebSearch);
  const localizedProcess = localizeWebSearchProcessForDisplay(webProcess, {
    completed: !!webSources.trim() || parsed.main.trim().length > 40,
  });
  const thinkingBody = localizeThinkingProcessForDisplay(thinking);
  if (!cleanedWebSearch.trim() && !thinkingBody.trim()) return null;

  return (
    <motion.div className="space-y-2 mb-3">
      {cleanedWebSearch.trim() ? (
        <AssistantProcessCard
          title={ASSISTANT_MARKER_WEB_SEARCH}
          sections={[
            ...(localizedProcess.trim()
              ? [{ label: '搜索过程', body: localizedProcess }]
              : []),
            ...(webSources.trim()
              ? [{ label: '检索来源', body: webSources, sourcesStyle: true }]
              : []),
          ]}
        />
      ) : null}
      {thinkingBody.trim() ? (
        <AssistantProcessCard
          title={ASSISTANT_MARKER_THINKING}
          sections={[{ label: '思考过程', body: thinkingBody }]}
        />
      ) : null}
    </motion.div>
  );
}

function renderAssistantTextContent(content: string): React.ReactNode {
  return (
    <motion.div className="space-y-2">
      {renderAssistantProcessPanels(content)}
      {renderAssistantMainContent(content)}
    </motion.div>
  );
}

`;

const clean = block.replace(/<\/?motion\.div/g, (m) => m.replace('motion.', ''));

fs.writeFileSync(p, s.slice(0, start) + clean + s.slice(end));
console.log('ok');
