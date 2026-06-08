/**
 * Removes top-level console.log / warn / error / info / debug *statement lines*
 * (lines starting with optional whitespace then console.(...).
 * Multiline calls: skips continuation until parens balance.
 * index.tsx: only removes unhandledrejection console (keeps ResizeObserver console.error shim).
 * Does NOT modify services/aitop.ts (handled manually: keep logPreloadJson console.info only).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const targets = [
  'components/FlowEditor.tsx',
  'components/ChatPanel.tsx',
  'components/NodeInspector.tsx',
  'components/Sidebar.tsx',
  'components/ErrorBoundary.tsx',
  'utils/imageRatio.ts',
  'utils/videoThumbnail.ts',
  'test-kling-video.ts',
];

function skipConsoleStatement(lines, startIdx) {
  let i = startIdx;
  let open = (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
  while (open > 0 && i + 1 < lines.length) {
    i++;
    open += (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
  }
  return i;
}

function stripGeneric(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*console\.(log|warn|error|info|debug)\(/.test(line)) {
      i = skipConsoleStatement(lines, i);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function stripIndexTsx(src) {
  return src.replace(
    /window\.addEventListener\('unhandledrejection',\s*\(e\)\s*=>\s*\{\s*console\.error\('\[unhandledrejection\]',\s*e\.reason\);\s*\}\);/,
    "window.addEventListener('unhandledrejection', () => { /* intentionally quiet */ });"
  );
}

for (const rel of targets) {
  const fp = path.join(root, rel);
  const src = fs.readFileSync(fp, 'utf8');
  fs.writeFileSync(fp, stripGeneric(src), 'utf8');
  process.stderr.write(`Stripped: ${rel}\n`);
}

const idx = path.join(root, 'index.tsx');
let idxSrc = fs.readFileSync(idx, 'utf8');
idxSrc = stripIndexTsx(stripGeneric(idxSrc));
fs.writeFileSync(idx, idxSrc, 'utf8');
process.stderr.write('Stripped: index.tsx\n');
