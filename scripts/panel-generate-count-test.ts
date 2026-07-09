/**
 * 面板 numberOfImages → 生成数量解析回归（§ generate-count）
 */
import assert from 'node:assert/strict';
import {
  parsePanelGenerateCount,
  resolvePanelGenerateCount,
} from '../utils/panelGenerateCount';

function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log('panel-generate-count-test');

ok('image2 2张', () => {
  assert.equal(parsePanelGenerateCount('2张'), 2);
});

ok('可灵 3条 capped', () => {
  assert.equal(parsePanelGenerateCount('3条'), 3);
  assert.equal(parsePanelGenerateCount('8条'), 4);
});

ok('modelConfigs fallback', () => {
  assert.equal(
    resolvePanelGenerateCount({
      selectedModel: 'vidu 2.0',
      modelConfigs: { 'vidu 2.0': { numberOfImages: '4条' } },
    }),
    4
  );
});

console.log('\nAll panel-generate-count tests passed.');
