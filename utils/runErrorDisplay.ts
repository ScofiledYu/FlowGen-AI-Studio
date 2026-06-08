/**
 * 节点运行失败时的展示策略：配置/文案类错误不必附「输入素材排查」长列表。
 */
export function shouldAppendRunMediaDiagnostics(errorText: string): boolean {
  const t = String(errorText || '');
  if (!t.trim()) return false;
  if (/请在创意描述中用\s*@/i.test(t)) return false;
  if (/创意描述中未使用\s*@\s*引用/i.test(t)) return false;
  if (/请先填写创意描述/i.test(t)) return false;
  if (/提示词为空|创意描述为空/i.test(t)) return false;
  if (/请填写提示词后再运行/i.test(t)) return false;
  if (/要求时长\s*\d|请更换素材或先剪辑/i.test(t)) return false;
  return true;
}
