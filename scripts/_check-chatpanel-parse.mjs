import fs from 'fs';
import ts from 'typescript';

const path = 'd:/aaa/flowgen-ai-studio/components/ChatPanel.tsx';
const source = fs.readFileSync(path, 'utf8');
const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const diags = sf.parseDiagnostics;
for (const d of diags) {
  const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  console.log(`${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}
console.log('parseDiagnostics count', diags.length);
