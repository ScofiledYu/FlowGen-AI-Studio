/**
 * Import snapshot JSON store into relational tables.
 * Usage: FLOWGEN_STORAGE=relational node scripts/migrate-snapshot-to-relational.mjs
 */
import './load-env-local.mjs';
import { loadStoreFromMysql } from '../server/flowgen/store-mysql.mjs';
import { loadStoreFromJson, normalizeStore } from '../server/flowgen/store-json.mjs';
import { getPool } from '../server/flowgen/db.mjs';
import * as usersRepo from '../server/flowgen/repos/usersRepo.mjs';
import * as projectsRepo from '../server/flowgen/repos/projectsRepo.mjs';
import * as membersRepo from '../server/flowgen/repos/membersRepo.mjs';
import * as assetsRepo from '../server/flowgen/repos/assetsRepo.mjs';
import * as fieldDefsRepo from '../server/flowgen/repos/fieldDefsRepo.mjs';
import * as chatRepo from '../server/flowgen/repos/chatRepo.mjs';
import * as workspaceRepo from '../server/flowgen/repos/workspaceRepo.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2Schema = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'flowgen', 'schema-v2-relational.sql'),
  'utf8'
);

async function loadSnapshotRaw() {
  if (process.env.FROM_JSON === '1') {
    return loadStoreFromJson();
  }
  try {
    const raw = await loadStoreFromMysql();
    if (raw) return normalizeStore(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return loadStoreFromJson();
}

async function countRows(table) {
  const pool = getPool();
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number(rows[0]?.c || 0);
}

async function main() {
  if (!process.env.MYSQL_PASSWORD) {
    console.error('[migrate-relational] 请设置 MYSQL_PASSWORD');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'flowgen',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'flowgen',
    multipleStatements: true,
  });
  try {
    await conn.query(v2Schema);
  } finally {
    await conn.end();
  }

  const existingUsers = await countRows('flowgen_users');
  if (existingUsers > 0 && process.env.FORCE_MIGRATE !== '1') {
    console.log(`[migrate-relational] skip: flowgen_users already has ${existingUsers} rows`);
    process.exit(0);
  }

  const snap = await loadSnapshotRaw();
  console.log('[migrate-relational] snapshot:', {
    users: snap.users?.length || 0,
    projects: snap.projects?.length || 0,
    members: snap.members?.length || 0,
    assets: snap.assets?.length || 0,
    workspaces: Object.keys(snap.workspaces || {}).length,
    chat: Object.keys(snap.chatHistory || {}).length,
  });

  await usersRepo.syncAllUsers(snap.users || []);
  await projectsRepo.syncAllProjects(snap.projects || []);
  await membersRepo.syncAllMembers(snap.members || []);
  await assetsRepo.syncAllAssets(snap.assets || []);
  if (snap.fieldDefinitions) await fieldDefsRepo.setFieldDefinitions(snap.fieldDefinitions);

  for (const [chatId, record] of Object.entries(snap.chatHistory || {})) {
    if (!record || typeof record !== 'object') continue;
    await chatRepo.upsertChatSession(chatId, record);
  }

  const sliceCount = await workspaceRepo.importWorkspaceSlicesFromSnapshot(snap.workspaces || {});

  console.log('[migrate-relational] done:', {
    users: await countRows('flowgen_users'),
    projects: await countRows('flowgen_projects'),
    members: await countRows('flowgen_members'),
    assets: await countRows('flowgen_assets'),
    workspace_slices: await countRows('flowgen_workspace_slices'),
    chat_sessions: await countRows('flowgen_chat_sessions'),
    imported_slices: sliceCount,
  });
}

main().catch((e) => {
  console.error('[migrate-relational] failed:', e);
  process.exit(1);
});
