import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fp = path.join(__dirname, '..', 'services', 'aitop.ts');
const MARK = '/*__FLOWGEN_PRELOAD_LOG_FN__*/';
const preserved = `function logPreloadJson(payload: Record<string, unknown>) {
  if (!isPreloadDebugEnabled()) return;
  console.info(JSON.stringify(payload, null, 2));
}`;
let s = fs.readFileSync(fp, 'utf8');
if (!s.includes(preserved)) {
  process.stderr.write('clean-aitop-console: preserved block not found, abort\n');
  process.exit(1);
}
s = s.replace(preserved, MARK);
const lines = s.split(/\r?\n/);
const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*console\.(log|warn|error|info|debug)\(/.test(line)) {
    let j = i;
    let open = (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
    while (open > 0 && j + 1 < lines.length) {
      j++;
      open += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
    }
    i = j;
    continue;
  }
  out.push(line);
}
s = out.join('\n').replace(MARK, preserved);
fs.writeFileSync(fp, s, 'utf8');
process.stderr.write('clean-aitop-console: done\n');
