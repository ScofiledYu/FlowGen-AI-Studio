import { describe, expect, it } from 'vitest';
import {
  resolveSeedancePromptToNativeImageTokens,
  type ResolvePromptPlaceholdersOptions,
} from '../../../utils/promptMediaRefs';

/**
 * §5.8.8：Seedance 2.0 提交豆包 API 用原生「图片N」标记。
 * 对照官方文档：82379/2222480 提示词指南、82379/2291680 教程（必须用素材类型+序号格式）。
 * 模拟用户案例（乘黄/女主/鸱吻/男主/机器人 多角色多镜头场景）验证 prompt 形态。
 */
describe('resolveSeedancePromptToNativeImageTokens', () => {
  const makeOpts = (entries: Array<[string, number]>): ResolvePromptPlaceholdersOptions =>
    ({ referenceImageIndexByToken: new Map(entries) }) as ResolvePromptPlaceholdersOptions;

  it('@图片N → 图片N（多角色场景，对齐 referenceImages 数组顺序）', () => {
    // 模拟用户案例：@图片1=乘黄 @图片7=女主 @图片3=鸱吻 @图片8=男主
    const opts = makeOpts([
      ['@图片1', 1],
      ['@图片7', 7],
      ['@图片3', 3],
      ['@图片8', 8],
    ]);
    const prompt = '@图片1=乘黄（儒雅老者）\n@图片7=女主\n@图片3=鸱吻@图片8=男主';
    const out = resolveSeedancePromptToNativeImageTokens(prompt, opts);
    expect(out).toBe('图片1=乘黄（儒雅老者）\n图片7=女主\n图片3=鸱吻图片8=男主');
    expect(out).not.toContain('@');
    expect(out).not.toContain('视作');
    expect(out).not.toContain('（面板参考');
  });

  it('@主图 → 图片N（豆包无主图概念，按 map 落到数组序号）', () => {
    const opts = makeOpts([['@主图', 1], ['@图片1', 2]]);
    const out = resolveSeedancePromptToNativeImageTokens('以@主图为首帧，@图片1为场景', opts);
    expect(out).toBe('以图片1为首帧，图片2为场景');
  });

  it('@主图 兜底：map 无 @主图 时回退 @图片1', () => {
    const opts = makeOpts([['@图片1', 3]]);
    const out = resolveSeedancePromptToNativeImageTokens('参考@主图生成', opts);
    expect(out).toBe('参考图片3生成');
  });

  it('@图片（简写）→ 图片1', () => {
    const opts = makeOpts([['@图片1', 1]]);
    const out = resolveSeedancePromptToNativeImageTokens('根据@图片扩写', opts);
    expect(out).toBe('根据图片1扩写');
  });

  it('@首帧图→起始画面、@尾帧图→结束画面（转为自然语言，保留语义）；@主视频 移除（靠 referenceVideos 字段）', () => {
    const opts = makeOpts([['@首帧图', 1], ['@尾帧图', 2]]);
    const out = resolveSeedancePromptToNativeImageTokens('首帧@首帧图，尾帧@尾帧图，风格参考@主视频', opts);
    // @首帧图 → 起始画面，@尾帧图 → 结束画面（保留用户语义，避免移除后 prompt 语义断裂）
    expect(out).toBe('首帧起始画面，尾帧结束画面，风格参考');
    expect(out).not.toContain('@首帧图');
    expect(out).not.toContain('@尾帧图');
    expect(out).not.toContain('@主视频');
  });

  it('用户案例：@首帧图过渡自然到@尾帧图 → 起始画面过渡自然到结束画面（保留语义通顺）', () => {
    const opts = makeOpts([['@首帧图', 1], ['@尾帧图', 2]]);
    const out = resolveSeedancePromptToNativeImageTokens(
      '@首帧图过渡自然到@尾帧图，从画面整体到局部特写，表现出画面角色的警觉感',
      opts
    );
    expect(out).toBe('起始画面过渡自然到结束画面，从画面整体到局部特写，表现出画面角色的警觉感');
    expect(out).not.toContain('@首帧图');
    expect(out).not.toContain('@尾帧图');
  });

  it('仅用 @首帧图/@尾帧图 无 @图片N（map 为空时仍正确处理首尾帧）', () => {
    // map 为空：用户只用首尾帧，无参考图
    const opts = makeOpts([]);
    const out = resolveSeedancePromptToNativeImageTokens(
      '@首帧图过渡自然到@尾帧图，表现警觉感',
      opts
    );
    expect(out).toBe('起始画面过渡自然到结束画面，表现警觉感');
  });

  it('未在 map 中的 @标记 保留原样（避免误删用户正文）', () => {
    const opts = makeOpts([['@图片1', 1]]);
    const out = resolveSeedancePromptToNativeImageTokens('@图片1场景，提到@未知角色', opts);
    expect(out).toBe('图片1场景，提到@未知角色');
  });

  it('无 map 或无匹配时原样返回', () => {
    const opts = makeOpts([]);
    expect(resolveSeedancePromptToNativeImageTokens('纯文本无引用', opts)).toBe('纯文本无引用');
    expect(resolveSeedancePromptToNativeImageTokens('', opts)).toBe('');
    expect(
      resolveSeedancePromptToNativeImageTokens('@图片1场景', undefined as unknown as ResolvePromptPlaceholdersOptions)
    ).toBe('@图片1场景');
  });

  it('多 token 同句：从后往前替换 index 不位移', () => {
    const opts = makeOpts([
      ['@图片1', 1],
      ['@图片2', 2],
      ['@图片3', 3],
    ]);
    const out = resolveSeedancePromptToNativeImageTokens('@图片3在@图片1左侧，@图片2居中', opts);
    expect(out).toBe('图片3在图片1左侧，图片2居中');
  });

  it('官方句式形态：图片N=角色定义（对齐 82379/2222480 主体定义句式）', () => {
    // 官方推荐：将 图片1 中的 [...] 定义为 主体N
    const opts = makeOpts([
      ['@图片1', 1],
      ['@图片2', 2],
    ]);
    const out = resolveSeedancePromptToNativeImageTokens(
      '将@图片1中的女人定义为女主，将@图片2中的男人定义为男主',
      opts
    );
    expect(out).toBe('将图片1中的女人定义为女主，将图片2中的男人定义为男主');
  });
});
