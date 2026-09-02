/**
 * seedance2.5 三种任务模式 API 请求本地模拟测试（mock fetch，不发真实请求、不扣积分）
 *
 * 覆盖：
 * 1) normal 常规生成（参考生）：taskType 不下发、ratio/duration 透传
 * 2) video_edit 视频编辑：taskType=video_edit 顶层下发、parameters.ratio=adaptive、duration=-1
 * 3) video_extend 视频延长：taskType=video_extend 顶层下发、ratio=adaptive、duration∈[4,30]
 * 4) 运行前校验拦截（缺参考视频 / 缺关键词）
 * 5) 2.0 型号保护：传 taskType 也不会下发
 * 6) 联网搜索 tools：2.0 normal+参考生+开 → 下发；2.5 normal+开 → 强制不下发（2.5 面板已移除）；video_edit/video_extend+开 → 强制不下发（§16.13 防回归）
 *
 * 运行：npx tsx scripts/seedance25-tasktype-api-mock-test.ts
 */
import { createDoubaoSeedanceVideoTask } from '../services/aitop.ts';
import {
  resolveSeedance25ParameterOverrides,
  validateSeedance25TaskTypeRun,
} from '../utils/seedance25TaskType.ts';
import type { SeedanceTaskType } from '../types.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? 'OK' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
}

/** 捕获到的请求（mock fetch） */
interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}
const captured: CapturedRequest[] = [];

/** mock 全局 fetch：记录 body，返回假任务创建成功 */
(globalThis as { fetch?: unknown }).fetch = async (url: unknown, init?: { body?: unknown }) => {
  captured.push({
    url: String(url),
    body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
  });
  return {
    ok: true,
    json: async () => ({ code: 0, success: true, data: { taskId: `mock-task-${captured.length}` } }),
  } as Response;
};

/** 模拟 FlowEditor 运行分支：校验 → 参数覆写 → 组装并提交 */
async function simulateRun(params: {
  taskType: SeedanceTaskType;
  prompt: string;
  referenceVideoUrls: string[];
  referenceImageUrls?: string[];
  referenceAudioUrls?: string[];
  panelRatio: string;
  panelDurationSec: number;
  model?: 'DOUBAO_SEEDANCE_2_5' | 'DOUBAO_SEEDANCE_2_0';
  resolution?: '480p' | '720p' | '1080p';
  /** 面板 tab（默认 reference 参考生）；联网搜索仅参考生 tab 生效 */
  seedanceMode?: 'text2img' | 'img2video' | 'reference';
  /** 面板「联网搜索」开关（默认 false） */
  webSearchEnabled?: boolean;
}): Promise<{ validationError: string | null; taskId: string | null }> {
  // 1. 前端运行前校验（与 FlowEditor handleNodeRun 一致）
  const validationError = validateSeedance25TaskTypeRun({
    taskType: params.taskType,
    prompt: params.prompt,
    referenceVideoCount: params.referenceVideoUrls.length,
  });
  if (validationError) return { validationError, taskId: null };

  // 2. parameters 覆写（与 FlowEditor resolveSeedance25ParameterOverrides 调用一致）
  const finalParams = resolveSeedance25ParameterOverrides(
    params.taskType,
    params.panelRatio,
    params.panelDurationSec
  );

  // 3. 提交（taskType 仅非 normal 时带，与 FlowEditor seedancePayload 一致）
  // 联网搜索（与 FlowEditor seedanceWebSearchOn 一致，L10583-L10591）：
  // 仅 2.0 系列参考生 tab + 面板开关开才传 tools；2.5 不支持联网（面板已移除），强制不传
  const isSeedance25 = (params.model ?? 'DOUBAO_SEEDANCE_2_5') === 'DOUBAO_SEEDANCE_2_5';
  const seedanceWebSearchOn =
    !isSeedance25 &&
    (params.seedanceMode ?? 'reference') === 'reference' &&
    (params.webSearchEnabled ?? false) &&
    params.taskType === 'normal';
  const taskId = await createDoubaoSeedanceVideoTask({
    model: params.model || 'DOUBAO_SEEDANCE_2_5',
    prompt: params.prompt,
    resolution: params.resolution || '1080p',
    ratio: finalParams.ratio,
    duration: finalParams.duration,
    camerafixed: false,
    generateAudio: false,
    seed: -1,
    generateNum: 1,
    ...(params.taskType !== 'normal' ? { taskType: params.taskType } : {}),
    ...(seedanceWebSearchOn ? { tools: { type: 'web_search' as const } } : {}),
    ...(params.referenceVideoUrls.length ? { referenceVideos: params.referenceVideoUrls } : {}),
    ...(params.referenceImageUrls?.length ? { referenceImages: params.referenceImageUrls } : {}),
    ...(params.referenceAudioUrls?.length ? { referenceAudios: params.referenceAudioUrls } : {}),
  });
  return { validationError: null, taskId };
}

