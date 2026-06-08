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
    if (t.includes('????') || t.includes('??????')) {
      if (t.includes('切换') || t.includes('??')) {
        lines[i] = "  if (m.role === 'assistant' && /^🔄 已切换模型：/.test(c)) return true;";
      } else if (t.includes('失败') || t.includes('????????')) {
        lines[i] = "  if (m.role === 'assistant' && /^⚠️ .+ 本轮请求失败，已自动切换/.test(c)) return true;";
      } else if (t.includes('**') || t.includes('❌') === false) {
        lines[i] = "  if (m.role === 'assistant' && /^\\*\\*❌\\s+/.test(c)) return true;";
      }
    }
  }
  if (t.includes('function needsWebSearchContextExpansion') === false && t.includes('needsWebSearchContextExpansion') === false) {
    if (t.trim().startsWith('return /^') && t.includes('.test(q)') && t.includes('????')) {
      lines[i] = '  return /^(今天|明天|后天|周[一二三四五六日天]|\\d+月\\d+日|几号|几点|天气|股价|汇率)/.test(q);';
    }
  }
  if (t.includes('UPSTREAM_FALLBACK_HINT_RE') && t.includes('upstream')) {
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
  if (t.includes('const main = t.split') && t.includes('????')) {
    lines[i] = '  const main = t.split(/\\n\\n\\[思考过程\\]/)[0]?.trim() ?? t;';
  }
  if (t.includes('function isCurrentTimeUserQuestion')) {
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (lines[j].trim().startsWith('return /') && (lines[j].includes('?') || lines[j].includes('????'))) {
        lines[j] = '  return /现在几点|当前时间|北京时间|今天几号|几点了|几点钟|现在.*时间|what\\s*time|current\\s*time/i.test(t);';
        break;
      }
    }
  }
  if (t.includes('function extractTimeHintsFromWebDump')) {
    for (let j = i; j < Math.min(i + 25, lines.length); j++) {
      if (lines[j].includes('const patterns = [')) {
        lines[j + 1] = '    /\\d{4}年\\d{1,2}月\\d{1,2}日[^\\n]{0,40}/g,';
        lines[j + 2] = '    /\\d{1,2}月\\d{1,2}日[^\\n]{0,30}/g,';
        lines[j + 3] = '    /北京[^\\n]{0,60}/gi,';
        lines[j + 5] = '    /\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日/g,';
        break;
      }
    }
  }
  if (t.includes('function compactSearchDumpForSummarize')) {
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      if (lines[j].includes('l.match(/"(.*?)"/)') && lines[j].includes('l.match(/')) {
        lines[j] = '      const qm = l.match(/"(.*?)"/) || l.match(/「([^」]*)」/);';
        break;
      }
    }
  }
  if (t.includes('function buildSearchDumpSummarizePrompt')) {
    for (let j = i; j < Math.min(i + 80, lines.length); j++) {
      if (lines[j].includes('const wantsTable = /') && lines[j].includes('????') === false) {
        /* already ok */
      } else if (lines[j].trim().startsWith('const wantsTable = /') && lines[j - 1]?.includes('return (')) {
        /* skip: wantsTable must not appear inside return ( */
      }
    }
  }
  if (t.includes('function isLightweightPrompt')) {
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (lines[j].trim().startsWith('return /^') && (lines[j].includes('??') || lines[j].includes('????'))) {
        lines[j] =
          "  return /^(你好|嗨|hi|hello|嘿|在吗|你是谁|测试|test|ok)[\\s!,.，。!?？]*$/i.test(t);";
        break;
      }
    }
  }
  if (t.includes("/I'll search for/i.test(t)") && lines[i + 1]?.includes('.test(t)')) {
    if (lines[i + 1].includes('????')) {
      lines[i + 1] = "    /出了一些问题/.test(t) ||";
      lines[i + 2] = "    /请多试几次/.test(t)";
    }
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('fix-regex-lines: done (content-based)');
