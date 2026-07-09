import assert from 'node:assert/strict';

/**
 * 与 server.js 中 isPrivateOrUnsafeUrl 实现保持一致。
 * 若 server.js 实现变更，须同步本测试。
 */
function isPrivateOrUnsafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) return true;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host === '169.254.169.254' || host === '169.254.170.2' || host === 'metadata.google.internal') {
      return true;
    }
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
      if (a >= 224) return true;
    }
    if (/^f[cd][0-9a-f]*:/i.test(host) || /^fe[89ab][0-9a-f]*:/i.test(host) || host === '::1') return true;
    return false;
  } catch {
    return true;
  }
}

let pass = 0;
let fail = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`  [OK] ${name}`);
    pass++;
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
    fail++;
  }
};

console.log('=== SSRF 黑名单 (isPrivateOrUnsafeUrl) 测试 ===\n');

console.log('--- 应拒绝（返回 true）---');
ok('元数据 IP 169.254.169.254', () => assert.equal(isPrivateOrUnsafeUrl('http://169.254.169.254/latest/meta-data/'), true));
ok('元数据 IP 169.254.170.2', () => assert.equal(isPrivateOrUnsafeUrl('http://169.254.170.2/'), true));
ok('GCP 元数据 metadata.google.internal', () => assert.equal(isPrivateOrUnsafeUrl('http://metadata.google.internal/'), true));
ok('私网 10.0.0.1', () => assert.equal(isPrivateOrUnsafeUrl('http://10.0.0.1/'), true));
ok('私网 10.255.255.255', () => assert.equal(isPrivateOrUnsafeUrl('http://10.255.255.255/'), true));
ok('私网 172.16.0.1', () => assert.equal(isPrivateOrUnsafeUrl('http://172.16.0.1/'), true));
ok('私网 172.31.255.255', () => assert.equal(isPrivateOrUnsafeUrl('http://172.31.255.255/'), true));
ok('私网 192.168.1.1', () => assert.equal(isPrivateOrUnsafeUrl('http://192.168.1.1/'), true));
ok('链路本地 169.254.1.1', () => assert.equal(isPrivateOrUnsafeUrl('http://169.254.1.1/'), true));
ok('本网段 0.0.0.0', () => assert.equal(isPrivateOrUnsafeUrl('http://0.0.0.0/'), true));
ok('多播 224.0.0.1', () => assert.equal(isPrivateOrUnsafeUrl('http://224.0.0.1/'), true));
ok('非 http/https 协议 file:', () => assert.equal(isPrivateOrUnsafeUrl('file:///etc/passwd'), true));
ok('非 http/https 协议 ftp:', () => assert.equal(isPrivateOrUnsafeUrl('ftp://example.com/'), true));
ok('.local 域名', () => assert.equal(isPrivateOrUnsafeUrl('http://internal.local/'), true));
ok('.internal 域名', () => assert.equal(isPrivateOrUnsafeUrl('http://svc.internal/'), true));
ok('非法 URL', () => assert.equal(isPrivateOrUnsafeUrl('not a url'), true));
ok('IPv6 私网 fc00::', () => assert.equal(isPrivateOrUnsafeUrl('http://[fc00::1]/'), true));
ok('IPv6 链路本地 fe80::', () => assert.equal(isPrivateOrUnsafeUrl('http://[fe80::1]/'), true));

console.log('\n--- 应放行（返回 false）---');
ok('localhost', () => assert.equal(isPrivateOrUnsafeUrl('http://localhost:3001/api'), false));
ok('127.0.0.1', () => assert.equal(isPrivateOrUnsafeUrl('http://127.0.0.1:3001/'), false));
ok('::1', () => assert.equal(isPrivateOrUnsafeUrl('http://[::1]/'), false));
ok('公网 COS URL', () => assert.equal(isPrivateOrUnsafeUrl('https://aitop100app-1251510006.cos.ap-shanghai.myqcloud.com/x.jpg'), false));
ok('公网 aitop100 API', () => assert.equal(isPrivateOrUnsafeUrl('https://aitop100-api.hytch.com/'), false));
ok('公网普通域名', () => assert.equal(isPrivateOrUnsafeUrl('https://example.com/image.png'), false));
ok('公网 IP 8.8.8.8', () => assert.equal(isPrivateOrUnsafeUrl('http://8.8.8.8/'), false));

console.log(`\n=== 汇总：通过 ${pass}，失败 ${fail} ===`);
if (fail > 0) process.exit(1);
