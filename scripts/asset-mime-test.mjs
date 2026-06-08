/**
 * node scripts/asset-mime-test.mjs
 */
import { isImageAssetMime, normalizeAssetMime } from '../utils/assetMime.ts';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}`);
  if (cond) pass++;
  else fail++;
}

ok('png octet-stream', normalizeAssetMime('application/octet-stream', '美女.png') === 'image/png');
ok('is image', isImageAssetMime('application/octet-stream', 'a.PNG'));
ok('real video', !isImageAssetMime('video/mp4', 'a.mp4'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
