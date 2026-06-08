import fs from 'fs';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const s = fs.readFileSync(path, 'utf8');
let i = 0;
let line = 1;
let col = 0;
let inBlock = false;
let blockStart = 0;
const issues = [];
const opens = [];
const closes = [];

while (i < s.length) {
  const c = s[i];
  if (c === '\n') {
    line++;
    col = 0;
    i++;
    continue;
  }
  col++;
  if (!inBlock && c === '/' && s[i + 1] === '*') {
    inBlock = true;
    blockStart = line;
    opens.push(line);
    i += 2;
    continue;
  }
  if (inBlock && c === '*' && s[i + 1] === '/') {
    inBlock = false;
    closes.push(line);
    i += 2;
    continue;
  }
  i++;
}
console.log('opens', opens.length, 'closes', closes.length, 'inBlock at EOF', inBlock);
if (inBlock) console.log('unclosed block from line', blockStart);
if (closes.length > opens.length) {
  console.log('extra closes at lines', closes.slice(opens.length));
}
if (opens.length > closes.length) {
  console.log('unclosed opens from lines', opens.slice(closes.length));
}
