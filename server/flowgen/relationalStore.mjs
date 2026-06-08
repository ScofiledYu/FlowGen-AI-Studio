import { emptyStore } from './store-json.mjs';
import * as usersRepo from './repos/usersRepo.mjs';
import * as projectsRepo from './repos/projectsRepo.mjs';
import * as membersRepo from './repos/membersRepo.mjs';
import * as assetsRepo from './repos/assetsRepo.mjs';
import * as fieldDefsRepo from './repos/fieldDefsRepo.mjs';
import { getPool } from './db.mjs';

/** @type {ReturnType<typeof emptyStore> | null} */
let metadataCache = null;

export async function relationalTablesReady() {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flowgen_users'`
  );
  return Number(rows[0]?.c || 0) > 0;
}

export async function loadMetadataCache() {
  const base = emptyStore();
  base.users = await usersRepo.listAllUsers();
  base.projects = await projectsRepo.listAllProjects();
  base.members = await membersRepo.listAllMembers();
  base.assets = await assetsRepo.listAllAssets();
  base.fieldDefinitions = await fieldDefsRepo.getFieldDefinitions();
  base.workspaces = {};
  base.chatHistory = {};
  base.meta = { version: 2, storage: 'relational' };
  metadataCache = base;
  return metadataCache;
}

export function getMetadataCache() {
  if (!metadataCache) throw new Error('[flowgen] Relational metadata cache not loaded');
  return metadataCache;
}

export async function persistMetadataCache(store) {
  await usersRepo.syncAllUsers(store.users || []);
  await projectsRepo.syncAllProjects(store.projects || []);
  await membersRepo.syncAllMembers(store.members || []);
  await assetsRepo.syncAllAssets(store.assets || []);
  if (store.fieldDefinitions) {
    await fieldDefsRepo.setFieldDefinitions(store.fieldDefinitions);
  }
  metadataCache = store;
}

export async function deleteProjectRelational(projectId) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM flowgen_workspace_slices WHERE project_id = ?', [projectId]);
    await conn.query('DELETE FROM flowgen_chat_sessions WHERE project_id = ?', [projectId]);
    await conn.query('DELETE FROM flowgen_assets WHERE project_id = ?', [projectId]);
    await conn.query('DELETE FROM flowgen_members WHERE project_id = ?', [projectId]);
    await conn.query('DELETE FROM flowgen_projects WHERE id = ?', [projectId]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const store = getMetadataCache();
  store.projects = store.projects.filter((p) => p.id !== projectId);
  store.members = store.members.filter((m) => m.projectId !== projectId);
  store.assets = store.assets.filter((a) => a.projectId !== projectId);
}
