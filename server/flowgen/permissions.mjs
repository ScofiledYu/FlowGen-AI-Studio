export const FLOWGEN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  PROJECT_ADMIN: 'project_admin',
  USER: 'user',
};

const VALID_GLOBAL_ROLES = new Set(Object.values(FLOWGEN_ROLES));

export function normalizeGlobalRoleInput(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return FLOWGEN_ROLES.USER;
  if (s === 'super_admin' || s === '超级管理员') return FLOWGEN_ROLES.SUPER_ADMIN;
  if (s === 'admin' || s === '管理员' || s === '系统管理员') return FLOWGEN_ROLES.ADMIN;
  if (s === 'project_admin' || s === '项目管理员') return FLOWGEN_ROLES.PROJECT_ADMIN;
  if (s === 'user' || s === '普通用户' || s === '用户') return FLOWGEN_ROLES.USER;
  return FLOWGEN_ROLES.USER;
}

export function assertValidGlobalRole(role) {
  const r = normalizeGlobalRoleInput(role);
  if (!VALID_GLOBAL_ROLES.has(r)) {
    throw new Error(`无效角色: ${role}`);
  }
  return r;
}

export function isGlobalAdminRole(role) {
  return role === FLOWGEN_ROLES.SUPER_ADMIN || role === FLOWGEN_ROLES.ADMIN;
}

export function isMember(store, projectId, userId) {
  return store.members.some((m) => m.projectId === projectId && m.userId === userId);
}

export function canAccessProject(store, user, projectId) {
  if (!user) return false;
  if (isGlobalAdminRole(user.role)) return true;
  return isMember(store, projectId, user.id);
}

/**
 * 项目级管理权限（封面 / 资产库 / Skill 等）：
 * - 超级管理员、管理员：所有可访问项目（即 AITOP 同步列表中的全部项目）
 * - 项目管理员：仅 members 表中已分配的项目
 */
export function canManageInAssignedProject(store, user, projectId) {
  if (!user || !projectId) return false;
  if (!canAccessProject(store, user, projectId)) return false;
  if (isGlobalAdminRole(user.role)) return true;
  if (user.role === FLOWGEN_ROLES.PROJECT_ADMIN) {
    return isMember(store, projectId, user.id);
  }
  return false;
}

/** 项目封面：超管/管理员=全部项目；项目管理员=仅已分配项目 */
export function canManageProjectCover(store, user, projectId) {
  return canManageInAssignedProject(store, user, projectId);
}

/** 项目资产库：普通用户只读；超管/管理员=全部项目；项目管理员=仅已分配项目 */
export function canManageProjectAssets(store, user, projectId) {
  if (!canAccessProject(store, user, projectId)) return false;
  return canManageInAssignedProject(store, user, projectId);
}

/**
 * 项目设置（Skill 等；不含封面）。
 * 超管/管理员、已分配的项目管理员、或项目内 owner/editor。
 */
export function canManageProject(store, user, projectId) {
  if (!user || !canAccessProject(store, user, projectId)) return false;
  if (canManageInAssignedProject(store, user, projectId)) return true;
  const m = store.members.find((x) => x.projectId === projectId && x.userId === user.id);
  return !!(m && (m.role === 'owner' || m.role === 'editor'));
}
