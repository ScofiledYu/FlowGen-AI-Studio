import fs from 'fs';
import parser from '@babel/parser';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
const head = lines.slice(0, 1663).join('\n');
const tailClose = '\n});\n';

for (const end of [2500, 3500, 4500, 5130]) {
  const body = lines.slice(1663, end).join('\n');
  const chunk = `${head}\n${body}${tailClose}`;
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    console.log(end, 'OK');
  } catch (e) {
    console.log(end, e.message, 'at', e.loc?.line, e.loc?.column);
  }
}
