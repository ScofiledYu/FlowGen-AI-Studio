/**
 * 项目封面与项目级管理权限策略
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canManageProjectCover,
  canManageProjectAssets,
  canManageInAssignedProject,
  canManageProject,
} from '../server/flowgen/permissions.mjs';
import { isManualProjectCover, markProjectCoverSource } from '../server/flowgen/projectCoverMeta.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const store = {
  members: [
    { projectId: 'p-assigned', userId: 'u-proj-admin', role: 'editor' },
    { projectId: 'p-assigned', userId: 'u-editor', role: 'editor' },
    { projectId: 'p-other', userId: 'u-other', role: 'editor' },
  ],
};

const superAdmin = { id: 'u-sa', role: 'super_admin' };
const platformAdmin = { id: 'u-ad', role: 'admin' };
const projAdmin = { id: 'u-proj-admin', role: 'project_admin' };
const user = { id: 'u-editor', role: 'user' };

// --- 超管/管理员：所有项目 ---
{
  assert.equal(canManageProjectCover(store, superAdmin, 'p-assigned'), true);
  assert.equal(canManageProjectCover(store, superAdmin, 'p-other'), true);
  assert.equal(canManageProjectCover(store, platformAdmin, 'p-other'), true);
  assert.equal(canManageProjectAssets(store, platformAdmin, 'p-other'), true);
  assert.equal(canManageInAssignedProject(store, superAdmin, 'p-other'), true);
}

// --- 项目管理员：仅已分配项目 ---
{
  assert.equal(canManageProjectCover(store, projAdmin, 'p-assigned'), true, '已分配项目可改封面');
  assert.equal(canManageProjectCover(store, projAdmin, 'p-other'), false, '未分配项目不可改封面');
  assert.equal(canManageProjectAssets(store, projAdmin, 'p-assigned'), true);
  assert.equal(canManageProjectAssets(store, projAdmin, 'p-other'), false);
  assert.equal(canManageInAssignedProject(store, projAdmin, 'p-other'), false);
}

// --- 普通用户 / editor：不可改封面与资产 ---
{
  assert.equal(canManageProjectCover(store, user, 'p-assigned'), false);
  assert.equal(canManageProjectAssets(store, user, 'p-assigned'), false);
  assert.equal(canManageProject(store, user, 'p-assigned'), true, 'editor 仍可改 Skill 等项目设置');
}

// --- 手动封面标记 ---
{
  assert.equal(isManualProjectCover({ coverSource: 'manual' }), true);
  assert.equal(isManualProjectCover({ coverSource: 'auto' }), false);
  assert.equal(markProjectCoverSource({}, 'manual').coverSource, 'manual');
}

// --- routes：不得自动 sync；封面按项目校验 ---
{
  const routesSrc = fs.readFileSync(path.join(root, 'server/flowgen/routes.mjs'), 'utf8');
  assert.ok(!routesSrc.includes('syncProjectCoverFromWorkspaceGraph'));
  assert.ok(routesSrc.includes('canManageProjectCover(store, req.user, p.id)'));
}

{
  const coverSrc = fs.readFileSync(path.join(root, 'server/flowgen/workspaceProjectCover.mjs'), 'utf8');
  assert.ok(!coverSrc.includes('export async function syncProjectCoverFromWorkspaceGraph'));
}

console.log('project-cover-policy-test: 全部通过');
