import { describe, expect, it } from 'vitest';
import {
  resolveViduPromptStripImageTokens,
  type ResolvePromptPlaceholdersOptions,
  type ProjectAssetLabelRow,
} from '../../../utils/promptMediaRefs';

/**
 * vidu 2.0：提交 API prompt 为纯自然语言，首尾帧走 images 字段。
 * 对照 vidu 官方文档 platform.vidu.com/docs/image-to-video。
 */
describe('resolveViduPromptStripImageTokens', () => {
  const makeOpts = (projectAssets?: ProjectAssetLabelRow[]): ResolvePromptPlaceholdersOptions =>
    ({ projectAssets: projectAssets ?? [] }) as ResolvePromptPlaceholdersOptions;

  it('@主图 + @首帧图 + @尾帧图 → 纯自然语言', () => {
    const out = resolveViduPromptStripImageTokens(
      '@主图是女孩，从@首帧图过渡到@尾帧图，镜头缓缓拉开',
      makeOpts()
    );
    expect(out).toBe('是女孩，从起始画面过渡到结束画面，镜头缓缓拉开');
  });

  it('@图片1/@图片2 → 移除标记', () => {
    const out = resolveViduPromptStripImageTokens(
      '@图片1保持人物动作，@图片2作为结尾',
      makeOpts()
    );
    expect(out).toBe('保持人物动作，作为结尾');
  });

  it('@资产:名 → 移除标记', () => {
    const out = resolveViduPromptStripImageTokens(
      '参考@资产:卷卷生成视频',
      makeOpts([{ slug: '卷卷', name: '卷卷', url: 'https://x/juanjuan.png' }])
    );
    expect(out).toBe('参考生成视频');
  });

  it('@主体/@主视频/@视频1/@音频1 → 移除标记', () => {
    const out = resolveViduPromptStripImageTokens(
      '@主体动起来 @主视频切换 @视频1衔接 @音频1配乐',
      makeOpts()
    );
    expect(out).toBe('动起来 切换 衔接 配乐');
  });

  it('无标记时原样返回', () => {
    const out = resolveViduPromptStripImageTokens('镜头缓缓推进，人物自然走动', makeOpts());
    expect(out).toBe('镜头缓缓推进，人物自然走动');
  });
});