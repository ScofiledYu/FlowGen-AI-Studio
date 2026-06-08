import fs from 'fs';
import ts from 'typescript';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const lines = fs.readFileSync(path, 'utf8').split(/\n/);

function parseSlice(endLine) {
  const chunk = lines.slice(0, endLine).join('\n') + '\n}); // synthetic close\n';
  const sf = ts.createSourceFile('slice.tsx', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return sf.parseDiagnostics.length;
}

let lo = 1500;
let hi = lines.length;
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  const n = parseSlice(mid);
  if (n === 0) lo = mid + 1;
  else hi = mid;
}
console.log('first bad line (approx)', lo, 'total', lines.length);
console.log('line', lo, lines[lo - 1]?.slice(0, 120));
