import fs from 'fs';
import parser from '@babel/parser';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
const prefix = lines.slice(0, 1509).join('\n');
for (const end of [1510, 1520, 1550, 1600, 1640, 1647, 1648]) {
  const chunk = `${prefix}\n${lines.slice(1509, end).join('\n')}`;
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    console.log(end, 'OK');
  } catch (e) {
    console.log(end, e.message, 'at', e.loc?.line, e.loc?.column);
  }
}
