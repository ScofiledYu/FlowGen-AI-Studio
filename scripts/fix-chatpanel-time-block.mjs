/**
 * 若天气/联网总结区块被 prebuild 误伤，整块恢复（幂等；不再注入本地时钟快路径）
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let src = fs.readFileSync(path, 'utf8');

const markerBroken =
  !src.includes('你是中文助手。请根据下方') ||
  !src.includes('function isWeatherUserQuestion') ||
  !src.includes('天气类问题须写出温度') ||
  src.includes('catch {\n    /\\d{4}年') ||
  src.includes('const wantsTable = /表格|列表|对比|排行/.test(question);\n      `') ||
  !src.includes('function compactSearchDumpForSummarize') ||
  src.includes('buildSupplementalTimeContextForSummarize') ||
  src.includes('buildLocalCurrentTimeAnswer') ||
  src.includes('local Beijing time answer (skipped web search API)');

if (!markerBroken) {
  console.log('fix-chatpanel-time-block: ok (no repair needed)');
  process.exit(0);
}

const start = src.indexOf('function isCurrentTimeUserQuestion');
const end = src.indexOf('function isLightweightPrompt');
if (start < 0 || end < 0 || end <= start) {
  console.error('fix-chatpanel-time-block: cannot locate block');
  process.exit(1);
}

const block = `function isCurrentTimeUserQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /现在几点|当前时间|北京时间|今天几号|几点了|what\\s*time|current\\s*time/i.test(t);
}

function isWeatherUserQuestion(text: string): boolean {
  const t = (text || '').trim();
  if (!t || isCurrentTimeUserQuestion(t)) return false;
  return /天气|气温|温度|降水|降雨|下雨|风力|湿度|多云|阴天|晴天|预报|冷|热/.test(t);
}

function extractWeatherFactsFromWebDump(dump: string): string {
  const lines = (dump || '').replace(/\\r\\n/g, '\\n').split('\\n');
  const picked: string[] = [];
  const seen = new Set<string>();
  const weatherCue = /(℃|°C|°|摄氏度|mm|%|级|风|雨|云|晴|阴|雾|温|湿|压|气象|预报|实况|日出|日落|月落|降雨)/;
  for (const raw of lines) {
    const ln = raw.replace(/\\uFFFD/g, '').trim();
    if (ln.length < 4 || ln.length > 220) continue;
    if (!/\\d/.test(ln) || !weatherCue.test(ln)) continue;
    if (/^https?:\\/\\//i.test(ln)) continue;
    if (/^[\\?？]{2,}$/.test(ln)) continue;
    if (isInternalPromptBoilerplateLine(ln)) continue;
    const key = ln.slice(0, 72);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(ln);
    if (picked.length >= 28) break;
  }
  return picked.join('\\n');
}

function buildSupplementalWeatherContextForSummarize(userQuestion: string, searchDump: string): string {
  if (!isWeatherUserQuestion(userQuestion)) return '';
  const facts = extractWeatherFactsFromWebDump(searchDump);
  if (!facts.trim()) {
    return (
      '【天气资料提示】检索摘要中未解析到清晰数值。请用简体中文写天气概况（晴/雨/多云等），' +
      '并说明温度、湿度、风力等具体数字以深圳市气象局或「检索来源」为准；禁止用连续问号占位。'
    );
  }
  return [
    '【从检索摘要抽取的天气数值与描述（须优先写入正文）】',
    facts,
    '说明：请把以上数字整理成可读实况（温度、湿度、风、降水等）；禁止输出 ???? 或连续问号；缺项可省略，勿臆造。',
  ].join('\\n');
}

function compactSearchDumpForSummarize(text: string, maxChars = 4000, userQuestion = ''): string {
  const raw = stripInternalPromptBoilerplate(
    stripLeakedSearchBlocks((text || '').replace(/\\r\\n/g, '\\n').trim())
  );
  if (!raw) return '';
  const lines = raw
    .split('\\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^i'?ll search for\\b/i.test(l))
    .filter((l) => {
      const qm = l.match(/"(.*?)"/) || l.match(/「([^」]*)」/);
      if (qm && isInternalPromptLeakQuery(qm[1])) return false;
      return true;
    });
  const picked: string[] = [];
  const weatherFirst: string[] = [];
  const weatherCue = /(℃|°C|mm|%|级|风|雨|云|晴|阴|温|湿|气象|预报|实况)/;
  for (const ln of lines) {
    if (/^please note/i.test(ln)) continue;
    if (isWeatherUserQuestion(userQuestion) && /\\d/.test(ln) && weatherCue.test(ln)) {
      weatherFirst.push(ln);
    } else {
      picked.push(ln);
    }
    if (picked.length + weatherFirst.length >= 40) break;
  }
  const compact = [...weatherFirst, ...picked].join('\\n');
  return compact.length <= maxChars ? compact : compact.slice(0, maxChars);
}

/** 联网检索二次总结：structured | natural（默认 natural） */
const WEB_SEARCH_SUMMARIZE_PROMPT_MODE: 'structured' | 'natural' = 'natural';

