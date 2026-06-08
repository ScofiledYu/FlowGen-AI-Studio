import fs from 'fs';
import parser from '@babel/parser';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
const head = lines.slice(0, 1664).join('\n'); // include ) => {
const tailClose = '\n});\n';

for (const end of [1700, 2000, 2500, 5130]) {
  const body = lines.slice(1664, end).join('\n');
  const chunk = `${head}\n${body}${tailClose}`;
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    console.log(end, 'OK');
  } catch (e) {
    console.log(end, e.message, 'at', e.loc?.line, e.loc?.column);
  }
}
