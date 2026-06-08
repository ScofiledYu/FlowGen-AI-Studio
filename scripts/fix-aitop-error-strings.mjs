/** 修复 AiTop/Gemini/Claude 错误与上下文相关乱码 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const pairs = [
  ['return `**? ${modelLabel}**`', 'return `**❌ ${modelLabel}**`'],
  ['`**????* ', '`**超时：** '],
  ['`**???** ', '`**问题：** '],
  ['\n**?????** ', '\n**错误信息：** '],
  ['\n**HTTP???**', '\n**HTTP 错误：**'],
  ["note: 'Qwen ???? Claude/Gemini ? webSearch/thinking ??'", "note: 'Qwen 路径不含 Claude/Gemini 的 webSearch/thinking 参数'"],
];

let n = 0;
for (const [from, to] of pairs) {
  if (t.includes(from)) {
    t = t.split(from).join(to);
    n++;
  }
}

if (!t.includes('请多试|多试几次|出了一些问题')) {
  t = t.replace(
    /const UPSTREAM_FALLBACK_SIGNAL_RE =\s*\n\s*\/[^;]+;/,
    "const UPSTREAM_FALLBACK_SIGNAL_RE =\n  /请多试|多试几次|出了一些问题|未能回复|稍后再试|服务繁忙|繁忙|限流|队列|超时|维护|余额|upstream|rate\\s*limit|overload|认证异常|鉴权|未授权|令牌无效|token|auth|no results found|未找到结果/i;"
  );
  n++;
}
if (!t.includes('出了一些问题|请多试')) {
  t = t.replace(
    /const UPSTREAM_FALLBACK_STRICT_RE = [^;]+;/,
    'const UPSTREAM_FALLBACK_STRICT_RE = /出了一些问题|请多试|多试几次|未能回复|认证异常|no results found|未找到结果/;'
  );
  n++;
}

fs.writeFileSync(path, t, 'utf8');
console.log('fix-aitop-error-strings:', n);