function buildSearchDumpSummarizePrompt(
  userQuestion: string,
  summarizedSearchDump: string,
  opts?: { compact?: boolean; dialogueContext?: string }
): string {
  const question = (userQuestion || '').trim() || '请基于检索内容回答用户问题。';
  const maxChars = opts?.compact
    ? 2800
    : isDetailRichUserQuestion(question)
      ? 6000
      : 4000;
  const compactDump =
    compactSearchDumpForSummarize(summarizedSearchDump || '', maxChars, question) ||
    '（检索摘要为空，请如实说明无法从检索获得有效信息。）';
  const dialogueBlock = (opts?.dialogueContext || '').trim()
    ? \`【对话上下文】\\n\${opts.dialogueContext.trim()}\\n\\n\`
    : '';

  if (WEB_SEARCH_SUMMARIZE_PROMPT_MODE === 'natural') {
    const weatherContext = buildSupplementalWeatherContextForSummarize(
      question,
      summarizedSearchDump || ''
    );
    const source = [weatherContext, compactDump].filter(Boolean).join('\\n\\n');
    return (
      \`你是中文助手。请根据下方「用户问题」与「参考资料」写面向用户的完整回答。\\n\` +
      \`要求：必须使用简体中文（大陆），禁止繁体字；不要复述 Search results 编号列表或粘贴长 URL；不要写 The user is asking… 等英文分析。\\n\` +
      \`用分点或小标题写出可直接阅读的建议，链接最多保留 0-2 条且用简短描述代替裸链。\\n\` +
      \`天气类问题须写出温度、湿度、风力、降水等具体数字（从参考资料摘录）；禁止用 ???? 或连续问号占位。\\n\\n\` +
      dialogueBlock +
      \`【用户问题】\\n\${question}\\n\\n\` +
      \`【参考资料】\\n\${source}\`
    );
  }

  const weatherContext = buildSupplementalWeatherContextForSummarize(
    question,
    summarizedSearchDump || ''
  );
  const source = [weatherContext, compactDump].filter(Boolean).join('\\n\\n');
  const wantsTable = /表格|列表|对比|排行/.test(question);
  const weatherAnswerHint = isWeatherUserQuestion(question)
    ? \`8) 天气问题：正文须含具体数字（℃、%、mm、风力等级等），禁止问号占位。\\n\`
    : '';
  const tableHint = wantsTable
    ? \`7) 用户需要表格时，用 Markdown 表格呈现。\\n\`
    : '';
  return (
    \`你是中文助手。请根据检索资料用简体中文回答用户问题。\\n\` +
    dialogueBlock +
    \`【用户问题】\\n\${question}\\n\\n\` +
    \`【写作要求】\\n\` +
    \`1) 先给 1-2 句结论。\\n\` +
    \`2) 正文 2-4 段，条理清晰。\\n\` +
    \`3) 不要粘贴原始检索编号列表。\\n\` +
    \`4) 禁止 The user is asking… 等元叙述。\\n\` +
    \`5) 数字、日期须与资料一致；资料矛盾时简要说明并给出最可信结论。\\n\` +
    \`6) 使用简体中文，禁止繁体。\\n\` +
    weatherAnswerHint +
    tableHint +
    \`\\n【参考资料】\\n\${source}\`
  );
}

`;

src = src.slice(0, start) + block + src.slice(end);
fs.writeFileSync(path, src, 'utf8');
console.log('fix-chatpanel-time-block: repaired');
