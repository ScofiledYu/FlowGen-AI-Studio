import {
  formatAitopBillingContextForSupport,
  type AitopBillingContext,
} from './aitopBilling.ts';

/**
 * 节点运行失败时的展示策略：
 * - 配置/文案类、AITOP 平台接口类错误：不附「输入素材排查」
 * - 仅当报错文案明确指向素材/规格时，才附素材排查列表
 */
/** AITOP100 平台或任务管线错误（非本地素材规格问题） */
export function isAitopPlatformError(errorText: string): boolean {
  const t = String(errorText || '');
  if (!t.trim()) return false;
  return (
    /返回的\s*data\s*为\s*\{\}/i.test(t) ||
    /data\s*为\s*\{\}/i.test(t) ||
    /状态成功.*进度\s*100/i.test(t) ||
    /进度\s*100.*data/i.test(t) ||
    /任务创建成功但未获取到\s*task\s*id/i.test(t) ||
    /任务状态查询失败|任务状态.*失败/i.test(t) ||
    /AITOP.*上传失败/i.test(t) ||
    /file\/upload/i.test(t) ||
    /AITOP\s*项目列表|AITOP\s*同步失败/i.test(t) ||
    /account balance not enough|余额不足/i.test(t) ||
    /\b1102\b/.test(t) ||
    /繁忙|稍后再试|请稍后|限流|负载|过载|rate\s*limit|throttl/i.test(t) ||
    /HTTP\s*5\d{2}/i.test(t) ||
    /轮询超时.*未获取到/i.test(t) ||
    /TRANSFER_FAIL/i.test(t) ||
    (/Nano Banana|image\s*2|Kling|Seedance|Vidu|即梦/i.test(t) &&
      /调用失败|任务失败|任务创建失败/i.test(t) &&
      !/比例|尺寸|分辨率|格式|过大|不符合/i.test(t))
  );
}

/** 报错文案是否暗示素材/规格问题 */
export function errorSuggestsMediaSpecIssue(errorText: string): boolean {
  const t = String(errorText || '');
  if (!t.trim()) return false;
  return /(比例|aspect\s*ratio|宽高比|分辨率|resolution|尺寸|dimension|file\s*size|像素|格式错误|不支持.*格式|不支持.*尾帧|超过\s*2\s*张|图片预处理|素材|过大|超出.*限制|不在.*之间|上传失败|未能上传|请检查主图|参考图|时长.*不一致|duration|帧率|fps|视频尺寸|不符合要求|不符合规格|invalid|out of range|must be between)/i.test(
    t
  );
}

export function shouldAppendRunMediaDiagnostics(errorText: string): boolean {
  const t = String(errorText || '');
  if (!t.trim()) return false;
  if (isAitopPlatformError(t)) return false;
  if (/请在创意描述中用\s*@/i.test(t)) return false;
  if (/创意描述中未使用\s*@\s*引用/i.test(t)) return false;
  if (/请先填写创意描述/i.test(t)) return false;
  if (/提示词为空|创意描述为空/i.test(t)) return false;
  if (/请填写提示词后再运行/i.test(t)) return false;
  if (/要求时长\s*\d|请更换素材或先剪辑/i.test(t)) return false;
  return errorSuggestsMediaSpecIssue(t);
}

/** 平台类错误时附 AITOP100 排查指引（替代素材排查列表） */
export function formatAitopPlatformSupportHint(
  errorText: string,
  billingCtx?: AitopBillingContext | null
): string {
  if (!isAitopPlatformError(errorText)) return '';
  const billingLines = formatAitopBillingContextForSupport(billingCtx);
  const billingNote = billingLines
    ? '请将上方 **Task ID**、域账号与项目 ID'
    : '请将上方 **Task ID**（如有）、域账号（当前登录用户名）与项目 ID（scoreProjectId）';
  return (
    `${billingLines}\n\n**平台说明：** 本次报错来自 **AITOP100 接口或任务结果**（非素材规格校验失败）。` +
    `${billingNote} 提供给 **AITOP100** 侧排查任务状态、结果回写与计费。`
  );
}
