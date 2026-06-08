/**
 * One-time import: data/flowgen/store.json -> flowgen_store_snapshot (id=1).
 * Usage: set MYSQL_PASSWORD=... && node scripts/migrate-json-to-mysql.mjs
 * Skips if MySQL snapshot already has data unless FORCE_MIGRATE=1.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import './load-env-local.mjs';
import { getStorageMode, normalizeStore, emptyStore } from '../server/flowgen/store.mjs';
import { loadStoreFromMysql, saveStoreToMysql, mysqlSnapshotExists } from '../server/flowgen/store-mysql.mjs';
import { isMysqlConfigured } from '../server/flowgen/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function jsonStorePath() {
  const fromEnv = process.env.FLOWGEN_DATA_DIR;
  const dir = fromEnv ? path.resolve(fromEnv) : path.join(process.cwd(), 'data', 'flowgen');
  return path.join(dir, 'store.json');
}

async function main() {
  if (!isMysqlConfigured()) {
    console.error('[migrate] 请设置 MYSQL_PASSWORD');
    process.exit(1);
  }
  if (getStorageMode() !== 'mysql') {
    console.error('[migrate] 需要 FLOWGEN_STORAGE=mysql 或已配置 MYSQL_PASSWORD（且未设 FLOWGEN_STORAGE=json）');
    process.exit(1);
  }

  const p = jsonStorePath();
  if (!fs.existsSync(p)) {
    console.log('[migrate] 无 store.json，跳过（', p, '）');
    process.exit(0);
  }

  const raw = fs.readFileSync(p, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[migrate] store.json 解析失败:', e.message || e);
    process.exit(1);
  }
  const store = normalizeStore(parsed);
  const hasUsers = store.users.length > 0;
  const hasProjects = store.projects.length > 0;

  if (!hasUsers && !hasProjects) {
    console.log('[migrate] store.json 为空，跳过');
    process.exit(0);
  }

  const force = process.env.FORCE_MIGRATE === '1' || process.env.FORCE_MIGRATE === 'true';
  const exists = await mysqlSnapshotExists();
  if (exists && !force) {
    const existing = await loadStoreFromMysql();
    if (existing) {
      try {
        const prev = normalizeStore(JSON.parse(existing));
        if (prev.users.length > 0 || prev.projects.length > 0) {
          console.log('[migrate] MySQL 已有数据，跳过。若需覆盖请设 FORCE_MIGRATE=1');
          process.exit(0);
        }
      } catch {
        /* continue import */
      }
    }
  }

  const backup = `${p}.bak-${Date.now()}`;
  fs.copyFileSync(p, backup);
  console.log('[migrate] 已备份 JSON ->', backup);

  await saveStoreToMysql(JSON.stringify(store));
  console.log('[migrate] 已导入 MySQL:', {
    users: store.users.length,
    projects: store.projects.length,
    members: store.members.length,
    assets: store.assets.length,
    chatSessions: Object.keys(store.chatHistory || {}).length,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error('[migrate] 失败:', e.message || e);
  process.exit(1);
});
