import { fetchAitopAuthorizedProjects, fetchAitopCompanyAllProjects } from './aitopApi.mjs';
import { isGlobalAdminRole } from './permissions.mjs';

function aitopProjectId(item) {
  return String(item?.projectId ?? item?.id ?? '').trim();
}

/** 平台管理员同步 AITOP 时依次尝试：登录用户名 → FLOWGEN_AITOP_ADMIN_DOMAIN_ACCOUNT（如 liangyu） */
function adminDomainCandidates(username) {
  const out = [];
  const u = String(username || '').trim();
  if (u) out.push(u);
  const envDa =
    process.env.FLOWGEN_AITOP_ADMIN_DOMAIN_ACCOUNT ||
    process.env.FLOWGEN_AITOP_PLATFORM_DOMAIN ||
    '';
  const extra = String(envDa).trim();
  if (extra && !out.includes(extra)) out.push(extra);
  return out;
}

function upsertAitopProjectsIntoStore(store, user, items, { ownerMembership = false } = {}) {
  const allowedIds = new Set();
  const now = new Date().toISOString();

  for (const item of items) {
    const id = aitopProjectId(item);
    if (!id) continue;
    allowedIds.add(id);

    const name = String(item.projectName ?? item.name ?? id).trim() || id;
    const rawStatus = String(item.status ?? '').trim().toLowerCase();
    const status = rawStatus === 'inactive' || rawStatus === 'disabled' ? 'archived' : 'active';

    let proj = store.projects.find((p) => p.id === id);
    if (!proj) {
      proj = {
        id,
        name,
        status,
        coverImage: null,
        extendedJson: {
          aitopProjectId: id,
          companyId: item.companyId ?? null,
          aitopStatus: item.status ?? null,
        },
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      };
      store.projects.push(proj);
    } else {
      proj.name = name;
      proj.status = status;
      proj.updatedAt = now;
      proj.extendedJson = {
        ...(proj.extendedJson && typeof proj.extendedJson === 'object' ? proj.extendedJson : {}),
        aitopProjectId: id,
        companyId: item.companyId ?? proj.extendedJson?.companyId ?? null,
        aitopStatus: item.status ?? proj.extendedJson?.aitopStatus ?? null,
      };
    }

    const hasMember = store.members.some((m) => m.projectId === id && m.userId === user.id);
    if (!hasMember) {
      store.members.push({
        projectId: id,
        userId: user.id,
        role: ownerMembership ? 'owner' : 'editor',
      });
    }
  }

  return allowedIds;
}

/** 平台管理员：AITOP 不可用时，展示库内全部已同步 AITOP 项目 */
function syncAdminProjectsFromStoreFallback(store, user) {
  const allowedIds = new Set();
  for (const p of store.projects) {
    if (!p.extendedJson?.aitopProjectId) continue;
    allowedIds.add(p.id);
    const hasMember = store.members.some((m) => m.projectId === p.id && m.userId === user.id);
    if (!hasMember) {
      store.members.push({ projectId: p.id, userId: user.id, role: 'owner' });
    }
  }
  return { items: [], allowedIds, fallback: 'store' };
}

function finalizeUserProjectMembership(store, user, allowedIds, saveStore) {
  store.members = store.members.filter((m) => {
    if (m.userId !== user.id) return true;
    return allowedIds.has(m.projectId);
  });
  saveStore(store);
}

/**
 * 从 AITOP 拉取当前用户有权限的项目，同步到本地 metadata（项目行 + 成员关系）。
 * FlowGen 项目 id 使用 AITOP projectId（作为 scoreProjectId 透传给生成接口）。
 *
 * @param {ReturnType<import('./store-json.mjs').emptyStore>} store
 * @param {{ id: string; username: string; role: string }} user
 * @param {(s: typeof store) => void} saveStore
 */
export async function syncUserProjectsFromAitop(store, user, saveStore) {
  const useAllCompanyProjects = isGlobalAdminRole(user.role);

  let resp = null;
  let usedDomain = user.username;
  const domains = useAllCompanyProjects ? adminDomainCandidates(user.username) : [user.username];

  for (const da of domains) {
    if (!String(da || '').trim()) continue;
    usedDomain = da;
    resp = useAllCompanyProjects
      ? await fetchAitopCompanyAllProjects(da)
      : await fetchAitopAuthorizedProjects(da);
    if (resp?.success) break;
  }

  if (!resp?.success) {
    if (useAllCompanyProjects) {
      console.warn(
        `[flowgen] AITOP listAll failed for admin (tried: ${domains.join(', ')}):`,
        resp?.message || 'unknown'
      );
      const fb = syncAdminProjectsFromStoreFallback(store, user);
      finalizeUserProjectMembership(store, user, fb.allowedIds, saveStore);
      return fb;
    }
    const err = new Error(resp?.message || 'AITOP 项目列表获取失败');
    err.code = resp?.code;
    throw err;
  }

  const items = resp.data || [];
  let allowedIds = upsertAitopProjectsIntoStore(store, user, items, {
    ownerMembership: useAllCompanyProjects,
  });

  if (useAllCompanyProjects && allowedIds.size === 0) {
    const fb = syncAdminProjectsFromStoreFallback(store, user);
    for (const id of fb.allowedIds) allowedIds.add(id);
  }

  finalizeUserProjectMembership(store, user, allowedIds, saveStore);
  if (useAllCompanyProjects && items.length > 0) {
    console.log(
      `[flowgen] admin project sync via AITOP listAll (${usedDomain}): ${allowedIds.size} project(s)`
    );
  }
  return { items, allowedIds };
}

/**
 * 删除本地手动创建的旧项目（无 aitopProjectId 标记），用户明确只保留 AITOP 项目。
 * @returns {number} 删除的项目数
 */
export function purgeLegacyNonAitopProjects(store) {
  const legacyIds = new Set(
    (store.projects || [])
      .filter((p) => !p.extendedJson?.aitopProjectId)
      .map((p) => p.id)
  );
  if (legacyIds.size === 0) return 0;
  store.projects = store.projects.filter((p) => !legacyIds.has(p.id));
  store.members = store.members.filter((m) => !legacyIds.has(m.projectId));
  store.assets = store.assets.filter((a) => !legacyIds.has(a.projectId));
  return legacyIds.size;
}
