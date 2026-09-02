/**
 * 回归门禁：改面板/引用/Details/运行链路后必须全绿才能算完成。
 * npm run test:gate
 */
import { spawnSync } from 'node:child_process';

const steps = [
  { label: 'vitest', cmd: 'npm', args: ['test', '--', '--run'] },
  { label: 'node-details', cmd: 'npm', args: ['run', 'test:node-details'] },
  { label: 'panel-refs', cmd: 'npm', args: ['run', 'test:panel-refs'] },
  { label: 'panel-partial-ref', cmd: 'npm', args: ['run', 'test:panel-partial-ref'] },
  { label: 'panel-main-slot', cmd: 'npm', args: ['run', 'test:panel-main-slot'] },
  { label: 'ggggttt-panel', cmd: 'npm', args: ['run', 'test:ggggttt-panel'] },
  { label: '444444-panel', cmd: 'npm', args: ['run', 'test:444444-panel'] },
  { label: 'oooopppp-panel', cmd: 'npm', args: ['run', 'test:oooopppp-panel'] },
  { label: '89908111222-omni-recovery', cmd: 'npm', args: ['run', 'test:89908111222-omni-recovery'] },
  { label: 'batch-run-schedule', cmd: 'npm', args: ['run', 'test:batch-run-schedule'] },
  { label: 'model-contract', cmd: 'npm', args: ['run', 'test:model-contract'] },
  { label: 'i2v-pipeline', cmd: 'npm', args: ['run', 'test:i2v-pipeline'] },
  { label: 'first-frame-panel', cmd: 'npm', args: ['run', 'test:first-frame-panel'] },
  { label: 'image2-panel-refs', cmd: 'npm', args: ['run', 'test:image2-panel-refs'] },
  { label: '778990-cat-church', cmd: 'npm', args: ['run', 'test:778990-cat-church'] },
  { label: 'image2-aspect-size', cmd: 'npm', args: ['run', 'test:image2-aspect-size'] },
  { label: 'download-task', cmd: 'npm', args: ['run', 'test:download-task'] },
  { label: 'download-url-ranking', cmd: 'npm', args: ['run', 'test:download-url-ranking'] },
  { label: 'panel-refresh-run-all', cmd: 'npm', args: ['run', 'test:panel-refresh-run-all'] },
  { label: 'banana-panel-clobber', cmd: 'npm', args: ['run', 'test:banana-panel-clobber'] },
  { label: 'run-error-no-stuck', cmd: 'npm', args: ['run', 'test:run-error-no-stuck'] },
  { label: 'at-mention-label-mismatch', cmd: 'npm', args: ['run', 'test:at-mention-label-mismatch'] },
  { label: 'panel-dedup-same-element', cmd: 'npm', args: ['run', 'test:panel-dedup-same-element'] },
  { label: '2026070802-omni-panel-dedup', cmd: 'npm', args: ['run', 'test:2026070802-omni-panel-dedup'] },
  { label: 'seedance-panel-slot0', cmd: 'npm', args: ['run', 'test:seedance-panel-slot0'] },
  { label: '2026070802-seedance-panel', cmd: 'npm', args: ['run', 'test:2026070802-seedance-panel'] },
  { label: '2026070802-kling-omni-panel', cmd: 'npm', args: ['run', 'test:2026070802-kling-omni-panel'] },
  { label: 'kling-omni-tab-isolation', cmd: 'npm', args: ['run', 'test:kling-omni-tab-isolation'] },
  { label: 'frame-model-switch-isolation', cmd: 'npm', args: ['run', 'test:frame-model-switch-isolation'] },
  { label: 'panel-switch-broken-urls', cmd: 'npm', args: ['run', 'test:panel-switch-broken-urls'] },
  { label: 'all-models-three-requirements', cmd: 'npm', args: ['run', 'test:all-models-three-requirements'] },
  { label: '20260709-seedance-ref-images', cmd: 'npm', args: ['run', 'test:20260709-seedance-ref-images'] },
  { label: '20260709-seedance-video1-mention', cmd: 'npm', args: ['run', 'test:20260709-seedance-video1-mention'] },
  { label: '20260709-seedance-main-dup-ref-panel', cmd: 'npm', args: ['run', 'test:20260709-seedance-main-dup-ref-panel'] },
  { label: '20260709-all-models-main-dup-ref-panel', cmd: 'npm', args: ['run', 'test:20260709-all-models-main-dup-ref-panel'] },
  { label: '20260710-seedance-asset-thumb', cmd: 'npm', args: ['run', 'test:20260710-seedance-asset-thumb'] },
  { label: '20260710-all-models-asset-thumb', cmd: 'npm', args: ['run', 'test:20260710-all-models-asset-thumb'] },
  { label: '20260710-banana-panel-loss', cmd: 'npm', args: ['run', 'test:20260710-banana-panel-loss'] },
  { label: '20260710-banana-restore-dup', cmd: 'npm', args: ['run', 'test:20260710-banana-restore-dup'] },
  { label: '20260710-four-mention-all-models', cmd: 'npm', args: ['run', 'test:20260710-four-mention-all-models'] },
  { label: '20260710-asset-main-all-models', cmd: 'npm', args: ['run', 'test:20260710-asset-main-all-models'] },
  { label: '20260710-banana-run-gp-at-mention', cmd: 'npm', args: ['run', 'test:20260710-banana-run-gp-at-mention'] },
  { label: '20260710-asset-mention-details-recovery', cmd: 'npm', args: ['run', 'test:20260710-asset-mention-details-recovery'] },
  { label: '20260713-export-json-main-image', cmd: 'npm', args: ['run', 'test:20260713-export-json-main-image'] },
  { label: '20260714-seedance-reference-consistency', cmd: 'npm', args: ['run', 'test:20260714-seedance-reference-consistency'] },
  { label: '20260715-seedance-unreferenced-filter', cmd: 'npm', args: ['run', 'test:20260715-seedance-unreferenced-filter'] },
  { label: 'text-gen-node', cmd: 'npm', args: ['run', 'test:text-gen-node'] },
  { label: 'parallel-run-partial-failure', cmd: 'npm', args: ['run', 'test:parallel-run-partial-failure'] },
  { label: 'run-error-panel-rollback', cmd: 'npm', args: ['run', 'test:run-error-panel-rollback'] },
  { label: 'run-error-hydrate-blob-recovery', cmd: 'npm', args: ['run', 'test:run-error-hydrate-blob-recovery'] },
  // §10.73 全模型刷新后 blob 持久化回归（防回归 image2 timing-race / 资产绑定 / cross-model）
  { label: 'all-models-refresh-blob-persistence', cmd: 'npm', args: ['run', 'test:all-models-refresh-blob-persistence'] },
  { label: 'cross-model-no-run-refresh-blob', cmd: 'npm', args: ['run', 'test:cross-model-no-run-refresh-blob'] },
  { label: 'image2-timing-race-blob-loss', cmd: 'npm', args: ['run', 'test:image2-timing-race-blob-loss'] },
  { label: 'image2-asset-binding-blob-loss', cmd: 'npm', args: ['run', 'test:image2-asset-binding-blob-loss'] },
  { label: 'node-main-drag-normalize-override', cmd: 'npm', args: ['run', 'test:node-main-drag-normalize-override'] },
  // §10.75 attachLocalReferenceRefs 移除 projectAssetId 守卫 → 资产库节点参考图可备份到 IDB（防回归）
  { label: 'attach-local-reference-refs-backup', cmd: 'npm', args: ['run', 'test:attach-local-reference-refs-backup'] },
  // §11.90q Nano Banana 2.0 模型切换后主图丢失（防回归：imagePreview=undefined + imageLocalRef 存在时不继承失效 blob）
  { label: 'nano-model-switch-main-loss', cmd: 'npm', args: ['run', 'test:nano-model-switch-main-loss'] },
  // §11.90r movNode/OUTPUT 拖入图片覆盖主视频（防回归：已有主视频时不进入首张做主图分支）
  { label: 'mov-node-drag-image-no-clobber-video', cmd: 'npm', args: ['run', 'test:mov-node-drag-image-no-clobber-video'] },
  // §11.90u 面板图片隔离 & 主图持久化（防回归：image2/Omni 拖图后切模型主图丢失、跨模型参考图泄漏）
  { label: 'panel-image-isolation-guard', cmd: 'npm', args: ['run', 'test:panel-image-isolation-guard'] },
  // §16 Seedance 2.5：taskType/normal/视频编辑/视频延长 API 参数 + 联网搜索禁用 + prompt 引用（防回归）
  { label: 'seedance25-api-mock', cmd: 'npm', args: ['run', 'test:seedance25-api-mock'] },
  // §16.24 4K HEVC 成片：transcodedVideo 提取 + 恢复路径 gp 写入（防回归）
  { label: 'transcoded-video-url', cmd: 'npm', args: ['run', 'test:transcoded-video-url'] },
  // §16.26 MOV 中间节点运行中刷新恢复：已有成片不被新产出覆盖（防回归）
  { label: 'mov-recovery-keep-original', cmd: 'npm', args: ['run', 'test:mov-recovery-keep-original'] },
];

console.log('=== FlowGen test:gate（回归门禁）===\n');

for (const step of steps) {
  console.log(`--- [gate] ${step.label} ---`);
  const result = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n❌ test:gate 失败于: ${step.label}`);
    process.exit(result.status || 1);
  }
}

console.log('\n✅ test:gate 全部通过');
