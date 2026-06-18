/** FlowGen 全局账号角色（JWT / users 表） */
export const FLOWGEN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  PROJECT_ADMIN: 'project_admin',
  USER: 'user',
} as const;

export type FlowgenGlobalRole =
  | typeof FLOWGEN_ROLES.SUPER_ADMIN
  | typeof FLOWGEN_ROLES.ADMIN
  | typeof FLOWGEN_ROLES.PROJECT_ADMIN
  | typeof FLOWGEN_ROLES.USER;

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  project_admin: '项目管理员',
  user: '普通用户',
};

/** Excel / 表单中文权限 → 存储角色 */
export function normalizeGlobalRoleInput(raw: unknown): FlowgenGlobalRole {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return FLOWGEN_ROLES.USER;
  if (s === 'super_admin' || s === '超级管理员') return FLOWGEN_ROLES.SUPER_ADMIN;
  if (s === 'admin' || s === '管理员' || s === '系统管理员') return FLOWGEN_ROLES.ADMIN;
  if (s === 'project_admin' || s === '项目管理员' || s === '项目管理员权限') {
    return FLOWGEN_ROLES.PROJECT_ADMIN;
  }
  if (s === 'user' || s === '普通用户' || s === '用户') return FLOWGEN_ROLES.USER;
  return FLOWGEN_ROLES.USER;
}

export function globalRoleLabel(role: string | undefined): string {
  return ROLE_LABELS[role || ''] || role || '普通用户';
}

export function isGlobalAdminRole(role: string | undefined): boolean {
  return role === FLOWGEN_ROLES.SUPER_ADMIN || role === FLOWGEN_ROLES.ADMIN;
}

/** 平台级管理员（用户/项目管理页） */
export function isAdminRole(role: string | undefined): boolean {
  return isGlobalAdminRole(role);
}

export function isProjectAdminRole(role: string | undefined): boolean {
  return role === FLOWGEN_ROLES.PROJECT_ADMIN;
}

/** 在所分配项目内可增删改项目资产库 */
export function canManageProjectAssets(
  role: string | undefined,
  _opts?: { isProjectMember?: boolean }
): boolean {
  if (isGlobalAdminRole(role)) return true;
  return isProjectAdminRole(role);
}

/** 在所分配项目内可管理项目设置（封面、Skill 等）— 需结合项目列表（已按成员过滤） */
export function canManageAssignedProject(role: string | undefined): boolean {
  return isGlobalAdminRole(role) || isProjectAdminRole(role);
}

/**
 * 项目级管理（封面/资产/Skill）：超管与管理员=全部项目；项目管理员=仅其在列表中可见的已分配项目。
 * 服务端以 members 表为准（canManageInAssignedProject）；前端项目列表已对非平台管理员按成员过滤。
 */
export function canManageProjectCover(role: string | undefined): boolean {
  return canManageAssignedProject(role);
}
