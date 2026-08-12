import { describe, expect, it } from 'vitest';
import { resolveJimengPromptStripImageTokens } from '../../../utils/promptMediaRefs';

// 即梦3.0 Pro 官方文档（Volcengine 85621/1777001）：
// - 仅支持1张首帧图（通过 image_urls 字段传递）
// - prompt 为纯自然语言，无图片引用标记
// - 不支持尾帧/视频参考

describe('resolveJimengPromptStripImageTokens', () => {
  // 构造 opts（projectAssets 为空，不影响 @图片N/@首帧图 等标记的匹配）
  const makeOpts = () => ({ projectAssets: [] as unknown[] });

  it('@首帧图 → 起始画面（保留语义，首帧通过 imageUrls 字段传递）', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@首帧图角色走动，镜头推进',
      makeOpts()
    );
    expect(out).toBe('起始画面角色走动，镜头推进');
    expect(out).not.toContain('@首帧图');
  });

  it('@首帧图过渡到尾帧场景 → 起始画面过渡到尾帧场景（@首帧图 转自然语言）', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@首帧图过渡自然，表现角色警觉感',
      makeOpts()
    );
    expect(out).toBe('起始画面过渡自然，表现角色警觉感');
  });

  it('@图片1/@图片2 → 移除标记（即梦3.0 Pro 仅支持1张图，不需要引用）', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@图片1和@图片2在咖啡馆聊天',
      makeOpts()
    );
    expect(out).toBe('和在咖啡馆聊天');
    expect(out).not.toContain('@图片1');
    expect(out).not.toContain('@图片2');
  });

  it('@主图/@主体 → 移除标记', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@主图走动，@主体表情严肃',
      makeOpts()
    );
    expect(out).toBe('走动，表情严肃');
  });

  it('@尾帧图/@主视频 → 移除标记（即梦3.0 Pro 不支持尾帧/视频参考）', () => {
    const out = resolveJimengPromptStripImageTokens(
      '结尾@尾帧图，风格参考@主视频',
      makeOpts()
    );
    expect(out).toBe('结尾，风格参考');
    expect(out).not.toContain('@尾帧图');
    expect(out).not.toContain('@主视频');
  });

  it('@图片 简写 → 移除标记', () => {
    const out = resolveJimengPromptStripImageTokens(
      '根据@图片扩写场景',
      makeOpts()
    );
    expect(out).toBe('根据扩写场景');
  });

  it('未命中的 @标记 保留原样（避免误删用户正文）', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@首帧图场景，提到@未知角色',
      makeOpts()
    );
    expect(out).toBe('起始画面场景，提到@未知角色');
  });

  it('空 prompt 返回空', () => {
    expect(resolveJimengPromptStripImageTokens('', makeOpts())).toBe('');
  });

  it('无 @标记 的 prompt 原样返回', () => {
    const out = resolveJimengPromptStripImageTokens(
      '镜头缓缓推进，人物自然走动',
      makeOpts()
    );
    expect(out).toBe('镜头缓缓推进，人物自然走动');
  });

  it('综合场景：@首帧图 + @图片N + @主视频 混合', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@首帧图开场，@图片1走入画面，风格参考@主视频',
      makeOpts()
    );
    expect(out).toBe('起始画面开场，走入画面，风格参考');
  });

  it('用户案例：@首帧图过渡自然到@尾帧图 → 起始画面过渡自然到', () => {
    const out = resolveJimengPromptStripImageTokens(
      '@首帧图过渡自然到@尾帧图，从画面整体到局部特写',
      makeOpts()
    );
    // @首帧图→起始画面，@尾帧图→移除
    expect(out).toBe('起始画面过渡自然到，从画面整体到局部特写');
  });

  it('多 @首帧图 场景：全部转为起始画面', () => {
    const out = resolveJimengPromptStripImageTokens(
      '从@首帧图开始，到@首帧图结束',
      makeOpts()
    );
    expect(out).toBe('从起始画面开始，到起始画面结束');
  });
});
