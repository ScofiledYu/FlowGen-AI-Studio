/**
 * 校验欢迎语已汉化（源码 + 可选 dist）
 * Run: node scripts/test-welcome-message.mjs
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync('components/ChatPanel.tsx', 'utf8');
let ok = true;

const hasWelcome =
  src.includes('您好！我是AI对话助手') &&
  src.includes('引用节点') &&
  !src.includes("'?????AI");
if (!hasWelcome) {
  console.error('FAIL: ChatPanel.tsx 欢迎语缺失或仍为乱码');
  ok = false;
} else {
  console.log('OK: 源码欢迎语');
}

const distDir = 'dist/assets';
if (fs.existsSync(distDir)) {
  const js = fs.readdirSync(distDir).find((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (js) {
    const bundle = fs.readFileSync(path.join(distDir, js), 'utf8');
    if (!bundle.includes('您好') || !bundle.includes('AI对话助手')) {
      console.error('FAIL: dist bundle 未包含欢迎语中文');
      ok = false;
    } else {
      console.log('OK: dist bundle', js);
    }
  }
}

process.exit(ok ? 0 : 1);
