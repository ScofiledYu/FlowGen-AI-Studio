/**
 * 模拟测试：下载链路（domainAccount 透传、proxy-image 视频改走 proxy-file）
 * 不调用 AITOP 生图/生视频 API；可选对本地 server 做 HTTP 冒烟。
 *
 * npx tsx scripts/download-task-simulation-test.ts
 * npx tsx scripts/download-task-simulation-test.ts --live http://localhost:3001
 */
import {
  buildDownloadTaskFileUrl,
  buildAitopBillingQuery,
  setAitopBillingContext,
} from '../utils/aitopBilling.ts';
import {
  resolveDownloadFetchUrl,
  resolveInnerMediaUrl,
  isVideoLikeMediaUrl,
  remoteMediaUrlPreferSameOriginProxy,
} from '../utils/remoteMediaFetch.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

function eq(actual: unknown, expected: unknown, name: string) {
  const sa = JSON.stringify(actual);
  const se = JSON.stringify(expected);
  ok(name, sa === se, sa !== se ? `got ${sa} want ${se}` : undefined);
}

const SAMPLE_MP4 =
  'https://aitop100app-1234567890.cos.ap-guangzhou.myqcloud.com/output/test.mp4?sign=abc';
const SAMPLE_PNG =
  'https://aitop100app-1234567890.cos.ap-guangzhou.myqcloud.com/output/test.png?sign=abc';

console.log('\n=== 1. buildDownloadTaskFileUrl / billing query ===');
setAitopBillingContext({ domainAccount: 'zhangsan', scoreProjectId: 'proj-99' });
eq(
  buildDownloadTaskFileUrl('1378659'),
  '/download-task-file?taskId=1378659&domainAccount=zhangsan&scoreProjectId=proj-99',
  'task url carries domainAccount + scoreProjectId'
);
eq(
  buildAitopBillingQuery(),
  '&domainAccount=zhangsan&scoreProjectId=proj-99',
  'billing query matches task-status style'
);
eq(buildDownloadTaskFileUrl(''), '', 'empty taskId → empty url');
setAitopBillingContext(null);
eq(buildDownloadTaskFileUrl('123'), '/download-task-file?taskId=123', 'no billing context → taskId only');

console.log('\n=== 2. resolveDownloadFetchUrl (proxy-image 504 规避) ===');
const proxyImageVideo = `/proxy-image?url=${encodeURIComponent(SAMPLE_MP4)}`;
const resolvedVideo = resolveDownloadFetchUrl(proxyImageVideo);
ok(
  'proxy-image + mp4 → /proxy-file',
  resolvedVideo.startsWith('/proxy-file?url='),
  resolvedVideo
);
ok('must not keep proxy-image for video download', !resolvedVideo.includes('/proxy-image'));

const proxyImagePng = `/proxy-image?url=${encodeURIComponent(SAMPLE_PNG)}`;
const resolvedPng = resolveDownloadFetchUrl(proxyImagePng);
ok(
  'proxy-image + remote png → /proxy-file (COS)',
  resolvedPng.startsWith('/proxy-file?url='),
  resolvedPng
);

eq(resolveDownloadFetchUrl(SAMPLE_MP4), `/proxy-file?url=${encodeURIComponent(SAMPLE_MP4)}`, 'remote mp4 direct → proxy-file');
eq(resolveDownloadFetchUrl('blob:http://localhost/abc'), 'blob:http://localhost/abc', 'blob passthrough');
eq(resolveDownloadFetchUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc', 'data passthrough');

console.log('\n=== 3. resolveInnerMediaUrl / isVideoLikeMediaUrl ===');
eq(resolveInnerMediaUrl(proxyImageVideo), SAMPLE_MP4, 'unwrap nested proxy-image');
ok('proxy-image wrapped mp4 is video-like', isVideoLikeMediaUrl(proxyImageVideo));
ok('png is not video-like', !isVideoLikeMediaUrl(SAMPLE_PNG));
ok('COS url prefers proxy', remoteMediaUrlPreferSameOriginProxy(SAMPLE_MP4));

console.log('\n=== 4. CustomNode 下载决策模拟 ===');
function simulateCustomNodeDownload(opts: {
  taskId?: string;
  imagePreview: string;
  billing?: { domainAccount?: string };
}): { taskUrl: string; fallbackFetchUrl: string } {
  setAitopBillingContext(opts.billing ?? null);
  const latestTaskId = String(opts.taskId || '').trim();
  const taskUrl = latestTaskId ? buildDownloadTaskFileUrl(latestTaskId) : '';
  const fallbackFetchUrl = resolveDownloadFetchUrl(opts.imagePreview);
  return { taskUrl, fallbackFetchUrl };
}

const sim1 = simulateCustomNodeDownload({
  taskId: '1378659',
  imagePreview: proxyImageVideo,
  billing: { domainAccount: 'lisi' },
});
ok('CustomNode task download includes domainAccount', sim1.taskUrl.includes('domainAccount=lisi'));
ok('CustomNode fallback avoids proxy-image for video', sim1.fallbackFetchUrl.startsWith('/proxy-file?'));

const sim2 = simulateCustomNodeDownload({
  imagePreview: SAMPLE_MP4,
});
ok('no taskId → skip task download', !sim2.taskUrl);
ok('no taskId → proxy-file for remote mp4', sim2.fallbackFetchUrl.startsWith('/proxy-file?'));

async function liveSmoke(base: string) {
  console.log(`\n=== 5. HTTP 冒烟 (${base}) ===`);
  try {
    const bad = await fetch(`${base}/download-task-file`);
    ok('missing taskId → 400', bad.status === 400, String(bad.status));

    const noBilling = await fetch(`${base}/download-task-file?taskId=fake-task-id-for-smoke`);
    ok(
      'fake taskId → non-200 (expected upstream miss)',
      noBilling.status === 404 || noBilling.status === 502 || noBilling.status === 500,
      String(noBilling.status)
    );

    const withBilling = await fetch(
      `${base}/download-task-file?taskId=fake-task-id-for-smoke&domainAccount=smoke-test-user`
    );
    ok(
      'fake taskId + domainAccount → non-200 (endpoint accepts param)',
      withBilling.status === 404 || withBilling.status === 502 || withBilling.status === 500,
      String(withBilling.status)
    );

    const taskStatus = await fetch(
      `${base}/task-status?taskId=fake&domainAccount=smoke-test-user`
    );
    ok(
      'task-status with domainAccount responds',
      typeof taskStatus.status === 'number' && taskStatus.status > 0,
      String(taskStatus.status)
    );
  } catch (e) {
    ok('live smoke reachable', false, e instanceof Error ? e.message : String(e));
  }
}

const liveArg = process.argv.find((a) => a.startsWith('--live'));
if (liveArg) {
  const base = liveArg.includes('=') ? liveArg.split('=')[1] : process.argv[process.argv.indexOf(liveArg) + 1] || 'http://localhost:3001';
  await liveSmoke(base.replace(/\/$/, ''));
} else {
  console.log('\n=== 5. HTTP 冒烟 (skipped, pass --live http://localhost:3001 to enable) ===');
}

console.log(`\n--- download-task-simulation: ${pass} passed, ${fail} failed ---\n`);
if (fail > 0) process.exit(1);