function lastBody(): Record<string, unknown> {
  return captured[captured.length - 1].body;
}
function lastParameters(): Record<string, unknown> {
  return (lastBody().parameters || {}) as Record<string, unknown>;
}

async function main() {
  console.log('\n=== 场景 1：normal 常规生成（参考生：图+视频+音频）===\n');
  {
    const r = await simulateRun({
      taskType: 'normal',
      prompt: '参考 @视频1 中的动作，生成 @图片1 和 @图片2 中的角色打斗的视频',
      referenceVideoUrls: ['https://cos.example/ref-v1.mp4'],
      referenceImageUrls: ['https://cos.example/ref-i1.jpg', 'https://cos.example/ref-i2.jpg'],
      referenceAudioUrls: ['https://cos.example/ref-a1.mp3'],
      panelRatio: '16:9',
      panelDurationSec: 8,
    });
    console.log('  请求体：', JSON.stringify(lastBody(), null, 2));
    ok('校验通过', r.validationError === null);
    ok('任务创建成功', typeof r.taskId === 'string' && r.taskId.startsWith('mock-task-'));
    ok('model = DOUBAO_SEEDANCE_2_5', lastBody().model === 'DOUBAO_SEEDANCE_2_5');
    ok('normal 不下发 taskType', !('taskType' in lastBody()));
    ok('ratio 透传 16:9', lastParameters().ratio === '16:9');
    ok('duration 透传 8', lastParameters().duration === 8);
    ok('resolution 透传 1080p', lastParameters().resolution === '1080p');
    ok('referenceVideos 下发', Array.isArray(lastBody().referenceVideos));
    ok('referenceImages 下发（2 张）', (lastBody().referenceImages as unknown[]).length === 2);
    ok('referenceAudios 下发', Array.isArray(lastBody().referenceAudios));
    ok('generateNum = 1', lastBody().generateNum === 1);
  }

  console.log('\n=== 场景 2：video_edit 视频编辑 ===\n');
  {
    const r = await simulateRun({
      taskType: 'video_edit',
      prompt: '把 @视频1 的人物修改为 @图片1',
      referenceVideoUrls: ['https://cos.example/edit-v1.mp4'],
      referenceImageUrls: ['https://cos.example/edit-i1.jpg'],
      panelRatio: '16:9',
      panelDurationSec: 8,
    });
    console.log('  请求体：', JSON.stringify(lastBody(), null, 2));
    ok('校验通过', r.validationError === null);
    ok('taskType = video_edit（顶层）', lastBody().taskType === 'video_edit');
    ok('ratio 覆写为 adaptive', lastParameters().ratio === 'adaptive');
    ok('duration 覆写为 -1', lastParameters().duration === -1);
    ok('referenceVideos 仍下发', Array.isArray(lastBody().referenceVideos));
  }

  console.log('\n=== 场景 3：video_extend 视频延长 ===\n');
  {
    const r = await simulateRun({
      taskType: 'video_extend',
      prompt: '延续@视频1 的画面风格和人物动作，续写后续剧情',
      referenceVideoUrls: ['https://cos.example/extend-v1.mp4'],
      panelRatio: '9:16',
      panelDurationSec: 20,
    });
    console.log('  请求体：', JSON.stringify(lastBody(), null, 2));
    ok('校验通过', r.validationError === null);
    ok('taskType = video_extend（顶层）', lastBody().taskType === 'video_extend');
    ok('ratio 覆写为 adaptive', lastParameters().ratio === 'adaptive');
    ok('duration 透传 20（[4,30] 内）', lastParameters().duration === 20);
    const clamped = resolveSeedance25ParameterOverrides('video_extend', '16:9', 99);
    ok('duration 超 30 夹取为 30', clamped.duration === 30);
    const clampedMin = resolveSeedance25ParameterOverrides('video_extend', '16:9', 1);
    ok('duration 低于 4 夹取为 4', clampedMin.duration === 4);
  }

  console.log('\n=== 场景 4：运行前校验拦截（不提交 API）===\n');
  {
    const before = captured.length;
    const noVideo = await simulateRun({
      taskType: 'video_edit',
      prompt: '修改视频内容',
      referenceVideoUrls: [],
      panelRatio: '16:9',
      panelDurationSec: 8,
    });
    ok('video_edit 缺参考视频被拦截', noVideo.validationError?.includes('至少上传 1 个参考视频') ?? false);
    ok('拦截后未发请求', captured.length === before);

    const noKeyword = await simulateRun({
      taskType: 'video_edit',
      prompt: '生成一段新视频',
      referenceVideoUrls: ['https://cos.example/v.mp4'],
      panelRatio: '16:9',
      panelDurationSec: 8,
    });
    ok('video_edit 缺编辑关键词被拦截', noKeyword.validationError?.includes('至少一项') ?? false);
    ok('拦截后仍未发请求', captured.length === before);

    const extendNoKeyword = await simulateRun({
      taskType: 'video_extend',
      prompt: '把视频背景换成海边',
      referenceVideoUrls: ['https://cos.example/v.mp4'],
      panelRatio: '16:9',
      panelDurationSec: 10,
    });
    ok(
      'video_extend 缺延长关键词被拦截',
      (extendNoKeyword.validationError?.includes('向前延长') && extendNoKeyword.validationError?.includes('续写')) ?? false
    );
    ok('normal 模式不校验（缺视频也放行）',
      (await simulateRun({
        taskType: 'normal',
        prompt: '一只猫在草地上跑',
        referenceVideoUrls: [],
        panelRatio: '1:1',
        panelDurationSec: 5,
      })).validationError === null
    );
  }

  console.log('\n=== 场景 5：2.0 型号保护（taskType 不下发）===\n');
  {
    await createDoubaoSeedanceVideoTask({
      model: 'DOUBAO_SEEDANCE_2_0',
      prompt: '测试',
      ratio: '16:9',
      duration: 5,
      taskType: 'video_edit',
      referenceVideos: ['https://cos.example/v.mp4'],
    } as Parameters<typeof createDoubaoSeedanceVideoTask>[0]);
    ok('DOUBAO_SEEDANCE_2_0 即使传 taskType 也不下发', !('taskType' in lastBody()));
  }

  console.log('\n=== 场景 6：联网搜索 tools 参数（含 taskType 联动禁用，§16.13 防回归）===\n');
  {
    // 6a. 2.0 normal + 参考生 + 开 → 下发 tools（2.0 系列保留联网搜索）
    await simulateRun({
      model: 'DOUBAO_SEEDANCE_2_0',
      taskType: 'normal',
      prompt: '一只猫在草地上跑',
      referenceVideoUrls: [],
      panelRatio: '16:9',
      panelDurationSec: 5,
      webSearchEnabled: true,
    });
    const t1 = lastBody().tools as { type?: string } | undefined;
    ok('2.0 normal + 参考生 + 开联网搜索 → 下发 tools.type=web_search', t1?.type === 'web_search');

    // 6a2. 2.5 normal + 参考生 + 开 → 强制不下发（2.5 面板已移除联网功能，AiTop tools 为 2.0 专有参数）
    await simulateRun({
      taskType: 'normal',
      prompt: '一只猫在草地上跑',
      referenceVideoUrls: [],
      panelRatio: '16:9',
      panelDurationSec: 5,
      webSearchEnabled: true,
    });
    ok('2.5 normal + 开联网搜索 → 强制不下发 tools', !('tools' in lastBody()));

    // 6b. normal + 关 → 不下发
    await simulateRun({
      taskType: 'normal',
      prompt: '一只猫在草地上跑',
      referenceVideoUrls: [],
      panelRatio: '16:9',
      panelDurationSec: 5,
      webSearchEnabled: false,
    });
    ok('normal + 关联网搜索 → 不下发 tools', !('tools' in lastBody()));

    // 6c. video_edit + 开 → 强制不下发（§16.13：官方不支持，误传必报「请求参数错误」）
    const editRun = await simulateRun({
      taskType: 'video_edit',
      prompt: '把 @视频1 的人物修改为 @图片1',
      referenceVideoUrls: ['https://cos.example/edit-v1.mp4'],
      panelRatio: '16:9',
      panelDurationSec: 8,
      webSearchEnabled: true,
    });
    ok('video_edit + 开联网搜索 → 校验通过且任务创建成功', editRun.validationError === null && editRun.taskId !== null);
    ok('video_edit + 开联网搜索 → 强制不下发 tools（§16.13）', !('tools' in lastBody()));

    // 6d. video_extend + 开 → 强制不下发（§16.13）
    await simulateRun({
      taskType: 'video_extend',
      prompt: '延续@视频1 的画面风格和人物动作，续写后续剧情',
      referenceVideoUrls: ['https://cos.example/extend-v1.mp4'],
      panelRatio: '16:9',
      panelDurationSec: 10,
      webSearchEnabled: true,
    });
    ok('video_extend + 开联网搜索 → 强制不下发 tools（§16.13）', !('tools' in lastBody()));

    // 6e. 文生 tab（非 reference 模式）+ 开 → 不下发（seedanceMode 条件防护）
    await simulateRun({
      taskType: 'normal',
      prompt: '一只猫在草地上跑',
      referenceVideoUrls: [],
      panelRatio: '16:9',
      panelDurationSec: 5,
      seedanceMode: 'text2img',
      webSearchEnabled: true,
    });
    ok('文生 tab（非参考生）+ 开联网搜索 → 不下发 tools', !('tools' in lastBody()));
  }

  console.log('\n=== 场景 7：参考音频组合校验（图片+音频合法，纯音频拦截）===\n');
  {
    // 文档「文本 + 图片 + 音频」是合法组合，不应因无视频而误拦
    const r1 = await createDoubaoSeedanceVideoTask({
      model: 'DOUBAO_SEEDANCE_2_5',
      prompt: '参考 @图片1 生成带背景音乐的视频',
      ratio: '16:9',
      duration: 5,
      referenceImages: ['https://cos.example/i1.jpg'],
      referenceAudios: ['https://cos.example/a1.mp3'],
    });
    ok('图片+音频组合合法（不抛错）', typeof r1 === 'string' || r1 === null);
    ok('图片+音频组合发送 referenceAudios', Array.isArray(lastBody().referenceAudios));

    // 纯音频（无图无视频）仍应拦截
    let pureAudioThrew = false;
    try {
      await createDoubaoSeedanceVideoTask({
        model: 'DOUBAO_SEEDANCE_2_5',
        prompt: '测试',
        ratio: '16:9',
        duration: 5,
        referenceAudios: ['https://cos.example/a1.mp3'],
      });
    } catch (e) {
      pureAudioThrew = true;
    }
    ok('纯音频（无图无视频）仍被拦截', pureAudioThrew);
  }

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===\n`);
  if (fail > 0) process.exit(1);
}

void main();
