import type { SeedanceTaskType } from '../types';

/** seedance2.5 面板模型名（唯一字面量来源） */
export const SEEDANCE25_MODEL = 'seedance2.5';

export function isSeedance25Model(model: string | undefined): boolean {
  return model === SEEDANCE25_MODEL;
}

/** seedance2.5 参考生 tab 任务模式选项 */
export const SEEDANCE25_TASK_TYPE_OPTIONS: readonly {
  id: SeedanceTaskType;
  label: string;
  hint: string;
}[] = [
  { id: 'normal', label: '常规生成', hint: '参考 @视频/@图片/@音频 生成新视频' },
  { id: 'video_edit', label: '视频编辑', hint: '对输入视频的画面或音频进行增删改（需 ≥1 个参考视频，4-30s）' },
  { id: 'video_extend', label: '视频延长', hint: '基于输入视频继续延长后续内容（需 ≥1 个参考视频）' },
];

/** AiTop 文档：视频编辑提示词须包含的关键词（至少一项） */
export const SEEDANCE25_EDIT_KEYWORDS = [
  '编辑视频',
  '增加',
  '加上',
  '删除',
  '去掉',
  '修改',
  '替换',
  '改成',
] as const;

/**
 * 文档官方示例实际使用的近义表达（如「加一些小动物」「删掉背景音乐」），
 * 单字变体仅作前端预检放宽，最终仍以 API 校验为准。
 */
const SEEDANCE25_EDIT_KEYWORD_VARIANTS = ['加', '删', '添加', '去除', '消除'] as const;

/** AiTop 文档：视频延长提示词须包含的关键词（至少一项） */
export const SEEDANCE25_EXTEND_KEYWORDS = [
  '向前延长',
  '向后延长',
  '延续',
  '续写',
] as const;

/** 视频延长时长范围（秒） */
export const SEEDANCE25_EXTEND_DURATION_MIN = 4;
export const SEEDANCE25_EXTEND_DURATION_MAX = 30;

export function seedance25PromptHasTaskKeyword(
  taskType: SeedanceTaskType,
  prompt: string | undefined
): boolean {
  const text = String(prompt || '');
  if (taskType === 'video_edit') {
    return (
      SEEDANCE25_EDIT_KEYWORDS.some((k) => text.includes(k)) ||
      SEEDANCE25_EDIT_KEYWORD_VARIANTS.some((k) => text.includes(k))
    );
  }
  if (taskType === 'video_extend') {
    return SEEDANCE25_EXTEND_KEYWORDS.some((k) => text.includes(k));
  }
  return true;
}

/**
 * 运行前校验（前端拦截，避免浪费积分）：
 * - video_edit / video_extend 需 ≥1 个参考视频
 * - 提示词须包含对应任务模式关键词
 * 返回 null 表示通过；否则返回给用户看的错误文案。
 */
export function validateSeedance25TaskTypeRun(params: {
  taskType: SeedanceTaskType | undefined;
  prompt: string | undefined;
  referenceVideoCount: number;
}): string | null {
  const taskType = params.taskType || 'normal';
  if (taskType === 'normal') return null;
  const label = taskType === 'video_edit' ? '视频编辑' : '视频延长';
  if (params.referenceVideoCount < 1) {
    return `seedance2.5 ${label}需至少上传 1 个参考视频`;
  }
  if (!seedance25PromptHasTaskKeyword(taskType, params.prompt)) {
    return taskType === 'video_edit'
      ? `视频编辑提示词须包含：${SEEDANCE25_EDIT_KEYWORDS.join('、')} 中的至少一项`
      : `视频延长提示词须包含：${SEEDANCE25_EXTEND_KEYWORDS.join('、')} 中的至少一项`;
  }
  return null;
}

/**
 * taskType 对 parameters 的覆写规则（AiTop 文档）：
 * - video_edit：ratio=adaptive，duration 固定 -1
 * - video_extend：ratio=adaptive，duration 取值 [4,30]
 * - normal：按面板配置透传
 */
export function resolveSeedance25ParameterOverrides(
  taskType: SeedanceTaskType | undefined,
  ratio: string,
  durationSeconds: number
): { ratio: string; duration: number } {
  if (taskType === 'video_edit') {
    return { ratio: 'adaptive', duration: -1 };
  }
  if (taskType === 'video_extend') {
    const clamped = Math.min(
      SEEDANCE25_EXTEND_DURATION_MAX,
      Math.max(SEEDANCE25_EXTEND_DURATION_MIN, Math.round(durationSeconds) || SEEDANCE25_EXTEND_DURATION_MIN)
    );
    return { ratio: 'adaptive', duration: clamped };
  }
  return { ratio, duration: durationSeconds };
}
