import fs from 'fs';
import ts from 'typescript';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split(/\n/);

for (const end of [2000, 2500, 3000, 3500, 4000, 4461, 4700, 4900, 5000, 5109]) {
  const chunk = lines.slice(1645, end).join('\n');
  const sf = ts.createSourceFile('a.tsx', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const d = sf.parseDiagnostics;
  const first = d[0];
  let msg = '';
  if (first) {
    const p = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    msg = `${p.line + 1}:${p.character + 1} ${ts.flattenDiagnosticMessageText(first.messageText, '')}`;
  }
  console.log(`to ${end}: diags=${d.length} ${msg}`);
}
