/**
 * 全模型 localRefs 同步模拟测试
 * 验证：刷新前顶层 localRefs 为空但 modelConfigs 层有数据时，修复后刷新能恢复
 * 
 * 覆盖模型：
 * 1. Nano Banana 2.0 - referenceImageLocalRefs
 * 2. image2 / 可灵2.5 Turbo - referenceImageLocalRefs  
 * 3. Seedance 参考生 - referenceImageLocalRefs
 * 4. 可灵3.0 Omni multi tab - klingOmniMultiReferenceLocalRefs
 * 5. 可灵3.0 Omni instruction tab - klingOmniInstructionReferenceLocalRefs
 * 6. 可灵3.0 Omni video tab - klingOmniVideoReferenceLocalRefs
 */
import { sanitizePersistValueDeep } from '../utils/persistSanitize.mjs';
import type { PanelReferenceLocalRefField } from '../utils/hydratePanelReferenceLocalRefs';

// ============================================================
// 定义：localRef 字段 → 对应 image 字段的映射
// ============================================================
const LOCAL_REF_TO_IMAGE_FIELD: Record<string, string> = {
  referenceImageLocalRefs: 'referenceImages',
  klingOmniMultiReferenceLocalRefs: 'klingOmniMultiReferenceImages',
  klingOmniInstructionReferenceLocalRefs: 'klingOmniInstructionReferenceImages',
  klingOmniVideoReferenceLocalRefs: 'klingOmniVideoReferenceImages',
};

interface TestCase {
  name: string;
  model: string;
  // 模拟刷新前的数据：顶层 localRefs 为空，modelConfigs 有 localRefs
  dataBeforeRefresh: Record<string, any>;
}

