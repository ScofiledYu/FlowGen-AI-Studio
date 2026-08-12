import { describe, it, expect } from 'vitest';
import { compactSeedancePanelReferences } from '../../../utils/referenceImageSlotLabels';
import type { NodeData } from '../../../types';

/**
 * §11.90m：对标 Banana 面板 —— Seedance 删除参考图后压紧并对齐 localRefs 的回归测试。
 *
 * 用户问题1：删除一张刷新没问题，再删除一张刷新后出现「图片1和图片2一样」。
 * 用户问题2：删除一张刷新没问题，再删除一张刷新后「多删除了一个」（图片丢失）。
 *
 * 根因1（重复）：旧 removeRefImage 仅 splice 不压紧，localRefs 错位累积，hydration 按 i 下标取错 blob。
 * 根因2（丢失）：compactSeedancePanelReferences 旧逻辑 `if (!url) continue` 把持久化剥离 blob 后
 *   留下的空字符串占位槽位（但 referenceImageLocalRefs 有值）误删，导致 IDB 无法恢复。
 *
 * 修复：只过滤「URL 和 localRef 都为空」的真正空槽；保留「URL 空但 localRef 有值」的等待恢复槽位。
 */
describe('compactSeedancePanelReferences (§11.90m)', () => {
  it('过滤真正的空槽（URL 和 localRef 都为空），保留有 localRef 的占位槽', () => {
    const result = compactSeedancePanelReferences({
      referenceImages: ['https://a.png', '', 'https://b.png', '', 'https://c.png'],
      referenceImageLabels: ['图片1', '图片2', '图片3', '图片4', '图片5'],
      referenceImageLocalRefs: ['ref:0', '', 'ref:2', '', 'ref:4'],
      referenceElementIds: ['eid0', 'eid1', 'eid2', 'eid3', 'eid4'],
    });
    // slot 1 和 slot 3 是真正空槽（URL 和 localRef 都为空）→ 过滤
    expect(result.referenceImages).toEqual(['https://a.png', 'https://b.png', 'https://c.png']);
    expect(result.referenceImageLabels).toEqual(['图片1', '图片3', '图片5']);
    expect(result.referenceImageLocalRefs).toEqual(['ref:0', 'ref:2', 'ref:4']);
    expect(result.referenceElementIds).toEqual(['eid0', 'eid2', 'eid4']);
  });

  it('§11.90m 关键：保留持久化剥离后等待 IDB 恢复的占位槽位（URL 空 但 localRef 有值）', () => {
    // 模拟刷新后 sanitizePersistValueDeep 剥离 blob URL 成空字符串，但 localRefs 保留
    // 这些槽位需要 hydrateAllPanelReferenceLocalRefs 从 IDB 恢复，绝不能删
    const result = compactSeedancePanelReferences({
      referenceImages: ['', '', ''],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      referenceImageLocalRefs: ['ref:0', 'ref:2', 'ref:3'],
      referenceElementIds: ['eid0', 'eid2', 'eid3'],
    });
    // 全部保留（localRef 有值），等待 IDB 恢复
    expect(result.referenceImages).toEqual(['', '', '']);
    expect(result.referenceImageLocalRefs).toEqual(['ref:0', 'ref:2', 'ref:3']);
    expect(result.referenceImageLabels).toEqual(['图片1', '图片2', '图片3']);
    // 长度一致，不被误删
    expect(result.referenceImages.length).toBe(3);
    expect(result.referenceImageLocalRefs.length).toBe(3);
  });

  it('模拟用户场景：ref index 非连续（ref:1,ref:3,ref:7,ref:8），压紧后保持对齐', () => {
    // 对应 面板图片重复2.json 的实际脏数据
    const result = compactSeedancePanelReferences({
      referenceImages: ['blob:1', 'blob:2', 'blob:3', 'blob:4'],
      referenceImageLabels: ['图片1', '图片2', '图片3', '图片4'],
      referenceImageLocalRefs: ['ref:1', 'ref:3', 'ref:7', 'ref:8'],
      referenceElementIds: ['eid1', 'eid3', 'eid7', 'eid8'],
    });
    expect(result.referenceImages).toEqual(['blob:1', 'blob:2', 'blob:3', 'blob:4']);
    expect(result.referenceImageLabels).toEqual(['图片1', '图片2', '图片3', '图片4']);
    // localRefs 保持原值（不去重 URL，只压紧空槽），但下标严格对齐
    expect(result.referenceImageLocalRefs).toEqual(['ref:1', 'ref:3', 'ref:7', 'ref:8']);
    expect(result.referenceElementIds).toEqual(['eid1', 'eid3', 'eid7', 'eid8']);
  });

  it('删除中间槽后，压紧并保持 localRefs 与 referenceImages 对齐', () => {
    // 初始 5 张图，删除 slot 2 后的状态（模拟 removeRefImage splice 后）
    const result = compactSeedancePanelReferences({
      referenceImages: ['url0', 'url1', 'url3', 'url4'],
      referenceImageLabels: ['图片1', '图片2', '图片4', '图片5'],
      referenceImageLocalRefs: ['ref:0', 'ref:1', 'ref:3', 'ref:4'],
      referenceElementIds: ['eid0', 'eid1', 'eid3', 'eid4'],
    });
    expect(result.referenceImages).toEqual(['url0', 'url1', 'url3', 'url4']);
    expect(result.referenceImageLocalRefs).toEqual(['ref:0', 'ref:1', 'ref:3', 'ref:4']);
    // 长度一致
    expect(result.referenceImages.length).toBe(result.referenceImageLocalRefs.length);
    expect(result.referenceImages.length).toBe(result.referenceImageLabels.length);
    expect(result.referenceImages.length).toBe(result.referenceElementIds.length);
  });

  it('混合场景：部分 https（持久）、部分空占位（待 IDB 恢复）、部分真正空槽', () => {
    // 对应 面板.json 持久化后的状态：https 保留，blob 剥离成空串占位，无 localRef 的真空槽被过滤
    const result = compactSeedancePanelReferences({
      referenceImages: [
        '/flowgen-api/.../file',  // slot 0: 持久 URL，无 localRef
        '',                        // slot 1: blob 剥离，有 localRef → 保留
        '',                        // slot 2: 真正空槽（URL 和 localRef 都空）→ 过滤
        'https://cos.example/8337ed5c.png',  // slot 3: https，无 localRef
        'https://cos.example/421bca6c.png',  // slot 4: https，无 localRef
        '',                        // slot 5: blob 剥离，有 localRef → 保留
        '',                        // slot 6: blob 剥离，有 localRef → 保留
      ],
      referenceImageLabels: ['美女', '图片2', '图片3', '图片4', '图片5', '图片6', '图片7'],
      referenceImageLocalRefs: ['', 'ref:2', '', '', '', 'ref:7', 'ref:8'],
      referenceElementIds: ['', 'eid2', '', '', '', 'eid7', 'eid8'],
    });
    // slot 2 被过滤（真真空槽），其余保留
    expect(result.referenceImages).toEqual([
      '/flowgen-api/.../file',
      '',
      'https://cos.example/8337ed5c.png',
      'https://cos.example/421bca6c.png',
      '',
      '',
    ]);
    expect(result.referenceImageLocalRefs).toEqual(['', 'ref:2', '', '', 'ref:7', 'ref:8']);
    // 长度一致
    expect(result.referenceImages.length).toBe(6);
    expect(result.referenceImageLocalRefs.length).toBe(6);
  });

  it('全空槽（URL 和 localRef 都为空）返回空数组', () => {
    const result = compactSeedancePanelReferences({
      referenceImages: ['', '', ''],
      referenceImageLabels: ['图片1', '图片2', '图片3'],
      referenceImageLocalRefs: ['', '', ''],
      referenceElementIds: ['eid1', 'eid2', 'eid3'],
    });
    expect(result.referenceImages).toEqual([]);
    expect(result.referenceImageLabels).toEqual([]);
    expect(result.referenceImageLocalRefs).toEqual([]);
    expect(result.referenceElementIds).toEqual([]);
  });

  it('undefined 字段安全降级为空数组', () => {
    const result = compactSeedancePanelReferences({} as Pick<
      NodeData,
      'referenceImages' | 'referenceImageLabels' | 'referenceImageLocalRefs' | 'referenceElementIds'
    >);
    expect(result.referenceImages).toEqual([]);
    expect(result.referenceImageLocalRefs).toEqual([]);
  });
});
