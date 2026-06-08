import fs from 'fs';
import ts from 'typescript';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
const head = lines.slice(0, 1663).join('\n');
const stub = '  return null;\n});\n';
const chunk = `${head}\n${stub}`;
const sf = ts.createSourceFile('t.tsx', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const d of sf.parseDiagnostics) {
  const p = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  console.log(`${p.line + 1}:${p.character + 1}`, ts.flattenDiagnosticMessageText(d.messageText, ''));
}
console.log('count', sf.parseDiagnostics.length);
