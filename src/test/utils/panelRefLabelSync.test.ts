import { describe, expect, it } from 'vitest';
import {
  syncGenericReferenceImageLabelsToSlotOrdinals,
} from '../../../utils/referenceImageSlotLabels';

const B = (i: number) => `blob:http://localhost:3001/img-${i}`;

describe('syncGenericReferenceImageLabelsToSlotOrdinals', () => {
  // ===== 核心 bug 场景：删除命名资产后，泛称标签应重新编号 =====

  it('renumbers labels after deleting a named asset from slot 0', () => {
    // 模拟：4 槽位，slot 0 是"鸱吻"（已删除），剩余 3 个泛称标签
    const refs = [B(1), B(2), B(3)];
    const labels = ['图片2', '图片3', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  it('renumbers labels after deleting a named asset from middle slot', () => {
    // 4 槽位，slot 1 是"夏茉"（已删除），剩余 3 个
    const refs = [B(0), B(2), B(3)];
    const labels = ['图片1', '图片3', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  it('renumbers labels when all labels are shifted by 1', () => {
    // 4 槽位，标签从"图片2"开始（用户 JSON 的实际场景）
    const refs = [B(1), B(2), B(3), B(4)];
    const labels = ['图片2', '图片3', '图片4', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3', '图片4']);
  });

  it('renumbers duplicate labels to correct ordinals', () => {
    // 3 槽位，两个"图片4"重复
    const refs = [B(1), B(2), B(3)];
    const labels = ['图片2', '图片4', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  // ===== 命名资产标签保留 =====

  it('preserves named asset labels', () => {
    const refs = [B(0), B(1), B(2)];
    const labels = ['鸱吻', '图片2', '图片3'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['鸱吻', '图片2', '图片3']);
  });

  it('preserves named asset labels even when compact ordinal differs', () => {
    const refs = [B(0), B(1), B(2)];
    const labels = ['夏茉', '鸱吻', '图片3'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['夏茉', '鸱吻', '图片3']);
  });

  // ===== 标签已正确对齐时保持不变 =====

  it('keeps labels unchanged when already correct', () => {
    const refs = [B(1), B(2), B(3)];
    const labels = ['图片1', '图片2', '图片3'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  it('keeps labels when label ordinal matches compact ordinal', () => {
    const refs = [B(0), B(1), B(2), B(3)];
    const labels = ['图片1', '图片2', '图片3', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3', '图片4']);
  });

  // ===== 空槽位处理 =====

  it('returns empty string for empty slots', () => {
    const refs = ['', B(1), B(2)];
    const labels = ['', '图片1', '图片2'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['', '图片1', '图片2']);
  });

  it('renumbers after empty slot in the middle', () => {
    const refs = [B(0), '', B(2)];
    const labels = ['图片1', '', '图片3'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    // 有空格 + labelOrd(3) === i+1(3) → 保留原标签（非本次修复范围）
    expect(result).toEqual(['图片1', '', '图片3']);
  });

  // ===== 单槽位 =====

  it('single slot with generic label ordinal 1', () => {
    const refs = [B(0)];
    const labels = ['图片1'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1']);
  });

  it('single slot with wrong ordinal', () => {
    const refs = [B(0)];
    const labels = ['图片5'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1']);
  });

  // ===== 空标签数组 =====

  it('generates labels from scratch when labels are empty', () => {
    const refs = [B(0), B(1), B(2)];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, undefined);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  it('generates labels from scratch when labels is empty array', () => {
    const refs = [B(0), B(1)];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, []);
    expect(result).toEqual(['图片1', '图片2']);
  });

  // ===== 混合：命名 + 泛称 + 不对齐 =====

  it('mixed: renumbers generic labels but preserves named assets', () => {
    // 真实场景：slot 0 是命名资产，slot 1 标签是"图片3"（不对齐），slot 2 标签是"图片4"（不对齐）
    const refs = [B(0), B(1), B(2)];
    const labels = ['鸱吻', '图片3', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['鸱吻', '图片2', '图片3']);
  });

  // ===== 与主图去重 =====

  it('skips main image duplicate in ordinal counting', () => {
    // 主图 URL 与 slot 0 相同 → refImageOrdinalForSlot 对 slot 0 返回 0
    const mainPreview = B(0);
    const refs = [B(0), B(1), B(2)];
    const labels = ['图片1', '图片2', '图片3'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels, mainPreview);
    // slot 0: compact=0, labelOrd=1, labelOrd===i+1 → 保留"图片1"（现有行为）
    // slot 1: compact=1, labelOrd=2, labelOrd===i+1 → 保留"图片2"（现有行为，非本次修复范围）
    // slot 2: compact=2, labelOrd=3, labelOrd===i+1 → 保留"图片3"（现有行为）
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  // ===== Prompt 保护 =====

  it('preserves label when referenced in prompt', () => {
    const refs = [B(0), B(1), B(2)];
    const labels = ['图片1', '图片2', '图片3'];
    const prompt = '请生成 @图片2 的变体';
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels, undefined, prompt);
    // 所有标签都对齐，且 @图片2 在 prompt 中 → 保持不变
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });

  // ===== 边界：大量槽位 =====

  it('handles 10 slots with correct sequential labels', () => {
    const refs = Array.from({ length: 10 }, (_, i) => B(i));
    const labels = Array.from({ length: 10 }, (_, i) => `图片${i + 1}`);
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(labels);
  });

  it('handles 10 slots with shifted labels', () => {
    const refs = Array.from({ length: 10 }, (_, i) => B(i));
    const labels = Array.from({ length: 10 }, (_, i) => `图片${i + 2}`);
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(Array.from({ length: 10 }, (_, i) => `图片${i + 1}`));
  });

  // ===== 用户 JSON 实际场景还原 =====

  it('matches user JSON: delete asset "鸱吻" from slot 0, 4 slots remain', () => {
    // 模拟用户 JSON：4 个槽位，标签 ["图片2", "图片3", "图片4", "图片4"]
    const refs = [B(1), B(2), B(3), B(4)];
    const labels = ['图片2', '图片3', '图片4', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3', '图片4']);
  });

  it('matches user JSON: delete asset "鸱吻" from slot 0, then add new image', () => {
    // 删除 鸱吻 后，3 槽位，标签从"图片2"开始
    const refs = [B(1), B(2), B(3)];
    const labels = ['图片2', '图片3', '图片4'];
    const result = syncGenericReferenceImageLabelsToSlotOrdinals(refs, labels);
    expect(result).toEqual(['图片1', '图片2', '图片3']);
  });
});