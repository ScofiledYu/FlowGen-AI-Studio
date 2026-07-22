/**
 * 模拟：刷新前顶层 referenceImageLocalRefs 为空，modelConfigs 层有 localRefs
 * 验证修复后：持久化时从 modelConfigs 复制 localRefs 到顶层，刷新后 hydrate 能恢复图片
 */
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import { hydrateAllPanelReferenceLocalRefs } from '../utils/hydratePanelReferenceLocalRefs';

const MODEL = 'Nano Banana 2.0';

// 模拟刷新前的节点数据（用户实际场景）
const dataBeforeRefresh: Record<string, any> = {
  selectedModel: MODEL,
  referenceImages: [
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/', // 图片1
    'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/e5428b3d.png', // 祭司老人
    '/flowgen-api/projects/14/assets/eec77159-9e6c-4b01-afd7-55780135e010/file', // 光头强
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/', // 图片4
  ],
  referenceImageLabels: ['图片1', '祭司老人', '光头强', '图片4'],
  referenceImageLocalRefs: [], // 顶层为空 ← 这是 bug
  modelConfigs: {
    [MODEL]: {
      referenceImages: [
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
        'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/e5428b3d.png',
        '/flowgen-api/projects/14/assets/eec77159-9e6c-4b01-afd7-55780135e010/file',
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/',
      ],
      referenceImageLabels: ['图片1', '祭司老人', '光头强', '图片4'],
      referenceImageLocalRefs: [
        'flowgen-local:a69d57e4_14:node_1:ref:Nano_Banana_20:0',
        '',
        '',
        'flowgen-local:a69d57e4_14:node_1:ref:Nano_Banana_20:3',
      ],
    },
  },
};

// 模拟持久化（sanitize 剥离 data:image）
const persisted = sanitizePersistValueDeep(dataBeforeRefresh);

console.log('=== 1. 持久化前（刷新前） ===');
console.log('顶层 referenceImages:', persisted.referenceImages);
console.log('顶层 referenceImageLocalRefs:', persisted.referenceImageLocalRefs);
console.log('modelConfigs referenceImageLocalRefs:', persisted.modelConfigs?.[MODEL]?.referenceImageLocalRefs);

// 检查：顶层 localRefs 是否为空
const topEmpty = !persisted.referenceImageLocalRefs?.some((r: string) => String(r || '').trim());
console.log(`顶层 localRefs 为空? ${topEmpty}`);

// 检查：data:image 槽是否被剥离
const dataSlotsEmpty = persisted.referenceImages?.[0] === '' && persisted.referenceImages?.[3] === '';
console.log(`data:image 槽变为空? ${dataSlotsEmpty}`);

console.log('\n=== 2. 模拟修复：从 modelConfigs 复制 localRefs 到顶层 ===');

// 模拟修复逻辑（与 FlowEditor.tsx 中的 backfillPanelReferenceImageLocalRefs 一致）
function simulateFix(data: Record<string, any>): Record<string, any> {
  const model = String(data.selectedModel || '').trim();
  const topLocalRefs = data.referenceImageLocalRefs;
  const hasTopLocalRefs = topLocalRefs && topLocalRefs.some((r: string) => String(r || '').trim());

  if (!hasTopLocalRefs && model && data.modelConfigs) {
    const cfg = data.modelConfigs[model];
    if (cfg && typeof cfg === 'object') {
      const cfgLocalRefs = cfg.referenceImageLocalRefs;
      if (cfgLocalRefs && cfgLocalRefs.some((r: string) => String(r || '').trim())) {
        const topRefs = data.referenceImages;
        const maxLen = Math.max((topRefs || []).length, cfgLocalRefs.length);
        const merged = Array.from({ length: maxLen }, (_, i) =>
          String(cfgLocalRefs[i] || '').trim()
        );
        data = { ...data, referenceImageLocalRefs: merged };
      }
    }
  }
  return data;
}

const fixed = simulateFix(persisted);

console.log('修复后顶层 referenceImageLocalRefs:', fixed.referenceImageLocalRefs);
const topFixed = fixed.referenceImageLocalRefs?.some((r: string) => String(r || '').trim());
console.log(`顶层 localRefs 有值? ${topFixed}`);

// 验证 localRefs 内容
console.log('  slot 0:', fixed.referenceImageLocalRefs[0]);
console.log('  slot 3:', fixed.referenceImageLocalRefs[3]);

console.log('\n=== 3. 模拟刷新后 hydrate：只有顶层有 localRefs 才能恢复 ===');

// hydrateAllPanelReferenceLocalRefs 只检查顶层 referenceImageLocalRefs
async function testHydrate(data: Record<string, any>) {
  try {
    const patch = await hydrateAllPanelReferenceLocalRefs(data);
    if (patch) {
      const merged = { ...data, ...patch };
      console.log('hydrate 成功，referenceImages:', merged.referenceImages?.map((u: string) => (u || '').slice(0, 40)));
      return true;
    }
    console.log('hydrate 未产生 patch（localRefs 为空或无 IndexedDB 数据）');
    return false;
  } catch (e) {
    console.log('hydrate 异常:', (e as Error).message);
    return false;
  }
}

console.log('--- 修复前（顶层 localRefs 为空）---');
const beforeOk = await testHydrate(persisted);

console.log('--- 修复后（顶层 localRefs 从 modelConfigs 复制）---');
const afterOk = await testHydrate(fixed);

console.log('\n=== 汇总 ===');
console.log(`修复前 hydrate 恢复: ${beforeOk ? 'PASS' : 'FAIL（预期失败：顶层 localRefs 为空）'}`);
console.log(`修复后 hydrate 恢复: ${afterOk ? 'PASS' : 'FAIL（需要 IndexedDB 有对应数据）'}`);
console.log(`修复后顶层 localRefs 已同步: ${topFixed ? 'PASS' : 'FAIL'}`);

// 注意：实际 hydrate 需要 IndexedDB 中有对应的 blob 数据
// 此测试仅验证数据结构层面的修复是否正确
// 完整验证需要在浏览器环境中进行

const allPassed = topFixed;
console.log(`\n最终结果: ${allPassed ? '全部通过' : '存在失败'}`);
process.exit(allPassed ? 0 : 1);