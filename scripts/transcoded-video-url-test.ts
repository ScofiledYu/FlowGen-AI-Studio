/**
 * 转码版 URL（transcodedVideo）防回归测试（§16.24）
 *
 * 背景：seedance2.0 (4k版) 成分为 HEVC Main 10（浏览器无法在线播放），
 * AiTop 网关仅对 HEVC 源任务返回 transcodedVideo（H.264 1080p）；
 * H.264 原生任务该字段为 null（videoJobStatus=IGNORE）。
 * 策略：预览 = transcodedVideo ?? resourceUrl；下载 = resourceUrl 始终原版。
 *
 * 覆盖：
 * 1) pickTranscodedVideoUrlFromTaskStatus 提取逻辑（有值/null/缺失/非字符串/空串/非对象）
 * 2) applyRecoveryToOutputNode 第 5 参写入 gp.transcodedVideoUrl，imagePreview 仍原版
 *
 * 运行：npx tsx scripts/transcoded-video-url-test.ts
 */
import { pickTranscodedVideoUrlFromTaskStatus, isTranscodedPairOfOriginal } from '../utils/taskStatusVideoUrl.ts';
import { applyRecoveryToOutputNode } from '../utils/runRecovery.ts';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  [OK] ${label}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}`);
  }
}

const COS_ORIGINAL =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/50a8d210-dfab-4d4f-87e5-549618d1d47f.mp4';
const COS_TRANSCODED =
  'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/transcode-50a8d210-dfab-4d4f-87e5-549618d1d47f.mp4';

console.log('\n=== 场景 1：pickTranscodedVideoUrlFromTaskStatus 提取 ===\n');
{
  ok(
    '有 transcodedVideo 字符串 → 返回',
    pickTranscodedVideoUrlFromTaskStatus({ transcodedVideo: COS_TRANSCODED }) === COS_TRANSCODED
  );
  ok(
    'transcodedVideo = null（H.264 原生任务）→ undefined',
    pickTranscodedVideoUrlFromTaskStatus({ transcodedVideo: null }) === undefined
  );
  ok(
    '字段缺失 → undefined',
    pickTranscodedVideoUrlFromTaskStatus({ resourceUrl: COS_ORIGINAL }) === undefined
  );
  ok(
    '非字符串（number）→ undefined',
    pickTranscodedVideoUrlFromTaskStatus({ transcodedVideo: 123 }) === undefined
  );
  ok(
    '空串/空白 → undefined',
    pickTranscodedVideoUrlFromTaskStatus({ transcodedVideo: '   ' }) === undefined
  );
  ok(
    'statusData 非对象（null / string）→ undefined',
    pickTranscodedVideoUrlFromTaskStatus(null) === undefined &&
      pickTranscodedVideoUrlFromTaskStatus('x') === undefined
  );
  ok(
    '前后空白自动 trim',
    pickTranscodedVideoUrlFromTaskStatus({ transcodedVideo: `  ${COS_TRANSCODED}  ` }) ===
      COS_TRANSCODED
  );
}

console.log('\n=== 场景 2：applyRecoveryToOutputNode 转码版写入 gp ===\n');
{
  const baseNode = {
    id: 'mov1',
    type: 'movNode',
    position: { x: 0, y: 0 },
    data: {
      selectedModel: 'seedance2.0 (4k版)',
      generationParams: { model: 'seedance2.0 (4k版)' },
      status: 'running',
      progress: 40,
    },
  } as never;

  // 2a. 传第 5 参：gp.transcodedVideoUrl 写入，imagePreview 仍原版 4K
  const withTranscoded = applyRecoveryToOutputNode(
    [baseNode],
    'mov1',
    [COS_ORIGINAL],
    '1985892',
    COS_TRANSCODED
  ) as Array<{ data: Record<string, never> & { imagePreview?: string; generationParams?: Record<string, unknown> } }>;
  const d1 = withTranscoded[0].data;
  ok('恢复后 imagePreview = 原版 4K（下载链路不受影响）', d1.imagePreview === COS_ORIGINAL);
  ok(
    'gp.transcodedVideoUrl 写入转码版',
    d1.generationParams?.transcodedVideoUrl === COS_TRANSCODED
  );
  ok('gp.outputUrl 不被恢复路径误写（保持无）', !('outputUrl' in (d1.generationParams || {})));

  // 2b. 不传第 5 参（H.264 任务无转码版）：gp 无 transcodedVideoUrl 字段
  const withoutTranscoded = applyRecoveryToOutputNode(
    [baseNode],
    'mov1',
    [COS_ORIGINAL],
    '1988249'
  ) as Array<{ data: { generationParams?: Record<string, unknown> } }>;
  ok(
    '不传第 5 参 → gp 无 transcodedVideoUrl 字段（行为与旧版一致）',
    !('transcodedVideoUrl' in (withoutTranscoded[0].data.generationParams || {}))
  );

  // 2c. mediaUrls 为空：节点不变
  const unchanged = applyRecoveryToOutputNode([baseNode], 'mov1', [], '1') as unknown[];
  ok('mediaUrls 为空 → 节点数组原样返回', unchanged.length === 1);
}

console.log('\n=== 场景 3：isTranscodedPairOfOriginal 同源校验（§16.27）===\n');
{
  const ORIGINAL_4K =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/d3fad18b-695f-41ff-bd7a-fcb91e55dbea.mp4';
  const TRANSCODED_4K =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/transcode-d3fad18b-695f-41ff-bd7a-fcb91e55dbea.mp4';
  const OTHER_VIDEO =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/81ef909e-3dd6-4167-806b-a61c4b513992.mp4';
  const TRANSCODED_OTHER =
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/videosGenerations/transcode-7e5e9315-fa47-47dc-be62-57549098dbdb.mp4';

  ok('同一片源 transcode-{uuid} ↔ {uuid} → true', isTranscodedPairOfOriginal(TRANSCODED_4K, ORIGINAL_4K) === true);
  ok('带 query 的转码版 → true', isTranscodedPairOfOriginal(TRANSCODED_4K + '?sign=x', ORIGINAL_4K) === true);
  ok('带 hash 的转码版 → true', isTranscodedPairOfOriginal(TRANSCODED_4K + '#t=1', ORIGINAL_4K) === true);
  ok(
    'MOV 再生错位：转码版属新产出 vs 原视频 → false（6666.json 场景）',
    isTranscodedPairOfOriginal(TRANSCODED_OTHER, OTHER_VIDEO) === false
  );
  ok('转码版 vs 完全不同 URL → false', isTranscodedPairOfOriginal(TRANSCODED_4K, OTHER_VIDEO) === false);
  ok('原片 URL（无 transcode- 前缀）→ false', isTranscodedPairOfOriginal(ORIGINAL_4K, ORIGINAL_4K) === false);
  ok('transcoded 为空 → false', isTranscodedPairOfOriginal(undefined, ORIGINAL_4K) === false);
  ok('original 为空 → false', isTranscodedPairOfOriginal(TRANSCODED_4K, undefined) === false);
  ok('original 为图片（不含 uuid）→ false', isTranscodedPairOfOriginal(TRANSCODED_4K, 'https://example.com/a.png') === false);
}

console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);
if (failed > 0) process.exit(1);
