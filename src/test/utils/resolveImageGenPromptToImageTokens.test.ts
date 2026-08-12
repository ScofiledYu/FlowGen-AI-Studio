import { describe, expect, it } from 'vitest';
import { resolveImageGenPromptToImageTokens } from '../../../utils/promptMediaRefs';
import type { ResolvePromptPlaceholdersOptions } from '../../../utils/promptMediaRefs';

/** 构造测试用 opts：token → imageIndex 映射 */
function makeOpts(map: Record<string, number>): ResolvePromptPlaceholdersOptions {
  return {
    referenceImageIndexByToken: new Map(Object.entries(map)),
  } as ResolvePromptPlaceholdersOptions;
}

describe('resolveImageGenPromptToImageTokens', () => {
  it('替换 @图片1 为 Image 1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('参考 @图片1 中的主体', opts))
      .toBe('参考 Image 1 中的主体');
  });

  it('替换多张 @图片N 为 Image N', () => {
    const opts = makeOpts({ '@图片1': 1, '@图片2': 2, '@图片3': 3 });
    expect(resolveImageGenPromptToImageTokens('apply @图片2 style to @图片1', opts))
      .toBe('apply Image 2 style to Image 1');
  });

  it('@主图 兜底映射到 Image 1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('@主图 是主角', opts))
      .toBe('Image 1 是主角');
  });

  it('@主体 兜底映射到 Image 1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('参考 @主体 做动作', opts))
      .toBe('参考 Image 1 做动作');
  });

  it('@图片 简写映射到 Image 1', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('使用 @图片 作为背景', opts))
      .toBe('使用 Image 1 作为背景');
  });

  it('@首帧图 无 map 映射→起始画面（保留语义，避免移除后 prompt 断裂）', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('@首帧图角色走动', opts))
      .toBe('起始画面角色走动');
  });

  it('@尾帧图 无 map 映射→结束画面（保留语义）', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('结尾 @尾帧图', opts))
      .toBe('结尾 结束画面');
  });

  it('移除 @主视频 标记', () => {
    const opts = makeOpts({ '@图片1': 1, '@图片2': 2 });
    expect(resolveImageGenPromptToImageTokens('@图片1和@图片2参考视频@主视频动作', opts))
      .toBe('Image 1和Image 2参考视频动作');
  });

  it('未在 map 中的 @标记 保留原样', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('@未知标记 保留', opts))
      .toBe('@未知标记 保留');
  });

  it('空 map 时返回原 prompt', () => {
    const opts = makeOpts({});
    expect(resolveImageGenPromptToImageTokens('@图片1 测试', opts))
      .toBe('@图片1 测试');
  });

  it('空 prompt 返回空', () => {
    expect(resolveImageGenPromptToImageTokens('', makeOpts({ '@图片1': 1 })))
      .toBe('');
  });

  it('无 @标记 时返回原 prompt', () => {
    const opts = makeOpts({ '@图片1': 1 });
    expect(resolveImageGenPromptToImageTokens('普通文本无标记', opts))
      .toBe('普通文本无标记');
  });

  it('模拟 gpt-image-2 多图合成场景（Image 1 + Image 2 交互）', () => {
    const opts = makeOpts({ '@图片1': 1, '@图片2': 2, '@图片3': 3 });
    const prompt = '将 @图片1 中的产品放在 @图片2 的场景中，风格参考 @图片3';
    expect(resolveImageGenPromptToImageTokens(prompt, opts))
      .toBe('将 Image 1 中的产品放在 Image 2 的场景中，风格参考 Image 3');
  });
});
