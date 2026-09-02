import { describe, expect, it } from 'vitest';
import {
  resolveSeedance25PromptToNativeTokens,
  type ResolvePromptPlaceholdersOptions,
  type ProjectAssetLabelRow,
} from '../../../utils/promptMediaRefs';

/**
 * Seedance 2.5：提交豆包 API 用官方原生「@videoN / @imageN」标记。
 * 对照火山官方文档 82379/2607688（Seedance 2.5 教程：@video1 中加一些小动物；把 @video1 的人物修改为 @image1）。
 */
describe('resolveSeedance25PromptToNativeTokens', () => {
  const makeOpts = (p: {
    images?: Array<[string, number]>;
    videos?: Array<[string, number]>;
    audios?: Array<[string, number]>;
    projectAssets?: ProjectAssetLabelRow[];
  }): ResolvePromptPlaceholdersOptions =>
    ({
      referenceImageIndexByToken: new Map(p.images ?? []),
      referenceVideoIndexByToken: new Map(p.videos ?? []),
      referenceAudioIndexByToken: new Map(p.audios ?? []),
      projectAssets: p.projectAssets ?? [],
    }) as ResolvePromptPlaceholdersOptions;

  it('视频编辑：@主视频 + @资产 → @video1 + @image1', () => {
    const opts = makeOpts({
      images: [['@资产:卷卷', 1]],
      videos: [['@主视频', 1]],
      projectAssets: [{ slug: '卷卷', name: '卷卷', url: 'https://x/juanjuan.png' }],
    });
    const out = resolveSeedance25PromptToNativeTokens('@主视频中增加一个角色@资产:卷卷', opts);
    expect(out).toBe('@video1中增加一个角色@image1');
    expect(out).not.toContain('@主视频');
    expect(out).not.toContain('@资产');
    expect(out).not.toContain('图片1');
  });

  it('视频编辑：@主视频 无 map 兜底为 @video1', () => {
    const out = resolveSeedance25PromptToNativeTokens('@主视频中增加一个角色', {});
    expect(out).toBe('@video1中增加一个角色');
  });

  it('视频编辑：@视频1 映射到 @video{index}', () => {
    const opts = makeOpts({ videos: [['@视频1', 1], ['@视频2', 2]] });
    const out = resolveSeedance25PromptToNativeTokens('把 @视频2 的神情复制到 @视频1', opts);
    expect(out).toBe('把 @video2 的神情复制到 @video1');
  });

  it('视频延长：@主视频 + 关键词延续', () => {
    const opts = makeOpts({ videos: [['@主视频', 1]] });
    const out = resolveSeedance25PromptToNativeTokens('延续@主视频的画面风格，续写后续剧情', opts);
    expect(out).toBe('延续@video1的画面风格，续写后续剧情');
  });

  it('图片引用：@图片N → @imageN', () => {
    const opts = makeOpts({ images: [['@图片1', 1], ['@图片2', 2]] });
    const out = resolveSeedance25PromptToNativeTokens('参考 @图片2 和 @图片1 生成', opts);
    expect(out).toBe('参考 @image2 和 @image1 生成');
  });

  it('音频引用：@音频1 → @audio1', () => {
    const opts = makeOpts({ audios: [['@音频1', 1]] });
    const out = resolveSeedance25PromptToNativeTokens('替换 @音频1 的背景音乐', opts);
    expect(out).toBe('替换 @audio1 的背景音乐');
  });

  it('首尾帧 → 起始画面/结束画面', () => {
    const out = resolveSeedance25PromptToNativeTokens('@首帧图动起来，@尾帧图结束', {});
    expect(out).toBe('起始画面动起来，结束画面结束');
  });

  it('无匹配标记时保留原样、不误删正文', () => {
    const out = resolveSeedance25PromptToNativeTokens('镜头缓缓推进', {});
    expect(out).toBe('镜头缓缓推进');
  });
});