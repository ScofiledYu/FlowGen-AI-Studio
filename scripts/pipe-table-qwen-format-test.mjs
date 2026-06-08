/**
 * Qwen 分镜 pipe 行 + 【音效】穿插 → 表格解析回归
 * node scripts/pipe-table-qwen-format-test.mjs
 */

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

  return {
    matrix: padRowsToMatrix(matrix),
    before: lines.slice(0, start).join('\n').trimEnd(),
    after: lines.slice(end).join('\n').trimStart(),
  };
}

const qwenSample = `以下是分镜脚本：

ep003_seq013_sc001 | 15 | 增补镜头 | 特写/低角度 | 萧逍触碰魔方 | 压抑→好奇 | 【环境音】雨声 | 【视线引导】 | 缓推
【音效】金属碰撞声
【音效桥接+动作顺接】

ep003_seq013_sc002 | 15 | 增补镜头 | 中景/平视 | 魔方旋转 | 紧张 | 【配乐】低鼓 | 【动作顺接】 | 横摇
【音效】粒子扩散

【续】

| 镜头编号 | 时长 | 画面 |
|---|---|---|
| S001 | 15 | 续篇镜头 |`;

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

const ex = extractLoosePipeDelimitedTable(qwenSample);
ok('解析 Qwen pipe 分镜块', !!ex && ex.matrix.length === 2, ex ? `rows=${ex.matrix.length} cols=${ex.matrix[0]?.length}` : 'null');
ok('首行镜头 ID', ex?.matrix[0]?.[0] === 'ep003_seq013_sc001');
ok('metadata 并入末列', (ex?.matrix[0]?.[ex.matrix[0].length - 1] || '').includes('【音效】'));
ok('【续】后内容保留在 after', (ex?.after || '').includes('S001'));
ok('before 保留导语', (ex?.before || '').includes('以下是分镜'));

const singleRow = `ep003_seq001_sc001 | 15 | 增补镜头 | 特写 | 画面描述很长 | 情绪 | 声音 | 衔接 | 运镜`;
const ex2 = extractLoosePipeDelimitedTable(singleRow);
ok('单行多列也成表', !!ex2 && ex2.matrix.length === 1 && ex2.matrix[0].length >= 8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
