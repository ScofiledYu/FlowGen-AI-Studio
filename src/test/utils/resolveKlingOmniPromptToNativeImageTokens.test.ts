import { describe, expect, it } from 'vitest';
import { resolveKlingOmniPromptToNativeImageTokens } from '../../../utils/promptMediaRefs';
import type { ResolvePromptPlaceholdersOptions } from '../../../utils/promptMediaRefs';

/** 构造测试用 opts：token → imageIndex 映射 */
function makeOpts(map: Record<string, number>): ResolvePromptPlaceholdersOptions {
  return {
    referenceImageIndexByToken: new Map(Object.entries(map)),
  } as ResolvePromptPlaceholdersOptions;
}

describe('resolveKlingOmniPromptToNativeImageTokens', () => {
  it('替换 @图片1 为 @image_1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('将 @图片1 放到场景中', opts))
      .toBe('将 @image_1 放到场景中');
  });

  it('替换多张 @图片N 为 @image_N', () => {
    const opts = makeOpts({ '@图片1': 1, '@图片2': 2, '@图片3': 3 });
    expect(resolveKlingOmniPromptToNativeImageTokens('@图片1 和 @图片2 参考 @图片3', opts))
      .toBe('@image_1 和 @image_2 参考 @image_3');
  });

  it('@主图 兜底映射到 @image_1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('@主图 是主角', opts))
      .toBe('@image_1 是主角');
  });

  it('@主体 兜底映射到 @image_1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('参考 @主体 做动作', opts))
      .toBe('参考 @image_1 做动作');
  });

  it('@图片 简写映射到 @image_1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('使用 @图片 作为背景', opts))
      .toBe('使用 @image_1 作为背景');
  });

  it('@首帧图 无 map 映射→起始画面（保留语义，避免移除后 prompt 断裂）', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('@首帧图角色走动', opts))
      .toBe('起始画面角色走动');
  });

  it('@尾帧图 无 map 映射→结束画面（保留语义）', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('结尾 @尾帧图', opts))
      .toBe('结尾 结束画面');
  });

  it('移除 @主视频 标记', () => {
    const opts = makeOpts({ '@图片1': 1, '@图片2': 2 });
    expect(resolveKlingOmniPromptToNativeImageTokens('@图片1和@图片2参考视频@主视频动作', opts))
      .toBe('@image_1和@image_2参考视频动作');
  });

  it('未在 map 中的 @标记 保留原样', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('@未知标记 保留', opts))
      .toBe('@未知标记 保留');
  });

  it('空 map 时返回原 prompt', () => {
    const opts = makeOpts({});
    expect(resolveKlingOmniPromptToNativeImageTokens('@图片1 测试', opts))
      .toBe('@图片1 测试');
  });

  it('空 prompt 返回空', () => {
    expect(resolveKlingOmniPromptToNativeImageTokens('', makeOpts({ '@图片1': 1 })))
      .toBe('');
  });

  it('无 @标记 时返回原 prompt', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveKlingOmniPromptToNativeImageTokens('普通文本无标记', opts))
      .toBe('普通文本无标记');
  });
});
