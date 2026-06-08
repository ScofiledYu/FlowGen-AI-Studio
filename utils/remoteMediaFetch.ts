/**
 * 判断远程媒体 URL 是否应在浏览器侧优先走同源 `/proxy-file` 拉取。
 * 对象存储、短时签名链等通常不返回 Access-Control-Allow-Origin，
 * 先 fetch 直连会在控制台产生 CORS 报错并可能长时间挂起后才失败。
 */
export function remoteMediaUrlPreferSameOriginProxy(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  return (
    /aigc-cloud\.com/i.test(u) ||
    /kechuangai\.com/i.test(u) ||
    /aitop100app-/i.test(u) ||
    /aitop100/i.test(u) ||
    /\/ksc2\//i.test(u) ||
    /tos-cn-v-/i.test(u) ||
    /\.tos\./i.test(u) ||
    /volces\.com/i.test(u) ||
    /amazonaws\.com(\.cn)?/i.test(u) ||
    /X-Tos-/i.test(u) ||
    /X-Amz-/i.test(u) ||
    /dy_q=/i.test(u)
  );
}
