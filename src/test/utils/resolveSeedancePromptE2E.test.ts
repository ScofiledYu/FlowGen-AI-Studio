import { describe, expect, it } from 'vitest';
import {
  resolveSeedancePromptToNativeImageTokens,
  type ResolvePromptPlaceholdersOptions,
} from '../../../utils/promptMediaRefs';

/**
 * §5.8.8 端到端验证：用真实 fixture（20260709-seedance参考生视频.json）的
 * reference 配置，验证 FlowEditor reference 模式下最终发给豆包的 prompt 形态。
 *
 * 真实数据（fixture）：
 *   prompt = '@图片5和@图片2参考视频@主视频动作和镜头运行'
 *   referenceImages = [图片1(blob), 图片2(png), 图片3(blob), 图片4(png), 图片5(png)]
 *   referenceMovs = [视频1(mp4)]
 * FlowEditor reference 模式（L10308）用 buildReferenceIndexOptionsFromPlan 构建
 * referenceImageIndexByToken：@图片1→1 ... @图片5→5，@主视频→(视频槽，非图片)。
 */
describe('§5.8.8 端到端：真实 seedance 2.0 fixture → 豆包 prompt', () => {
  const makeOpts = (entries: Array<[string, number]>): ResolvePromptPlaceholdersOptions =>
    ({ referenceImageIndexByToken: new Map(entries) }) as ResolvePromptPlaceholdersOptions;

  it('真实 prompt：@图片5/@图片2 转图片N，@主视频移除', () => {
    // 模拟 FlowEditor reference 模式 buildReferenceIndexOptionsFromPlan 的输出 map
    const opts = makeOpts([
      ['@图片1', 1],
      ['@图片2', 2],
      ['@图片3', 3],
      ['@图片4', 4],
      ['@图片5', 5],
    ]);
    const prompt = '@图片5和@图片2参考视频@主视频动作和镜头运行';
    const out = resolveSeedancePromptToNativeImageTokens(prompt, opts);
    // @图片5→图片5，@图片2→图片2，@主视频→移除（靠 referenceVideos 字段）
    expect(out).toBe('图片5和图片2参考视频动作和镜头运行');
    expect(out).not.toContain('@');
    expect(out).not.toContain('主视频');
    expect(out).not.toContain('视作');
    // 确认含豆包原生「图片N」标记
    expect(out).toContain('图片5');
    expect(out).toContain('图片2');
  });

  it('多角色场景（用户案例风格）：8 张图多镜头 prompt', () => {
    const opts = makeOpts([
      ['@图片1', 1],
      ['@图片2', 2],
      ['@图片3', 3],
      ['@图片4', 4],
      ['@图片5', 5],
      ['@图片6', 6],
      ['@图片7', 7],
      ['@图片8', 8],
    ]);
    const prompt =
      '图片4为主场景，图片2为乘黄坐的椅子。@图片1=乘黄（儒雅老者）\n@图片7=女主\n@图片3=鸱吻@图片8=男主';
    const out = resolveSeedancePromptToNativeImageTokens(prompt, opts);
    // 注意：prompt 里前两个「图片4」「图片2」本就无 @ 前缀（用户手误），保持不变；
    // 带 @ 的 @图片1/@图片7/@图片3/@图片8 被替换
    expect(out).toContain('图片1=乘黄');
    expect(out).toContain('图片7=女主');
    expect(out).toContain('图片3=鸱吻');
    expect(out).toContain('图片8=男主');
    expect(out).not.toContain('@图片');
  });

  it('referenceImages 数组顺序与 prompt 序号一致性说明', () => {
    // 豆包官方：prompt 中「图片N」对应 referenceImages[N-1]（content 数组第 N 个 image_url）
    // 本函数只负责把 @图片N → 图片N；referenceImages 数组顺序由 FlowEditor 上传/组装保证
    // （uploadedRefOnlyImages 按 plan.images 顺序，plan.images 按 refImageSlotIndex 排序）。
    // 此测试仅固化「序号 = 数组下标 + 1」的契约。
    const opts = makeOpts([['@图片3', 3]]);
    const out = resolveSeedancePromptToNativeImageTokens('参考@图片3', opts);
    expect(out).toBe('参考图片3'); // 图片3 对应 referenceImages[2]
  });
});
