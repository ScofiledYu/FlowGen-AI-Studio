import fs from 'fs';
const lines = fs.readFileSync('components/ChatPanel.tsx', 'utf8').split('\n');
for (let i = 1560; i <= 1568; i++) {
  const t = lines[i];
  console.log(i + 1, 'prev=', lines[i - 1]?.trim(), 'match=', lines[i - 1]?.trim() === 'content:', t.trim().startsWith("'"), /AI/.test(t));
}
