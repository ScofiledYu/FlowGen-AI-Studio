import fs from 'fs';
import parser from '@babel/parser';

const lines = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8').split('\n');
for (const end of [1500, 1510, 1520, 1600, 1640, 1647]) {
  const chunk = lines.slice(0, end).join('\n');
  try {
    parser.parse(chunk, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    console.log(end, 'OK');
  } catch (e) {
    console.log(end, e.message, e.loc?.line, e.loc?.column);
  }
}
