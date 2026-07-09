import { logPreloadJson, isPreloadDebugEnabled } from '../services/aitop';
import { getAitopBillingContext } from './aitopBilling';

function billingFieldsForLog(): { domainAccount?: string; scoreProjectId?: string } {
  const ctx = getAitopBillingContext();
  if (!ctx) return {};
  const out: { domainAccount?: string; scoreProjectId?: string } = {};
  if (ctx.domainAccount) out.domainAccount = ctx.domainAccount;
  if (ctx.scoreProjectId) out.scoreProjectId = ctx.scoreProjectId;
  return out;
}

function headersForLog(headers: Record<string, string>): Record<string, string> {
  const h = { ...headers };
  if (h['api-key']) h['api-key'] = '***';
  if (h.Authorization?.startsWith('Bearer ')) h.Authorization = 'Bearer ***';
  return h;
}

/** 与 services/aitop.ts 生图/生视频 preload 格式一致 */
export function logChatLlmPreload(spec: {
  model: string;
  url: string;
  upstreamUrl?: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}): void {
  if (!isPreloadDebugEnabled()) return;
  logPreloadJson({
    debugType: 'preload',
    channel: 'llm-chat',
    model: spec.model,
    method: 'POST',
    url: spec.url,
    ...(spec.upstreamUrl ? { upstreamUrl: spec.upstreamUrl } : {}),
    ...billingFieldsForLog(),
    headers: headersForLog(spec.headers),
    body: spec.body,
  });
}

export function isChatQwenDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('flowgen:debugChatQwen') === '1';
  } catch {
    return false;
  }
}
