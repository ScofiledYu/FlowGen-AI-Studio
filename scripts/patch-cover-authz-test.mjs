import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

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

console.log('=== PATCH 封面越权修复（静态源码断言）===\n');

const routesPath = path.resolve('server/flowgen/routes.mjs');
const src = fs.readFileSync(routesPath, 'utf8');

ok('PATCH /projects/:projectId 路由存在', () => {
  assert.ok(src.includes("router.patch('/projects/:projectId'"), '应有 PATCH /projects/:projectId 路由');
});

ok('PATCH coverImage 分支调用 canManageProjectCover', () => {
  // 定位 PATCH 路由块
  const patchIdx = src.indexOf("router.patch('/projects/:projectId'");
  assert.ok(patchIdx >= 0, '应找到 PATCH 路由');
  const blockEnd = src.indexOf('}));', patchIdx);
  const block = src.slice(patchIdx, blockEnd);
  const coverBranchIdx = block.indexOf('coverImage !== undefined');
  assert.ok(coverBranchIdx >= 0, 'PATCH 块应含 coverImage !== undefined 分支');
  const coverBranch = block.slice(coverBranchIdx, coverBranchIdx + 400);
  assert.ok(
    coverBranch.includes('canManageProjectCover'),
    'coverImage 分支应调用 canManageProjectCover 权限校验'
  );
});

ok('POST /projects/:id/cover 调用 canManageProjectCover', () => {
  const idx = src.indexOf("'/projects/:projectId/cover'");
  assert.ok(idx >= 0);
  const block = src.slice(idx, idx + 600);
  assert.ok(block.includes('canManageProjectCover'));
});

ok('DELETE /projects/:id/cover 调用 canManageProjectCover', () => {
  const idx = src.indexOf("'/projects/:projectId/cover'");
  const delIdx = src.indexOf("router.delete(", idx);
  assert.ok(delIdx >= 0);
  const block = src.slice(delIdx, delIdx + 600);
  assert.ok(block.includes('canManageProjectCover'));
});

ok('asyncHandler wrapper 已定义', () => {
  assert.ok(src.includes('const asyncHandler'), '应定义 asyncHandler');
});

ok('错误中间件返回 JSON 非 HTML', () => {
  const errMiddlewareIdx = src.indexOf('router.use((err');
  assert.ok(errMiddlewareIdx >= 0, '应有错误中间件');
  const block = src.slice(errMiddlewareIdx, errMiddlewareIdx + 800);
  assert.ok(block.includes('res.status(500).json'), '错误中间件应返回 500 JSON');
  assert.ok(block.includes('isMysqlConnectionError'), '应处理 MySQL 断连');
});

ok('关键写路由被 asyncHandler 包裹', () => {
  assert.ok(src.includes("asyncHandler(async (req, res) => {"), '至少一个路由被 asyncHandler 包裹');
});

console.log(`\n=== 汇总：通过 ${pass}，失败 ${fail} ===`);
if (fail > 0) process.exit(1);
