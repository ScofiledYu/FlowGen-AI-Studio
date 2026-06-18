/** 进入项目后透传给 AITOP 生图/生视频接口的计费上下文 */
export interface AitopBillingContext {
  /** 域账号 = 登录用户名 */
  domainAccount?: string;
  /** AITOP 项目 ID，对应请求体 scoreProjectId */
  scoreProjectId?: string;
}

let currentBilling: AitopBillingContext | null = null;

export function setAitopBillingContext(ctx: AitopBillingContext | null) {
  currentBilling = ctx;
}

export function getAitopBillingContext(): AitopBillingContext | null {
  return currentBilling;
}

export function buildAitopBillingQuery(ctx?: AitopBillingContext | null): string {
  const c = ctx ?? currentBilling;
  if (!c) return '';
  const parts: string[] = [];
  if (c.domainAccount) parts.push(`domainAccount=${encodeURIComponent(c.domainAccount)}`);
  if (c.scoreProjectId) parts.push(`scoreProjectId=${encodeURIComponent(c.scoreProjectId)}`);
  return parts.length ? `&${parts.join('&')}` : '';
}

/** 平台类报错展示：直接打印域账号与 scoreProjectId，便于用户复制给 AITOP 排查 */
export function formatAitopBillingContextForSupport(
  ctx?: AitopBillingContext | null
): string {
  const c = ctx ?? currentBilling;
  if (!c) return '';
  const lines: string[] = [];
  if (c.domainAccount?.trim()) {
    lines.push(`**域账号：** ${c.domainAccount.trim()}`);
  }
  if (c.scoreProjectId?.trim()) {
    lines.push(`**项目 ID（scoreProjectId）：** ${c.scoreProjectId.trim()}`);
  }
  return lines.length ? `\n${lines.join('\n')}` : '';
}
