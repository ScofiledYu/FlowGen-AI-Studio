/**
 * 下载成品 URL 优先级回归：imagesGenerations/videosGenerations 优先于 openApi。
 * 覆盖 resolvePreferredNodeDownloadUrl + pickMediaResourceUrlFromTaskStatus + preferPersistableResultUrl。
 * npx tsx scripts/download-result-url-ranking-test.ts
 */
import type { NodeData } from '../types.ts';
import { NodeType } from '../types.ts';
import {
  preferPersistableResultUrl,
  rankAitopPersistableResultUrl,
  resolvePreferredNodeDownloadUrl,
} from '../utils/generatedOutputUrl.ts';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

console.log('\n=== A. rankAitopPersistableResultUrl ===\n');
ok('imagesGenerations 排 300', rankAitopPersistableResultUrl('https://aitop100app.cos/imagesGenerations/a.png') === 300);
ok('videosGenerations 排 280', rankAitopPersistableResultUrl('https://aitop100app.cos/videosGenerations/a.mp4') === 280);
ok('openApi 排 50', rankAitopPersistableResultUrl('https://aitop100app.cos/openApi/212508/a.png') === 50);
ok('其它 https 排 100', rankAitopPersistableResultUrl('https://example.com/a.png') === 100);

console.log('\n=== B. preferPersistableResultUrl：imagesGenerations 优先于 openApi ===\n');
{
  const openApi = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/preview.png';
  const finalPng = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/d94dac8d.png';
  ok('生图成品优先', preferPersistableResultUrl([openApi, finalPng]) === finalPng);
  ok('blob 不优先于成品', preferPersistableResultUrl(['blob:http://x/y', finalPng]) === finalPng);
  ok('无成品时回退 openApi', preferPersistableResultUrl([openApi]) === openApi);
}

console.log('\n=== C. resolvePreferredNodeDownloadUrl：节点已有 outputUrl ===\n');
{
  const outputUrl = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/imagesGenerations/out.png';
  const openApiRef = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/ref.png';
  const data: Partial<NodeData> = {
    imagePreview: openApiRef,
    generationParams: { outputUrl, taskId: '1' },
  };
  ok('OUTPUT 节点优先 outputUrl', resolvePreferredNodeDownloadUrl(data, NodeType.OUTPUT) === outputUrl);
  ok('MOV 节点也优先 outputUrl', resolvePreferredNodeDownloadUrl(data, NodeType.MOV) === outputUrl);
  ok('INPUT 节点也优先 outputUrl', resolvePreferredNodeDownloadUrl(data, NodeType.INPUT) === outputUrl);
}

console.log('\n=== D. 无 outputUrl 时回退 imagePreview ===\n');
{
  const data: Partial<NodeData> = {
    imagePreview: 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/main.png',
  };
  ok('无 gp 时回退 imagePreview', resolvePreferredNodeDownloadUrl(data, NodeType.OUTPUT)?.includes('openApi/212508/main.png') === true);
}

console.log('\n=== E. video 成品优先于 openApi poster ===\n');
{
  const poster = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/297409/poster.jpg';
  const video = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/videosGenerations/out.mp4';
  ok('视频成品优先', preferPersistableResultUrl([poster, video]) === video);
}

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exit(1);
