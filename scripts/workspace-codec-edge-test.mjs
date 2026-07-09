import assert from 'node:assert/strict';
import {
  encodeWorkspacePayloadForDb,
  decodeWorkspacePayloadFromDb,
  WORKSPACE_COMPRESS_THRESHOLD,
  WORKSPACE_MAX_STORED_BYTES,
  WORKSPACE_GZIP_KEY,
} from '../server/flowgen/workspacePayloadCodec.mjs';

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
const okAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  [OK] ${name}`);
    pass++;
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e.message}`);
    fail++;
  }
};

console.log('=== workspacePayloadCodec 边界测试 ===\n');

// 1. 小 payload 不压缩
await okAsync('小 payload 原样返回', async () => {
  const r = await encodeWorkspacePayloadForDb({ a: 1 });
  assert.deepEqual(r.stored, { a: 1 });
  assert.equal(r.storedBytes, r.uncompressedBytes);
});

// 2. 阈值边界：未压缩字节恰好等于阈值不压缩
await okAsync('未压缩字节恰好等于阈值不压缩', async () => {
  // 构造序列化后字节数恰好等于阈值的 payload
  const target = WORKSPACE_COMPRESS_THRESHOLD;
  // {"v":"xxxxx"} 序列化后 = 8 + x 长度
  const xLen = target - 8;
  const payload = { v: 'x'.repeat(xLen) };
  const r = await encodeWorkspacePayloadForDb(payload);
  assert.equal(r.uncompressedBytes, target, `uncompressed 应等于阈值 ${target}`);
  assert.equal(r.storedBytes, r.uncompressedBytes, '等于阈值不应压缩');
  assert.ok(!(WORKSPACE_GZIP_KEY in (r.stored || {})), '不应含 gzip key');
});

// 2b. 刚超过阈值触发压缩
await okAsync('刚超过阈值触发 gzip', async () => {
  const target = WORKSPACE_COMPRESS_THRESHOLD + 1;
  const xLen = target - 8;
  const payload = { v: 'x'.repeat(xLen) };
  const r = await encodeWorkspacePayloadForDb(payload);
  assert.equal(r.uncompressedBytes, target);
  assert.ok(WORKSPACE_GZIP_KEY in (r.stored || {}), '应含 gzip key');
});

// 3. 超过阈值触发 gzip 包装
await okAsync('超过阈值触发 gzip 包装', async () => {
  const json = 'x'.repeat(WORKSPACE_COMPRESS_THRESHOLD + 100);
  const r = await encodeWorkspacePayloadForDb({ big: json });
  assert.ok(WORKSPACE_GZIP_KEY in (r.stored || {}), '应包含 gzip key');
  assert.ok(r.storedBytes < r.uncompressedBytes, '压缩后应更小');
});

// 4. round-trip 解压
await okAsync('gzip round-trip 解压一致', async () => {
  const payload = { nodes: Array.from({ length: 200 }, (_, i) => ({ id: i, data: 'x'.repeat(200) })) };
  const enc = await encodeWorkspacePayloadForDb(payload);
  const dec = await decodeWorkspacePayloadFromDb(enc.stored);
  assert.deepEqual(dec, payload);
});

// 5. 解压兼容无 gzip key 的普通对象
await okAsync('无 gzip key 的普通对象原样返回', async () => {
  const plain = { a: 1, b: 'hello' };
  const dec = await decodeWorkspacePayloadFromDb(plain);
  assert.deepEqual(dec, plain);
});

// 6. null / 数组原样返回
await okAsync('null 与数组原样返回', async () => {
  assert.equal(await decodeWorkspacePayloadFromDb(null), null);
  const arr = [1, 2, 3];
  assert.deepEqual(await decodeWorkspacePayloadFromDb(arr), arr);
});

// 7. 损坏的 base64 不崩溃（抛错即可，但应是可识别错误）
await okAsync('损坏的 gzip base64 抛错', async () => {
  await assert.rejects(
    decodeWorkspacePayloadFromDb({ [WORKSPACE_GZIP_KEY]: '!!!notvalidbase64gzip!!!' }),
    (err) => err instanceof Error
  );
});

// 8. 压缩后仍大于原文则回退明文（构造不可压缩的高熵数据）
await okAsync('不可压缩数据回退明文', async () => {
  // 高熵随机数据 gzip 压缩率低，可能压缩后更大
  const random = Array.from({ length: 6000 }, () =>
    Math.floor(Math.random() * 100000).toString(36)
  ).join('');
  const json = random.repeat(2);
  const r = await encodeWorkspacePayloadForDb({ big: json });
  // 即使触发压缩判断，若压缩后更大应回退明文
  if (r.uncompressedBytes > WORKSPACE_COMPRESS_THRESHOLD) {
    // 回退时 stored 不含 gzip key
    assert.ok(!(WORKSPACE_GZIP_KEY in (r.stored || {})) || r.storedBytes < r.uncompressedBytes);
  }
});

console.log(`\n=== 汇总：通过 ${pass}，失败 ${fail} ===`);
if (fail > 0) process.exit(1);
