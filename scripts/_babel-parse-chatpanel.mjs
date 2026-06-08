import fs from 'fs';
import parser from '@babel/parser';

const code = fs.readFileSync('d:/aaa/flowgen-ai-studio/components/ChatPanel.tsx', 'utf8');
try {
  parser.parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  console.log('babel OK');
} catch (e) {
  console.log('babel error', e.message);
  if (e.loc) console.log('loc', e.loc);
}
