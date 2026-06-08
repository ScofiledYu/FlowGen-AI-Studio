/**
 * 修复 ChatPanel 错误展示中的乱码（HTTP ???、????? 等），避免 sanitize 成「数值暂未解析」
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
let t = fs.readFileSync(path, 'utf8');

const replaceAll = (from, to) => {
  if (!t.includes(from)) return 0;
  const n = t.split(from).length - 1;
  t = t.split(from).join(to);
  return n;
};

let n = 0;

// buildQwenHttpErrorDetail
n += replaceAll(
  'let detail = `**HTTP ???** ${status} ${statusText || \'\'}\n\n`;',
  'let detail = `**HTTP状态：** ${status} ${statusText || \'\'}\n\n`;'
);
n += replaceAll(
  'if (bodyStr.trim()) detail += `**?????** ${bodyStr.slice(0, 500)}\\n\\n`;',
  'if (bodyStr.trim()) detail += `**响应正文：** ${bodyStr.slice(0, 500)}\\n\\n`;'
);

// HTTP / 错误字段（Gemini、Claude、axios 共用模板）
n += replaceAll('`**HTTP ???** ', '`**HTTP状态：** ');
n += replaceAll(
  'errorDetail = `\\n**?????** ${errorData.error.type || \'??\'}\\n**?????** ${errorData.error.message || \'?????\'}',
  'errorDetail = `\\n**错误类型：** ${errorData.error.type || \'未知\'}\\n**错误消息：** ${errorData.error.message || \'无详细错误信息\'}'
);
n += replaceAll(
  'errorDetail += `\\n**?????** ${errorData.error.code}`;',
  'errorDetail += `\\n**错误代码：** ${errorData.error.code}`;'
);
n += replaceAll('errorDetail = `\\n**?????** ${errorData.message}`;', 'errorDetail = `\\n**错误消息：** ${errorData.message}`;');
n += replaceAll('errorDetail = `\\n**?????** ${errorData.msg}`;', 'errorDetail = `\\n**错误消息：** ${errorData.msg}`;');
n += replaceAll(
  'errorDetail = `\\n**????** ${JSON.stringify(errorData, null, 2)}`;',
  'errorDetail = `\\n**错误详情：** ${JSON.stringify(errorData, null, 2)}`;'
);
n += replaceAll('errorDetail = `\\n**????** ${errorText}`;', 'errorDetail = `\\n**错误详情：** ${errorText}`;');
n += replaceAll(
  'errorDetail = `\\n**HTTP ???** ${response.status}\\n**?????** ${response.statusText}`;',
  'errorDetail = `\\n**状态码：** ${response.status}\\n**状态文本：** ${response.statusText}`;'
);

// axios 非 Qwen 分支（与 reference 一致）
n += replaceAll(
  'let detail = `**HTTP ???** ${error.response.status} ${error.response.statusText || \'\'}\n\n`;',
  'let detail = `**HTTP状态：** ${error.response.status} ${error.response.statusText || \'\'}\n\n`;'
);
n += replaceAll(
  'detail += `**?????** ${responseData.error.type || \'??\'}\\n`;',
  'detail += `**错误类型：** ${responseData.error.type || \'未知\'}\\n`;'
);
n += replaceAll(
  'detail += `**?????** ${responseData.error.message || \'?????\'}\\n`;',
  'detail += `**错误消息：** ${responseData.error.message || \'无详细错误信息\'}\\n`;'
);
n += replaceAll('detail += `**?????** ${responseData.error.code}\\n`;', 'detail += `**错误代码：** ${responseData.error.code}\\n`;');
n += replaceAll('detail += `**?????** ${responseData.message}\\n`;', 'detail += `**错误消息：** ${responseData.message}\\n`;');
n += replaceAll('detail += `**?????** ${responseData.msg}\\n`;', 'detail += `**错误消息：** ${responseData.msg}\\n`;');
n += replaceAll(
  'detail += `**????**\\n\\`\\`\\`json\\n${JSON.stringify(responseData, null, 2)}\\n\\`\\`\\`\\n`;',
  'detail += `**错误详情：**\\n\\`\\`\\`json\\n${JSON.stringify(responseData, null, 2)}\\n\\`\\`\\`\\n`;'
);
n += replaceAll('detail += `**????** ${String(responseData)}\\n`;', 'detail += `**错误详情：** ${String(responseData)}\\n`;');

// 超时 / 空响应 / 主流错误壳
n += replaceAll(
  '`**问题：** ?????${QWEN_AXIOS_TIMEOUT_MS / 1000} ?????????????`',
  '`**原因：** 请求超时（${QWEN_AXIOS_TIMEOUT_MS / 1000} 秒内未完成）。请稍后重试。`'
);
// gemini/claude 超时行（问号数量不固定，用正则）
if (/\$\{geminiFetchTimeoutMs \/ 1000\} \?/.test(t)) {
  t = t.replace(
    /`\*\*问题：\*\* \$\{geminiFetchTimeoutMs \/ 1000\}[^`]+`/g,
    '`**原因：** ${geminiFetchTimeoutMs / 1000} 秒内未完成连接或首包（请求已中止）。请稍后重试。`'
  );
  n++;
}
if (/\$\{claudeFetchTimeoutMs \/ 1000\} \?/.test(t)) {
  t = t.replace(
    /`\*\*问题：\*\* \$\{claudeFetchTimeoutMs \/ 1000\}[^`]+`/g,
    '`**原因：** ${claudeFetchTimeoutMs / 1000} 秒内未完成连接或首包（请求已中止）。请稍后重试。`'
  );
  n++;
}

n += replaceAll(
  "formatAitopErr('Gemini 3.1 Pro', '**????* ????????????????'",
  "formatAitopErr('Gemini 3.1 Pro', '**问题：** 响应体为空，服务器未返回任何数据'"
);
n += replaceAll(
  "formatAitopErr('Claude 4.6', '**????* ????????????????'",
  "formatAitopErr('Claude 4.6', '**问题：** 响应体为空，服务器未返回任何数据'"
);

n += replaceAll(
  "'**???** ???? 200 ? choices[0].message.content ???\\n??? `[chat][Qwen][debug][json]` ? send_empty_content ????????'",
  "'**问题：** 接口返回 200 但 choices[0].message.content 为空。\\n详见 `[chat][Qwen][debug][json]` 中 send_empty_content 事件的响应摘要。'"
);

n += replaceAll(
  "let errorMessage = '**? API ????**\\n\\n?????????????';",
  "let errorMessage = '**❌ API 调用失败**\\n\\n抱歉，分析过程中出现错误。';"
);
n += replaceAll(
  'errorMessage = `**? ????**\\n\\n**?????** ${String(error)}\\n\\n**???** ?????????????`;',
  'errorMessage = `**❌ 未知错误**\\n\\n**错误信息：** ${String(error)}\\n\\n**建议：** 请稍后重试或联系技术支持。`;'
);
n += replaceAll("if (!errorMessage.includes('**?'))", "if (!errorMessage.includes('**❌'))");
n += replaceAll(
  'errorMessage = `**? API ????**\\n\\n${errorMessage}`;',
  'errorMessage = `**❌ API 调用失败**\\n\\n${errorMessage}`;'
);
n += replaceAll(
  'errorMessage.includes(\'**?\') ? errorMessage : `**? ${presetName} ????**\\n\\n${errorMessage}`',
  "errorMessage.includes('**❌') ? errorMessage : `**❌ ${presetName} 发送失败**\\n\\n${errorMessage}`"
);
n += replaceAll(
  ': `**??${presetName} ?????*\\n\\n${String(error)}`',
  ': `**❌ ${presetName} 发送失败**\\n\\n${String(error)}`'
);

n += replaceAll("formatAitopLlmFailure(\n              '??????',", "formatAitopLlmFailure(\n              '对话接口',");
n += replaceAll("formatAitopLlmFailure('??????',", "formatAitopLlmFailure('对话接口',");
n += replaceAll(
  '`**问题：** ??????????? response??\\n**?????** ?????????????\\n**???** ${error.code || \'?\'}``',
  '`**问题：** 无法收到服务器响应（无 response）。\\n**可能原因：** 网络、代理或服务端未应答。\\n**代码：** ${error.code || \'—\'}``'
);
// 上一行模板字符串结尾可能是 ` 不是 ``
n += replaceAll(
  '`**问题：** ??????????? response??\\n**?????** ?????????????\\n**???** ${error.code || \'?\'}',
  '`**问题：** 无法收到服务器响应（无 response）。\\n**可能原因：** 网络、代理或服务端未应答。\\n**代码：** ${error.code || \'—\'}'
);

n += replaceAll(
  'return `???????code: ${String(code ?? \'unknown\')}?`;',
  'return `上游返回错误，code: ${String(code ?? \'unknown\')}。`;'
);
n += replaceAll(
  "const msg = extractAitopApiErrorFromPayload(data) || '????????';",
  "const msg = extractAitopApiErrorFromPayload(data) || '上游未返回详细错误信息';"
);

// appendErrorIds
if (/\*\*??ID\*\*/.test(t)) {
  t = t.replace(
    /if \(ids\.chatId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.chatId\}\`\);/,
    "if (ids.chatId && !/\\*\\*对话ID\\*\\*/i.test(out)) lines.push(`**对话ID：** ${ids.chatId}`);"
  );
  t = t.replace(
    /if \(ids\.requestId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.requestId\}\`\);/,
    "if (ids.requestId && !/\\*\\*请求ID\\*\\*/i.test(out)) lines.push(`**请求ID：** ${ids.requestId}`);"
  );
  t = t.replace(
    /if \(ids\.taskId && !\/\\\*\*Task ID\\\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.taskId\}\`\);/,
    "if (ids.taskId && !/\\*\\*Task ID\\*\\*/i.test(out)) lines.push(`**Task ID：** ${ids.taskId}`);"
  );
  n++;
}

// 流式/兜底错误中的 5 个问号标签
n += replaceAll(
  'let errorMsg = `**?????** ${data.error.type || \'??\'}\\n**?????** ${data.error.message || \'?????\'}',
  'let errorMsg = `**错误类型：** ${data.error.type || \'未知\'}\\n**错误消息：** ${data.error.message || \'无详细错误信息\'}'
);
n += replaceAll('errorMsg += `\\n**?????** ${data.error.code}`;', 'errorMsg += `\\n**错误代码：** ${data.error.code}`;');

n += replaceAll(
  "'**???** ????????????????',",
  "'**问题：** 模型未返回有效正文或表格内容。',"
);
n += replaceAll(
  'let errorMsg = `**?????** ${data.error.type || \'??\'}\\n**?????** ${data.error.message || \'???????\'}`;',
  'let errorMsg = `**错误类型：** ${data.error.type || \'未知\'}\\n**错误消息：** ${data.error.message || \'无详细错误信息\'}`;'
);

// appendErrorIds（若仍损坏）
if (/\*\*??ID\*\*/.test(t)) {
  t = t.replace(
    /if \(ids\.chatId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.chatId\}\`\);/,
    "if (ids.chatId && !/\\*\\*对话ID\\*\\*/i.test(out)) lines.push(`**对话ID：** ${ids.chatId}`);"
  );
  t = t.replace(
    /if \(ids\.requestId && !\/\\\*\*[^*]+\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.requestId\}\`\);/,
    "if (ids.requestId && !/\\*\\*请求ID\\*\\*/i.test(out)) lines.push(`**请求ID：** ${ids.requestId}`);"
  );
  t = t.replace(
    /if \(ids\.taskId && !\/\\\*\*Task ID\\\*\*\/i\.test\(out\)\) lines\.push\(`\*\*[^`]+`\$\{ids\.taskId\}\`\);/,
    "if (ids.taskId && !/\\*\\*Task ID\\*\\*/i.test(out)) lines.push(`**Task ID：** ${ids.taskId}`);"
  );
  n++;
}

fs.writeFileSync(path, t, 'utf8');
console.log('fix-error-display-strings: applied', n, 'pattern groups');
