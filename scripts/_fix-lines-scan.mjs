import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const lines = fs.readFileSync(path, 'utf8').split('\n');
let n = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('const wantsTable = /') && line.includes('.test(question)')) {
    lines[i] = '  const wantsTable = /表格|列表|对比|排行/.test(question);';
    n++;
  }
  if (line.includes('isLightweightPrompt') && lines[i - 1]?.includes('function isLightweightPrompt')) {
    /* next line handled below */
  }
  if (lines[i - 3]?.includes('function isLightweightPrompt') && line.trim().startsWith('return /^')) {
    lines[i] = "  return /^(你好|嗨|hi|hello|嘿|在吗|你是谁|测试|test|ok)[\\s!,.，。!?？]*$/i.test(t);";
    n++;
  }
  if (line.includes("m.role === 'assistant'") && line.includes('.test(c)')) {
    if (line.includes('??????')) {
      lines[i] = "  if (m.role === 'assistant' && /^🔄 已切换模型：/.test(c)) return true;";
      n++;
    } else if (line.includes('????????????')) {
      lines[i] = "  if (m.role === 'assistant' && /^⚠️ .+ 本轮请求失败，已自动切换/.test(c)) return true;";
      n++;
    } else if (line.includes('\\*\\*?')) {
      lines[i] = "  if (m.role === 'assistant' && /^\\*\\*❌\\s+/.test(c)) return true;";
      n++;
    }
  }
  if (line.includes("/I'll search for/i.test(t) ||") && !line.includes('出了一些问题')) {
    const next = lines[i + 1];
    if (next && (next.includes('????') || next.includes('请多试'))) {
      lines[i] = "    /出了一些问题/.test(t) ||";
      if (next.includes('请多试几次') && lines[i + 2]?.includes('请多试几次')) {
        lines[i + 1] = '    /请多试几次/.test(t)';
        lines.splice(i + 2, 1);
      } else if (next.includes('????')) {
        lines[i + 1] = '    /请多试几次/.test(t)';
      }
      n++;
    }
  }
  if (line.includes('AbortError/i.test(summarizeMsg)')) {
    lines[i] =
      '          if (/首包|abort|AbortError/i.test(summarizeMsg) && !retryOptions?.summarizeCompact) {';
    n++;
  }
  if (line.trim().startsWith('if (/') && lines[i + 1]?.includes('return 4500')) {
    if (!line.includes('行程')) {
      lines[i] = '  if (/行程|攻略|第[一二三四五六七八九十\\d]+天|第二天|第三天|规划|安排|几日游|天数/.test(q)) {';
      n++;
    }
  }
  if (line.trim().startsWith('return /') && line.includes('what\\s*time')) {
    lines[i] = '  return /现在几点|当前时间|北京时间|今天几号|几点了|what\\s*time|current\\s*time/i.test(t);';
    n++;
  }
  if (line.includes('/??[^\\n]{0,60}/gi') || (line.includes('[^\\n]{0,60}/gi') && line.includes('??'))) {
    lines[i] = '    /北京[^\\n]{0,60}/gi,';
    n++;
  }
  if (line.includes('l.match(/"(.*?)"/)') && line.includes('l.match(/')) {
    lines[i] = '      const qm = l.match(/"(.*?)"/) || l.match(/「([^」]*)」/);';
    n++;
  }
  if (line.includes('const main = t.split') && !line.includes('思考过程')) {
    lines[i] = '  const main = t.split(/\\n\\n\\[思考过程\\]/)[0]?.trim() ?? t;';
    n++;
  }
  if (line.trim().startsWith('/') && line.includes('upstream') && line.includes('rate')) {
    lines[i] =
      '  /请多试|多试几次|出了一些问题|未能回复|稍后再试|服务繁忙|繁忙|限流|队列|超时|维护|余额|upstream|rate\\s*limit|overload|认证异常|鉴权|未授权|令牌无效|token|auth|no results found|未找到结果/i;';
    n++;
  }
  if (line.startsWith('const UPSTREAM_FALLBACK_STRICT_RE')) {
    lines[i] =
      'const UPSTREAM_FALLBACK_STRICT_RE = /出了一些问题|请多试|多试几次|未能回复|认证异常|no results found|未找到结果/;';
    n++;
  }
  if (line.startsWith('const AITOP_AUTH_SIGNAL_RE')) {
    lines[i] = 'const AITOP_AUTH_SIGNAL_RE = /认证异常|鉴权|未授权|令牌无效|token|auth/i;';
    n++;
  }
  if (line.includes('needsWebSearchContextExpansion') === false && line.trim().startsWith('return /^') && line.includes('.test(q)')) {
    lines[i] = '  return /^(今天|明天|后天|周[一二三四五六日天]|\\d+月\\d+日|几号|几点|天气|股价|汇率)/.test(q);';
    n++;
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('fixed', n, 'lines');
