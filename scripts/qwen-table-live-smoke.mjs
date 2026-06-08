/**
 * Qwen 短 prompt 实机冒烟：流式 + pipe 分镜 → 表格解析
 * node scripts/qwen-table-live-smoke.mjs
 */
const BASE = 'http://localhost:3001/api/v1/chat/completions';
const API_KEY = '0fd502c3-7d1b-43d3-9eb6-4e91918af979';
const MODEL = 'Qwen3-VL-235B-A22B-Instruct';
const TIMEOUT_MS = 180_000;

function isMarkdownTableSeparatorCells(cells) {
  if (!cells.length) return true;
  return cells.every((c) => {
    const s = c.trim();
    if (!s) return true;
    return /^:?-{2,}:?$/.test(s);
  });
}

function splitPipeTableRowCells(line) {
  const t = line.trim();
  if (!t.includes('|')) return null;
  const cells = t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  if (cells.every((c) => !c)) return null;
  if (isMarkdownTableSeparatorCells(cells)) return null;
  if (cells.length >= 3) return cells;
  if (cells.length >= 2 && /^(ep\d+_|S\d+|sc\d+)/i.test(cells[0])) return cells;
  if (cells.length >= 2 && (t.startsWith('|') || t.endsWith('|'))) return cells;
  return null;
}

function isPipeTableMetadataLine(line) {
  const t = line.trim();
  if (!t || /^【续】/.test(t)) return false;
  return /^【[^】]+】/.test(t);
}

function isPipeTableSectionBreak(line) {
  return /^【续】/.test(line.trim());
}

function padRowsToMatrix(rows) {
  const w = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const out = [...r];
    while (out.length < w) out.push('');
    return out;
  });
}

function extractLoosePipeDelimitedTable(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (splitPipeTableRowCells(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const matrix = [];
  let end = start;
  let sawRow = false;
  while (end < lines.length) {
    const raw = lines[end];
    const t = raw.trim();
    if (!t) {
      end++;
      continue;
    }
    if (t.startsWith('```')) break;
    if (isPipeTableSectionBreak(t) && sawRow) break;
    const cells = splitPipeTableRowCells(raw);
    if (cells) {
      matrix.push(cells);
      sawRow = true;
      end++;
      continue;
    }
    if (isPipeTableMetadataLine(t) && matrix.length) {
      const last = matrix[matrix.length - 1];
      last[last.length - 1] = `${last[last.length - 1]}\n${t}`.trim();
      end++;
      continue;
    }
    if (sawRow) break;
    end++;
  }
  if (matrix.length < 1 || (matrix[0]?.length ?? 0) < 2) return null;
  if (matrix.length < 2 && (matrix[0]?.length ?? 0) < 3) return null;
  return { matrix: padRowsToMatrix(matrix), before: lines.slice(0, start).join('\n').trimEnd(), after: lines.slice(end).join('\n').trimStart() };
}

function parseSseLine(line) {
  const t = (line || '').trim();
  if (!t || t === '[DONE]') return null;
  return t.startsWith('data:') ? t.slice(5).trim() : t;
}

function getDelta(data) {
  const choice = data?.choices?.[0];
  const delta = choice?.delta;
  if (typeof delta?.content === 'string') return delta.content;
  return '';
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const prompt =
  '请严格按以下格式输出2个分镜镜头，不要前言后语，不要 Markdown 表头，每镜头一行 pipe 分隔，第二镜头下一行加【音效】说明：\n' +
  'ep001_sc001 | 15 | 增补镜头 | 特写 | 画面A | 情绪A | 声音A | 衔接A | 运镜A\n' +
  'ep001_sc002 | 15 | 增补镜头 | 中景 | 画面B | 情绪B | 声音B | 衔接B | 运镜B';

console.log('Qwen live smoke →', BASE);
const started = Date.now();
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);

let full = '';
try {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
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
        const data = JSON.parse(payload);
        full += getDelta(data);
      } catch {
        /* ignore */
      }
    }
  }
} catch (e) {
  ok('Qwen 流式请求', false, e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  clearTimeout(timer);
}

const elapsed = Date.now() - started;
ok('收到正文', full.trim().length > 40, `len=${full.length} elapsedMs=${elapsed}`);
console.log('  preview:', full.slice(0, 240).replace(/\n/g, '\\n'));

const ex = extractLoosePipeDelimitedTable(full);
ok('pipe 分镜解析成表', !!ex && ex.matrix.length >= 1, ex ? `rows=${ex.matrix.length}` : 'null');
ok('含 metadata 合并', !full.includes('【音效】') || (ex?.matrix.some((r) => r.join('').includes('【音效】')) ?? false));

console.log(`\n${pass} passed, ${fail} failed (${elapsed}ms)`);
process.exit(fail ? 1 : 0);