function buildTestCases(): TestCase[] {
  const DATA_IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/';
  const COS_URL = 'https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/openApi/212508/e5428b3d.png';
  const ASSET_URL = '/flowgen-api/projects/14/assets/eec77159-9e6c-4b01-afd7-55780135e010/file';

  const cases: TestCase[] = [];

  // ---- 1. Nano Banana 2.0 ----
  cases.push({
    name: 'Nano Banana 2.0 - referenceImages',
    model: 'Nano Banana 2.0',
    dataBeforeRefresh: {
      selectedModel: 'Nano Banana 2.0',
      referenceImages: [DATA_IMG, COS_URL, ASSET_URL, DATA_IMG],
      referenceImageLabels: ['图片1', '祭司老人', '光头强', '图片4'],
      referenceImageLocalRefs: [], // 顶层为空 ← bug
      modelConfigs: {
        'Nano Banana 2.0': {
          referenceImages: [DATA_IMG, COS_URL, ASSET_URL, DATA_IMG],
          referenceImageLabels: ['图片1', '祭司老人', '光头强', '图片4'],
          referenceImageLocalRefs: [
            'flowgen-local:a69d57e4_14:node_1:ref:Nano_Banana_20:0',
            '',
            '',
            'flowgen-local:a69d57e4_14:node_1:ref:Nano_Banana_20:3',
          ],
        },
      },
    },
  });

  // ---- 2. image2 ----
  cases.push({
    name: 'image2 - referenceImages',
    model: 'image2',
    dataBeforeRefresh: {
      selectedModel: 'image2',
      referenceImages: [DATA_IMG, COS_URL, DATA_IMG],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      referenceImageLocalRefs: [],
      modelConfigs: {
        image2: {
          referenceImages: [DATA_IMG, COS_URL, DATA_IMG],
          referenceImageLabels: ['图片1', '图片2', '图片3'],
          referenceImageLocalRefs: [
            'flowgen-local:a69d57e4_14:node_2:ref:image2:0',
            '',
            'flowgen-local:a69d57e4_14:node_2:ref:image2:2',
          ],
        },
      },
    },
  });

  // ---- 3. Seedance 参考生 ----
  cases.push({
    name: 'Seedance 参考生 - referenceImages',
    model: 'seedance2.0 (高质量版)',
    dataBeforeRefresh: {
      selectedModel: 'seedance2.0 (高质量版)',
      referenceImages: [DATA_IMG, COS_URL, DATA_IMG],
      referenceImageLabels: ['主图', '图片1', '图片2'],
      referenceImageLocalRefs: [],
      modelConfigs: {
        'seedance2.0 (高质量版)': {
          referenceImages: [DATA_IMG, COS_URL, DATA_IMG],
          referenceImageLabels: ['主图', '图片1', '图片2'],
          referenceImageLocalRefs: [
            'flowgen-local:a69d57e4_14:node_3:ref:0',
            '',
            'flowgen-local:a69d57e4_14:node_3:ref:2',
          ],
        },
      },
    },
  });

  // ---- 4. 可灵3.0 Omni multi tab ----
  cases.push({
    name: '可灵3.0 Omni - multi tab',
    model: '可灵3.0 Omni',
    dataBeforeRefresh: {
      selectedModel: '可灵3.0 Omni',
      klingOmniMultiReferenceImages: [DATA_IMG, COS_URL, DATA_IMG],
      klingOmniMultiReferenceLocalRefs: [],
      modelConfigs: {
        '可灵3.0 Omni': {
          klingOmniMultiReferenceImages: [DATA_IMG, COS_URL, DATA_IMG],
          klingOmniMultiReferenceLocalRefs: [
            'flowgen-local:a69d57e4_14:node_4:ref:kl_Omni_multi:0',
            '',
            'flowgen-local:a69d57e4_14:node_4:ref:kl_Omni_multi:2',
          ],
        },
      },
    },
  });

  // ---- 5. 可灵3.0 Omni instruction tab ----
  cases.push({
    name: '可灵3.0 Omni - instruction tab',
    model: '可灵3.0 Omni',
    dataBeforeRefresh: {
      selectedModel: '可灵3.0 Omni',
      klingOmniInstructionReferenceImages: [DATA_IMG, COS_URL],
      klingOmniInstructionReferenceLocalRefs: [],
      modelConfigs: {
        '可灵3.0 Omni': {
          klingOmniInstructionReferenceImages: [DATA_IMG, COS_URL],
          klingOmniInstructionReferenceLocalRefs: [
            'flowgen-local:a69d57e4_14:node_5:ref:kl_Omni_instruction:0',
            '',
          ],
        },
      },
    },
  });

  // ---- 6. 可灵3.0 Omni video tab ----
  cases.push({
    name: '可灵3.0 Omni - video tab',
    model: '可灵3.0 Omni',
    dataBeforeRefresh: {
      selectedModel: '可灵3.0 Omni',
      klingOmniVideoReferenceImages: [DATA_IMG],
      klingOmniVideoReferenceLocalRefs: [],
      modelConfigs: {
        '可灵3.0 Omni': {
          klingOmniVideoReferenceImages: [DATA_IMG],
          klingOmniVideoReferenceLocalRefs: [
            'flowgen-local:a69d57e4_14:node_6:ref:kl_Omni_video:0',
          ],
        },
      },
    },
  });

  return cases;
}

/**
 * 模拟修复逻辑：从 modelConfigs 复制 localRefs 到顶层
 */
function syncLocalRefsFromModelConfigs(data: Record<string, any>): Record<string, any> {
  const model = String(data.selectedModel || '').trim();
  if (!model) return data;

  const modelConfigs = data.modelConfigs;
  if (!modelConfigs || typeof modelConfigs !== 'object') return data;

  const cfg = (modelConfigs as Record<string, any>)[model];
  if (!cfg || typeof cfg !== 'object') return data;

  let changed = false;
  const next = { ...data };

  for (const [localRefField, imageField] of Object.entries(LOCAL_REF_TO_IMAGE_FIELD)) {
    const topLocalRefs = (data as Record<string, any>)[localRefField] as string[] | undefined;
    const hasTopLocalRefs = topLocalRefs && topLocalRefs.some((r: string) => String(r || '').trim());

    if (hasTopLocalRefs) continue; // 顶层已有 localRefs，无需复制

    const cfgLocalRefs = cfg[localRefField] as string[] | undefined;
    if (!cfgLocalRefs || !cfgLocalRefs.some((r: string) => String(r || '').trim())) continue;

    // 复制 modelConfigs 的 localRefs 到顶层
    const topRefs = (data as Record<string, any>)[imageField] as string[] | undefined;
    const maxLen = Math.max((topRefs || []).length, cfgLocalRefs.length);
    const merged: string[] = Array.from({ length: maxLen }, (_, i) =>
      String(cfgLocalRefs[i] || '').trim()
    );

    (next as Record<string, any>)[localRefField] = merged;
    changed = true;
  }

  return changed ? next : data;
}

