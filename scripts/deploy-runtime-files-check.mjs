/**
 * 发版前检查：开发机工作区与服务器应拷贝的运行时文件是否齐全。
 * 不改业务逻辑；漏文件会导致「开发能跑、部署挂」。
 *
 * 用法: node scripts/deploy-runtime-files-check.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED = [
  'server.js',
  'promptPlaceholders.mjs',
  'package.json',
  'server/flowgen/routes.mjs',
  'server/flowgen/db.mjs',
  'server/flowgen/jwt.mjs',
  'server/flowgen/workspacePayloadCodec.mjs',
  'server/flowgen/repos/workspaceRepo.mjs',
  'utils/taskStatusMediaUrl.mjs',
  'utils/persistSanitize.mjs',
  'utils/aitopChatModels.ts',
  'utils/klingOmniTabPanelIsolation.ts',
  'utils/inspectorReferenceDropQueue.ts',
  'utils/image2PanelRefs.ts',
  'utils/localNodeMediaStore.ts',
  'utils/referencedMediaRun.ts',
  'utils/nodeDetailsPreview.ts',
  'utils/webSearchProbe.ts',
  'components/flowgen/FlowgenMiniMap.tsx',
  'components/FlowEditor.tsx',
  'components/NodeInspector.tsx',
  'components/ChatPanel.tsx',
  'dist/index.html',
];

let fail = 0;
for (const rel of REQUIRED) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error(`[MISSING] ${rel}`);
    fail++;
  } else {
    console.log(`[OK] ${rel}`);
  }
}

const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  const text = fs.readFileSync(envLocal, 'utf8');
  if (/^\s*FLOWGEN_JWT_SECRET\s*=\s*\S+/m.test(text)) {
    console.log('[OK] .env.local 含 FLOWGEN_JWT_SECRET');
  } else {
    console.error('[MISSING] .env.local 未设置 FLOWGEN_JWT_SECRET（生产/开发均须设置）');
    fail++;
  }
} else {
  console.warn('[WARN] 无 .env.local（服务器上必须自备，勿从开发机覆盖生产密钥）');
}

if (fail > 0) {
  console.error(`\ndeploy-runtime-files-check: FAIL (${fail})`);
  process.exit(1);
}
console.log('\ndeploy-runtime-files-check: OK');
