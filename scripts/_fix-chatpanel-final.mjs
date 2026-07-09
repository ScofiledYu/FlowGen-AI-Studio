import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const lines = fs.readFileSync(path, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  const t = lines[i];
  if (t.includes('function resolveHistoryMaxCharsPerMsg')) continue;
  if (t.trim().startsWith('if (/') && lines[i + 1]?.trim() === 'return 4500;') {
    lines[i] = '  if (/行程|攻略|第[一二三四五六七八九十\\d]+天|第二天|第三天|规划|安排|几日游|天数/.test(q)) {';
  }
  if (t.includes("m.role === 'assistant'") && t.includes('/^') && t.includes('.test(c)')) {
    if (t.includes('??????') && !t.includes('自动切换')) {
      lines[i] = "  if (m.role === 'assistant' && /^🔄 已切换模型：/.test(c)) return true;";
    } else if (t.includes('????????????')) {
      lines[i] = "  if (m.role === 'assistant' && /^⚠️ .+ 本轮请求失败，已自动切换/.test(c)) return true;";
    } else if (t.includes('**')) {
      lines[i] = "  if (m.role === 'assistant' && /^\\*\\*❌\\s+/.test(c)) return true;";
    }
  }
  if (t.includes('const main = t.split')) {
    lines[i] = '  const main = t.split(/\\n\\n\\[思考过程\\]/)[0]?.trim() ?? t;';
  }
  if (t.includes('function isCurrentTimeUserQuestion')) {
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (lines[j].trim().startsWith('return /')) {
        lines[j] = '  return /现在几点|当前时间|北京时间|今天几号|几点了|what\\s*time|current\\s*time/i.test(t);';
        break;
      }
    }
  }
  if (t.includes('[^\\n]{0,60}/gi') && (t.includes('??') || t.includes('/北京') === false)) {
    lines[i] = '    /北京[^\\n]{0,60}/gi,';
  }
  if (t.includes('l.match(/"(.*?)"/)') && t.includes('l.match(/')) {
    lines[i] = '      const qm = l.match(/"(.*?)"/) || l.match(/「([^」]*)」/);';
  }
  if (
    t.includes('function buildSearchDumpSummarizePrompt') === false &&
    t.trim() === 'const wantsTable = /??|??|??|??/.test(question);'
  ) {
    lines[i] = '  const wantsTable = /表格|列表|对比|排行/.test(question);';
  }
  // 仅修复乱码的轻量句正则；组合问候逻辑以 ChatPanel 源码为准，勿整段覆盖
  if (
    lines[i - 3]?.includes('function isLightweightPrompt') &&
    t.trim().startsWith('return /^') &&
    (t.includes('??') || t.includes('????'))
  ) {
    lines[i] =
      "  if (/^(你好|嗨|hi|hello|嘿|在吗|你是谁|测试|test|ok)[\\s!,.，。!?？]*$/i.test(t)) return true;";
  }
  if (t.includes('function needsWebSearchContextExpansion') === false && t.trim().startsWith('return /^') && t.includes('.test(q)')) {
    lines[i] = '  return /^(今天|明天|后天|周[一二三四五六日天]|\\d+月\\d+日|几号|几点|天气|股价|汇率)/.test(q);';
  }
  if (t.trim().startsWith('/') && t.includes('upstream') && t.includes('rate\\s*limit')) {
    lines[i] =
      '  /请多试|多试几次|出了一些问题|未能回复|稍后再试|服务繁忙|繁忙|限流|队列|超时|维护|余额|upstream|rate\\s*limit|overload|认证异常|鉴权|未授权|令牌无效|token|auth|no results found|未找到结果/i;';
  }
  if (t.startsWith('const UPSTREAM_FALLBACK_STRICT_RE')) {
    lines[i] =
      'const UPSTREAM_FALLBACK_STRICT_RE = /出了一些问题|请多试|多试几次|未能回复|认证异常|no results found|未找到结果/;';
  }
  if (t.startsWith('const AITOP_AUTH_SIGNAL_RE')) {
    lines[i] = 'const AITOP_AUTH_SIGNAL_RE = /认证异常|鉴权|未授权|令牌无效|token|auth/i;';
  }
  if (t.includes('AbortError/i.test(summarizeMsg)')) {
    lines[i] =
      '          if (/首包|abort|AbortError/i.test(summarizeMsg) && !retryOptions?.summarizeCompact) {';
  }
  if (t.includes('isNoisyAssistantHistory') === false && t.includes('Here are the search results')) {
    lines[i + 1] = "    /I'll search for/i.test(t) ||";
    lines[i + 2] = '    /出了一些问题/.test(t) ||';
    lines[i + 3] = '    /请多试几次/.test(t)';
    if (lines[i + 4]?.includes('.test(t)')) lines.splice(i + 4, 1);
  }
  if (t.includes('const patterns = [')) {
    lines[i + 1] = '    /\\d{4}年\\d{1,2}月\\d{1,2}日[^\\n]{0,40}/g,';
    lines[i + 2] = '    /\\d{1,2}月\\d{1,2}日[^\\n]{0,30}/g,';
    lines[i + 3] = '    /北京[^\\n]{0,60}/gi,';
    lines[i + 5] = '    /\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/g,';
  }
  if (t.includes('localizedProcess')) {
    lines[i] = lines[i].replace(/label: '[^']+'/, "label: '搜索过程'");
  }
  if (t.includes('webSources, sourcesStyle')) {
    lines[i] = lines[i].replace(/label: '[^']+'/, "label: '检索来源'");
  }
  if (t.includes('thinkingBody }') && t.includes('sections=')) {
    lines[i] = "          sections={[{ label: '思考过程', body: thinkingBody }]}";
  }
  if (lines[i - 1]?.trim() === 'content:' && t.trim().startsWith("'") && /AI/.test(t)) {
    lines[i] =
      "      '您好！我是AI对话助手，可以帮您解答问题、分析内容。\\n\\n💡 提示：您可以点击「引用节点」按钮来引用当前选中的节点信息进行分析。',";
  }
  if (t.includes("content: `") && /\?/.test(t) && lines[i - 3]?.includes('welcome-')) {
    lines[i] = '          content: `✅ 已加载历史，会话可继续对话。`,';
  }
  if (t.includes('payload.thinkingLevel =') && t.includes('<span>')) {
    lines[i] =
      "      payload.thinkingLevel = !useDegraded && !lightweight && thinkingMode === 'deep' ? 'high' : 'low';";
  }
  if (
    t.trim().startsWith('<span>{thinkingMode') &&
    t.includes('深度思考') &&
    lines[i - 1]?.includes('payload.thinkingLevel') === false
  ) {
    lines[i] =
      "              <span>{thinkingMode === 'deep' ? '深度思考' : thinkingMode === 'light' ? '浅思考' : '思考'}</span>";
  }
  if (t.includes('onClick={handleSend}') === false && t.includes('title="????"') && lines[i + 1]?.includes('Loader2')) {
    lines[i] = '            title="发送消息"';
  }
  if (t.includes('placeholder="') && t.includes('Shift+Enter') && /\?/.test(t)) {
    lines[i] = '              placeholder="输入消息… Enter 发送，Shift+Enter 换行"';
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('done');