async function main() {
  const cases = buildTestCases();
  let totalPassed = 0;
  let totalFailed = 0;

  console.log('=== 全模型 localRefs 同步模拟测试 ===\n');

  for (const tc of cases) {
    console.log(`--- ${tc.name} ---`);
    console.log(`  模型: ${tc.model}`);
    
    // 1. 模拟持久化
    const persisted = sanitizePersistValueDeep(tc.dataBeforeRefresh);
    
    // 检查哪些 localRef 字段在顶层为空
    const emptyFields: string[] = [];
    for (const localRefField of Object.keys(LOCAL_REF_TO_IMAGE_FIELD)) {
      const topRefs = (persisted as Record<string, any>)[localRefField] as string[] | undefined;
      const topImg = (persisted as Record<string, any>)[LOCAL_REF_TO_IMAGE_FIELD[localRefField]] as string[] | undefined;
      
      if (!topRefs || !topRefs.some((r: string) => String(r || '').trim())) {
        if (topImg && topImg.length > 0) {
          emptyFields.push(localRefField);
        }
      }
    }

    console.log(`  顶层为空 localRef 字段: ${emptyFields.length > 0 ? emptyFields.join(', ') : '无'}`);

    // 2. 模拟修复
    const fixed = syncLocalRefsFromModelConfigs(persisted);

    // 3. 验证修复结果
    let allOk = true;
    for (const localRefField of emptyFields) {
      const fixedRefs = (fixed as Record<string, any>)[localRefField] as string[] | undefined;
      const hasRefs = fixedRefs && fixedRefs.some((r: string) => String(r || '').trim());
      
      if (hasRefs) {
        console.log(`  [PASS] ${localRefField} 已从 modelConfigs 同步`);
      } else {
        console.log(`  [FAIL] ${localRefField} 未同步`);
        allOk = false;
      }
    }

    // 4. 验证 localRefs 内容正确
    const cfg = (tc.dataBeforeRefresh.modelConfigs as Record<string, any>)[tc.model];
    for (const localRefField of emptyFields) {
      const fixedRefs = (fixed as Record<string, any>)[localRefField] as string[] | undefined;
      const cfgRefs = cfg?.[localRefField] as string[] | undefined;
      
      if (fixedRefs && cfgRefs) {
        // 检查非空槽位是否一致
        let mismatchCount = 0;
        for (let i = 0; i < Math.max(fixedRefs.length, cfgRefs.length); i++) {
          const f = String(fixedRefs[i] || '').trim();
          const c = String(cfgRefs[i] || '').trim();
          if (f !== c) {
            mismatchCount++;
            console.log(`  [WARN] ${localRefs} slot ${i}: 期望="${c.slice(0,40)}" 实际="${f.slice(0,40)}"`);
          }
        }
        if (mismatchCount === 0) {
          console.log(`  [PASS] ${localRefField} 内容完全匹配 modelConfigs`);
        } else {
          console.log(`  [FAIL] ${localRefField} 有 ${mismatchCount} 个槽位不匹配`);
          allOk = false;
        }
      }
    }

    if (allOk && emptyFields.length > 0) {
      totalPassed++;
      console.log(`  结果: PASS\n`);
    } else if (emptyFields.length === 0) {
      totalPassed++;
      console.log(`  结果: PASS（无需修复，顶层 localRefs 已存在）\n`);
    } else {
      totalFailed++;
      console.log(`  结果: FAIL\n`);
    }
  }

  console.log(`\n=== 汇总 ===`);
  console.log(`通过: ${totalPassed}/${cases.length}`);
  console.log(`失败: ${totalFailed}/${cases.length}`);
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});