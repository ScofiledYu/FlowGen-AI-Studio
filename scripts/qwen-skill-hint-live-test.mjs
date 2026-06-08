/**
 * Qwen + Skill 输出格式补充 → 是否输出 Markdown 表头
 * node scripts/qwen-skill-hint-live-test.mjs
 */
import {
  buildProjectSkillBlock,
  PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE,
} from '../utils/projectSkill.ts';

const BASE = 'http://localhost:3001/api/v1/chat/completions';
const API_KEY = '0fd502c3-7d1b-43d3-9eb6-4e91918af979';
const MODEL = 'Qwen3-VL-235B-A22B-Instruct';
const TIMEOUT_MS = 120_000;

const skillBlock = buildProjectSkillBlock({
  enabled: true,
  title: '龙与潇逍分镜',
  content: `将剧本转化为分镜脚本。Seedance2.0 单镜最长15秒。
以表格输出8列：镜头编号、关联剧本、景别/视角/构图、画面描述、情绪&节奏、声音设计、衔接逻辑、运镜提示。`,
  outputFormatHint: PROJECT_SKILL_OUTPUT_TABLE_HINT_EXAMPLE,
});

function parseSseLine(line) {
  const t = (line || '').trim();
  if (!t || t === '[DONE]') return null;
  return t.startsWith('data:') ? t.slice(5).trim() : t;
}

function getDelta(data) {
  return data?.choices?.[0]?.delta?.content || '';
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

ok('Skill 块含输出格式补充', skillBlock.includes('禁止用「ep001 | 15'));
ok('Skill 块含表头示例', skillBlock.includes('| 镜头编号 |'));

const userPrompt =
  '请为《龙与潇逍》开场写3个增补镜头分镜（仅3行数据，不要【续】，不要前言）。';

console.log('\nQwen live with skill+hint…');
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
let full = '';
const started = Date.now();

try {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: skillBlock },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: ac.signal,
  });
  ok('HTTP 200', res.ok, `status=${res.status}`);
  if (!res.ok || !res.body) process.exit(1);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const payload = parseSseLine(line);
      if (!payload) continue;
      try {
        full += getDelta(JSON.parse(payload));
      } catch {
        /* ignore */
      }
    }
  }
} catch (e) {
  ok('Qwen 请求', false, e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  clearTimeout(timer);
}

const elapsed = Date.now() - started;
console.log(`  elapsedMs=${elapsed} len=${full.length}`);
console.log('  preview:', full.slice(0, 320).replace(/\n/g, '\\n'));

const hasMarkdownHeader = /\|\s*镜头编号\s*\|/.test(full) && /\|[\s-:|]+\|/.test(full);
const hasBarePipeRows = /^ep\d+_\S+\s*\|\s*\d+/m.test(full) && !hasMarkdownHeader;
ok('含 Markdown 表头+分隔行', hasMarkdownHeader);
ok('非纯 pipe 单行格式', !hasBarePipeRows || hasMarkdownHeader, hasBarePipeRows ? '仍为 ep001 | 15 无表头' : '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
