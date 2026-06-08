/**
 * 校验：问时间不再走本地模板快路径，改由模型正常回答
 */
import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const src = fs.readFileSync(path, 'utf8');

const mustHave = [
  '现在几点|当前时间|北京时间',
  'function isCurrentTimeUserQuestion',
  'title="发送消息"',
];

const mustNotHave = [
  'buildLocalCurrentTimeAnswer',
  'local Beijing time answer (skipped web search API)',
  '【本机当前时间】Asia/Shanghai',
  'time.is/Beijing',
  'buildSupplementalTimeContextForSummarize',
  '当前时区为 Asia/Shanghai',
];

let failed = 0;
for (const s of mustHave) {
  if (!src.includes(s)) {
    console.error('MISSING:', s);
    failed++;
  }
}
for (const s of mustNotHave) {
  if (src.includes(s)) {
    console.error('SHOULD NOT HAVE:', s);
    failed++;
  }
}

if (failed) {
  process.exit(1);
}
console.log('test-current-time-answer: ok');
