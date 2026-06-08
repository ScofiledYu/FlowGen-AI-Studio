import fs from 'fs';
import ts from 'typescript';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split(/\n/);
const prefix = lines.slice(0, 4461).join('\n'); // through processImageUrl };

for (const end of [4550, 4600, 4635, 4655, 4680, 4700, 4735, 4740]) {
  const tail = lines.slice(4461, end).join('\n');
  const chunk = `${prefix}\n${tail}\n);\n});\n`;
  const sf = ts.createSourceFile('a.tsx', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const d = sf.parseDiagnostics;
  const first = d[0];
  let msg = '';
  if (first) {
    const p = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    msg = `${p.line + 1}:${p.character + 1} ${ts.flattenDiagnosticMessageText(first.messageText, '')}`;
  }
  console.log(`jsx end ${end}: diags=${d.length} ${msg}`);
}
