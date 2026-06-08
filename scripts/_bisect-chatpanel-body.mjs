import fs from 'fs';
import ts from 'typescript';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
const head = lines.slice(0, 1663).join('\n');
const tailClose = '\n});\n';

function check(endLine) {
  const body = lines.slice(1663, endLine).join('\n');
  const chunk = `${head}\n${body}${tailClose}`;
  const sf = ts.createSourceFile('t.tsx', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const d = sf.parseDiagnostics[0];
  if (!d) return { ok: true };
  const p = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  return {
    ok: false,
    msg: `${p.line + 1}:${p.character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '')}`,
  };
}

for (const end of [2000, 2500, 3000, 3500, 4000, 4500, 5000, 5130]) {
  const r = check(end);
  console.log(end, r.ok ? 'OK' : r.msg);
}
