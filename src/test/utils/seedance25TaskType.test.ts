import { describe, expect, it } from 'vitest';
import {
  isSeedance25Model,
  resolveSeedance25ParameterOverrides,
  seedance25PromptHasTaskKeyword,
  validateSeedance25TaskTypeRun,
} from '../../../utils/seedance25TaskType';

describe('seedance25TaskType', () => {
  it('isSeedance25Model 仅匹配 seedance2.5', () => {
    expect(isSeedance25Model('seedance2.5')).toBe(true);
    expect(isSeedance25Model('seedance2.0 (高质量版)')).toBe(false);
    expect(isSeedance25Model(undefined)).toBe(false);
  });

  it('视频编辑关键词校验', () => {
    expect(seedance25PromptHasTaskKeyword('video_edit', '@视频1 中加上一些小动物')).toBe(true);
    expect(seedance25PromptHasTaskKeyword('video_edit', '把 @视频1 的人物替换为 @图片1')).toBe(true);
    expect(seedance25PromptHasTaskKeyword('video_edit', '删掉 @视频1 的背景音乐')).toBe(true);
    expect(seedance25PromptHasTaskKeyword('video_edit', '@视频1 生成一段新视频')).toBe(false);
  });

  it('视频延长关键词校验', () => {
    expect(seedance25PromptHasTaskKeyword('video_extend', '延续@视频1 的画面风格，继续生成后续剧情')).toBe(true);
    expect(seedance25PromptHasTaskKeyword('video_extend', '向后延长 5 秒')).toBe(true);
    expect(seedance25PromptHasTaskKeyword('video_extend', '@视频1 修改背景')).toBe(false);
  });

  it('validateSeedance25TaskTypeRun：normal 直接通过', () => {
    expect(
      validateSeedance25TaskTypeRun({ taskType: 'normal', prompt: '任意', referenceVideoCount: 0 })
    ).toBeNull();
    expect(
      validateSeedance25TaskTypeRun({ taskType: undefined, prompt: '', referenceVideoCount: 0 })
    ).toBeNull();
  });

  it('validateSeedance25TaskTypeRun：缺参考视频被拦截', () => {
    const msg = validateSeedance25TaskTypeRun({
      taskType: 'video_edit',
      prompt: '修改视频',
      referenceVideoCount: 0,
    });
    expect(msg).toContain('至少上传 1 个参考视频');
  });

  it('validateSeedance25TaskTypeRun：缺关键词被拦截', () => {
    const msg = validateSeedance25TaskTypeRun({
      taskType: 'video_extend',
      prompt: '生成后续剧情',
      referenceVideoCount: 1,
    });
    expect(msg).toContain('向前延长');
    expect(msg).toContain('续写');
  });

  it('validateSeedance25TaskTypeRun：合法输入通过', () => {
    expect(
      validateSeedance25TaskTypeRun({
        taskType: 'video_edit',
        prompt: '把 @视频1 的人物修改为 @图片1',
        referenceVideoCount: 1,
      })
    ).toBeNull();
    expect(
      validateSeedance25TaskTypeRun({
        taskType: 'video_extend',
        prompt: '延续@视频1 的动作，续写后续剧情',
        referenceVideoCount: 2,
      })
    ).toBeNull();
  });

  it('resolveSeedance25ParameterOverrides：video_edit 固定 adaptive + -1', () => {
    expect(resolveSeedance25ParameterOverrides('video_edit', '16:9', 8)).toEqual({
      ratio: 'adaptive',
      duration: -1,
    });
  });

  it('resolveSeedance25ParameterOverrides：video_extend adaptive + [4,30] 夹取', () => {
    expect(resolveSeedance25ParameterOverrides('video_extend', '9:16', 10)).toEqual({
      ratio: 'adaptive',
      duration: 10,
    });
    expect(resolveSeedance25ParameterOverrides('video_extend', '9:16', 99).duration).toBe(30);
    expect(resolveSeedance25ParameterOverrides('video_extend', '9:16', 1).duration).toBe(4);
  });

  it('resolveSeedance25ParameterOverrides：normal 透传', () => {
    expect(resolveSeedance25ParameterOverrides('normal', '16:9', 12)).toEqual({
      ratio: '16:9',
      duration: 12,
    });
    expect(resolveSeedance25ParameterOverrides(undefined, '1:1', 5)).toEqual({
      ratio: '1:1',
      duration: 5,
    });
  });
});
