import { describe, expect, it } from 'vitest';
import { resolveKlingOmniPromptToNativeImageTokens } from '../../../utils/promptMediaRefs';
import { resolveImageGenPromptToImageTokens } from '../../../utils/promptMediaRefs';
import type { ResolvePromptPlaceholdersOptions } from '../../../utils/promptMediaRefs';

/**
 * 端到端模拟测试：使用真实 fixture 数据验证三个模型的 prompt 转换
 *
 * 数据来源：scripts/fixtures/20260709-seedance参考生视频.json
 * 该 fixture 包含 5 张参考图（图片1~图片5），1 个主视频，用户 prompt 中引用 @图片5 和 @图片2
 */

/** 构造真实场景的 opts：5张参考图映射 */
function makeRealisticOpts(): ResolvePromptPlaceholdersOptions {
  return {
    referenceImageIndexByToken: new Map([
      ['@图片1', 1],
      ['@图片2', 2],
      ['@图片3', 3],
      ['@图片4', 4],
      ['@图片5', 5],
    ]),
  } as ResolvePromptPlaceholdersOptions;
}

describe('端到端模拟测试：真实 fixture 数据', () => {
  const opts = makeRealisticOpts();

  // ==================== 可灵3.0 Omni ====================
  describe('可灵3.0 Omni（@image_N 格式）', () => {
    it('单图引用：@图片1 → @image_1', () => {
      const prompt = '参考 @图片1 的角色做视频';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('参考 @image_1 的角色做视频');
      expect(result).toContain('@image_1');
    });

    it('多图引用：@图片5和@图片2 → @image_5和@image_2', () => {
      const prompt = '@图片5和@图片2参考视频@主视频动作和镜头运行';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('@image_5和@image_2参考视频动作和镜头运行');
      expect(result).toContain('@image_5');
      expect(result).toContain('@image_2');
    });

    it('复杂场景：角色+道具+背景多图引用', () => {
      const prompt = '将 @图片1 中的角色放在 @图片2 的场景中，手持 @图片3 的道具';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('将 @image_1 中的角色放在 @image_2 的场景中，手持 @image_3 的道具');
    });

    it('角色绑定场景：@主图 + @图片2', () => {
      const prompt = '@主图 穿着 @图片2 的服装';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('@image_1 穿着 @image_2 的服装');
    });

    it('全5图场景：@图片1~@图片5', () => {
      const prompt = '参考 @图片1 @图片2 @图片3 @图片4 @图片5';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('参考 @image_1 @image_2 @image_3 @image_4 @image_5');
      // 验证每个 token 都被正确替换
      for (let i = 1; i <= 5; i++) {
        expect(result).toContain(`@image_${i}`);
        expect(result).not.toContain(`@图片${i}`);
      }
    });

    it('首尾帧场景：@首帧图 + @图片2（@首帧图 无映射→起始画面，@图片2→@image_2）', () => {
      const prompt = '@首帧图 开场，@图片2 收尾';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('起始画面 开场，@image_2 收尾');
    });

    it('尾帧场景：@尾帧图 无映射→结束画面', () => {
      const prompt = '最后画面停在 @尾帧图';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      expect(result).toBe('最后画面停在 结束画面');
    });

    it('首尾帧有 map 映射：@首帧图→@image_1，@尾帧图→@image_2', () => {
      const optsWithFrame = {
        ...opts,
        referenceImageIndexByToken: new Map([
          ...opts.referenceImageIndexByToken,
          ['@首帧图', 1],
          ['@尾帧图', 2],
        ]),
      };
      const prompt = '@首帧图过渡自然到@尾帧图，从整体到局部特写';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, optsWithFrame);
      expect(result).toBe('@image_1过渡自然到@image_2，从整体到局部特写');
    });
  });

  // ==================== image 2 / Nano Banana 2 ====================
  describe('image 2 / Nano Banana 2（Image N 格式）', () => {
    it('单图引用：@图片1 → Image 1', () => {
      const prompt = 'Transform @图片1 into a watercolour painting';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('Transform Image 1 into a watercolour painting');
    });

    it('多图引用：@图片5和@图片2 → Image 5 and Image 2', () => {
      const prompt = '@图片5和@图片2参考视频@主视频动作和镜头运行';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('Image 5和Image 2参考视频动作和镜头运行');
    });

    it('风格转移场景：apply Image 2 style to Image 1', () => {
      const prompt = 'apply @图片2 style to @图片1';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('apply Image 2 style to Image 1');
    });

    it('多主体合成：Image 1 + Image 2 + Image 3', () => {
      const prompt = '将 @图片1 中的产品放在 @图片2 的场景中，风格参考 @图片3';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('将 Image 1 中的产品放在 Image 2 的场景中，风格参考 Image 3');
    });

    it('角色一致性：the same woman from Image 1', () => {
      const prompt = 'the same woman from @图片1 standing on a city rooftop';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('the same woman from Image 1 standing on a city rooftop');
    });

    it('全5图场景：Image 1~Image 5', () => {
      const prompt = '参考 @图片1 @图片2 @图片3 @图片4 @图片5';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('参考 Image 1 Image 2 Image 3 Image 4 Image 5');
      for (let i = 1; i <= 5; i++) {
        expect(result).toContain(`Image ${i}`);
        expect(result).not.toContain(`@图片${i}`);
      }
    });

    it('@主图 兜底：Image 1', () => {
      const prompt = '@主图 是主角';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('Image 1 是主角');
    });

    it('@主体 兜底：Image 1', () => {
      const prompt = '参考 @主体 做动作';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      expect(result).toBe('参考 Image 1 做动作');
    });
  });

  // ==================== 官方格式合规性验证 ====================
  describe('官方格式合规性验证', () => {
    it('可灵3.0 Omni：@image_N 格式符合官方规范', () => {
      const prompt = '@图片1和@图片2参考视频@主视频动作';
      const result = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      // 官方格式：@image_1, @image_2, ..., @image_7
      expect(result).toMatch(/@image_\d+/);
      // 不包含 @图片N
      expect(result).not.toMatch(/@图片\d/);
      // 不包含长括号说明
      expect(result).not.toContain('（面板参考');
      expect(result).not.toContain('视作 [图');
    });

    it('image 2 / Nano Banana：Image N 格式符合官方推荐', () => {
      const prompt = '@图片1和@图片2参考视频@主视频动作';
      const result = resolveImageGenPromptToImageTokens(prompt, opts);
      // 官方推荐：Image 1, Image 2, ...
      expect(result).toMatch(/Image \d+/);
      // 不包含 @图片N
      expect(result).not.toMatch(/@图片\d/);
      // 不包含长括号说明
      expect(result).not.toContain('（面板参考');
      expect(result).not.toContain('视作 [图');
    });

    it('三个模型格式互不相同（防止串扰）', () => {
      const prompt = '@图片1 和 @图片2';
      const kling = resolveKlingOmniPromptToNativeImageTokens(prompt, opts);
      const imageGen = resolveImageGenPromptToImageTokens(prompt, opts);
      // 可灵用 @image_N
      expect(kling).toBe('@image_1 和 @image_2');
      // image2/Nano Banana 用 Image N
      expect(imageGen).toBe('Image 1 和 Image 2');
      // 两者不同
      expect(kling).not.toBe(imageGen);
    });
  });

  // ==================== 边界场景 ====================
  describe('边界场景', () => {
    it('空 map：返回原 prompt', () => {
      const emptyOpts = { referenceImageIndexByToken: new Map() } as ResolvePromptPlaceholdersOptions;
      const prompt = '@图片1 测试';
      expect(resolveKlingOmniPromptToNativeImageTokens(prompt, emptyOpts)).toBe(prompt);
      expect(resolveImageGenPromptToImageTokens(prompt, emptyOpts)).toBe(prompt);
    });

    it('undefined opts：返回原 prompt', () => {
      const prompt = '@图片1 测试';
      expect(resolveKlingOmniPromptToNativeImageTokens(prompt, undefined)).toBe(prompt);
      expect(resolveImageGenPromptToImageTokens(prompt, undefined)).toBe(prompt);
    });

    it('空 prompt：返回空', () => {
      expect(resolveKlingOmniPromptToNativeImageTokens('', opts)).toBe('');
      expect(resolveImageGenPromptToImageTokens('', opts)).toBe('');
    });

    it('null prompt：返回 null', () => {
      expect(resolveKlingOmniPromptToNativeImageTokens(null as any, opts)).toBe(null);
      expect(resolveImageGenPromptToImageTokens(null as any, opts)).toBe(null);
    });

    it('未在 map 中的 @标记：保留原样', () => {
      const partialOpts = {
        referenceImageIndexByToken: new Map([['@图片1', 1]]),
      } as ResolvePromptPlaceholdersOptions;
      const prompt = '@图片1 和 @未知标记';
      expect(resolveKlingOmniPromptToNativeImageTokens(prompt, partialOpts))
        .toBe('@image_1 和 @未知标记');
      expect(resolveImageGenPromptToImageTokens(prompt, partialOpts))
        .toBe('Image 1 和 @未知标记');
    });

    it('@图片 简写映射到 @图片1', () => {
      const prompt = '使用 @图片 作为参考';
      expect(resolveKlingOmniPromptToNativeImageTokens(prompt, opts))
        .toBe('使用 @image_1 作为参考');
      expect(resolveImageGenPromptToImageTokens(prompt, opts))
        .toBe('使用 Image 1 作为参考');
    });
  });
});
