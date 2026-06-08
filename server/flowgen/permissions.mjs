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

/** 项目资产库：普通用户只读；项目管理员与平台管理员可增删改 */
export function canManageProjectAssets(store, user, projectId) {
  if (!user || !canAccessProject(store, user, projectId)) return false;
  if (isGlobalAdminRole(user.role)) return true;
  if (user.role === FLOWGEN_ROLES.PROJECT_ADMIN) return true;
  return false;
}

/**
 * 项目设置：重命名、封面、Skill、成员等。
 * 平台管理员；全局「项目管理员」且为该项目成员；或项目内 owner/editor。
 */
export function canManageProject(store, user, projectId) {
  if (!user || !canAccessProject(store, user, projectId)) return false;
  if (isGlobalAdminRole(user.role)) return true;
  if (user.role === FLOWGEN_ROLES.PROJECT_ADMIN) return true;
  const m = store.members.find((x) => x.projectId === projectId && x.userId === user.id);
  return !!(m && (m.role === 'owner' || m.role === 'editor'));
}
