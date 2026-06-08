/**
 * node scripts/project-asset-preview-test.mjs
 */
import {
  canonicalProjectAssetFileUrl,
  resolveCanonicalProjectAssetPreviewUrl,
} from '../utils/projectAssetPreview.ts';

let pass = 0;
let fail = 0;
function ok(name, cond) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}`);
  if (cond) pass++;
  else fail++;
}

ok('canonical', canonicalProjectAssetFileUrl('p1', 'a1') === '/flowgen-api/projects/p1/assets/a1/file');
ok(
  'thumb → file',
  resolveCanonicalProjectAssetPreviewUrl('/flowgen-api/projects/p1/assets/a1/thumb', 'p1', 'a1').endsWith('/file')
);
ok(
  '仅 assetId',
  resolveCanonicalProjectAssetPreviewUrl('', 'p1', 'a1') === '/flowgen-api/projects/p1/assets/a1/file'
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
