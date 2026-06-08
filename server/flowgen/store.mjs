/**
 * FlowGen store facade: MySQL snapshot (when configured) or JSON file fallback.
 * Upload files remain on disk under FLOWGEN_DATA_DIR / data/flowgen/uploads.
 */
import { createHash, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { isMysqlConfigured } from './db.mjs';
import {
  emptyStore,
  normalizeStore,
  ensureDataDirs,
  loadStoreFromJson,
  saveStoreToJson,
  dataDir,
  storePath,
  uploadsDir,
} from './store-json.mjs';
import { loadStoreFromMysql, saveStoreToMysql } from './store-mysql.mjs';
import {
  relationalTablesReady,
  loadMetadataCache,
  getMetadataCache,
  persistMetadataCache,
} from './relationalStore.mjs';

const SALT_ROUNDS = 10;

/** @type {ReturnType<typeof emptyStore> | null} */
let cache = null;
let initialized = false;
/** @type {Promise<void>} */
let persistChain = Promise.resolve();
/** @type {ReturnType<typeof setTimeout> | null} */
let mysqlSaveDebounceTimer = null;
/** Last serialized store hash — skip redundant MySQL writes */
let lastMysqlPersistHash = null;
const MYSQL_SAVE_DEBOUNCE_MS = 3000;
/** @type {Promise<void>} */
let persistMetadataChain = Promise.resolve();

/**
 * @returns {'mysql' | 'json'}
 */
export function getStorageMode() {
  const explicit = (process.env.FLOWGEN_STORAGE || '').trim().toLowerCase();
  if (explicit === 'json') return 'json';
  if (explicit === 'relational') {
    if (!isMysqlConfigured()) {
      console.warn('[flowgen] FLOWGEN_STORAGE=relational but MYSQL_PASSWORD unset; using JSON');
      return 'json';
    }
    return 'relational';
  }
  if (explicit === 'mysql') {
    if (!isMysqlConfigured()) {
      console.warn('[flowgen] FLOWGEN_STORAGE=mysql but MYSQL_PASSWORD unset; using JSON');
      return 'json';
    }
    return 'mysql';
  }
  if (isMysqlConfigured()) return 'mysql';
  return 'json';
}

/** Load store into memory (required before HTTP handlers when using MySQL snapshot or relational metadata). */
export async function initStore() {
  if (initialized) return loadStore();
  ensureDataDirs();
  if (getStorageMode() === 'relational') {
    if (!(await relationalTablesReady())) {
      throw new Error('[flowgen] Relational tables missing; run: npm run mysql:init-v2 && npm run mysql:migrate-relational');
    }
    cache = await loadMetadataCache();
    console.log(`[flowgen] Storage: relational (${process.env.MYSQL_DATABASE || 'flowgen'})`);
  } else if (getStorageMode() === 'mysql') {
    const raw = await loadStoreFromMysql();
    cache = raw ? normalizeStore(JSON.parse(raw)) : emptyStore();
    console.log(`[flowgen] Storage: mysql (${process.env.MYSQL_DATABASE || 'flowgen'})`);
  } else {
    cache = loadStoreFromJson();
    console.log('[flowgen] Storage: json', storePath());
  }
  initialized = true;
  return cache;
}

export function loadStore() {
  if (!initialized) {
    if (getStorageMode() === 'json') {
      cache = loadStoreFromJson();
      initialized = true;
    } else {
      throw new Error('[flowgen] Store not initialized; call await initStore() before serving requests');
    }
  }
  return cache;
}

function flushMysqlPersistNow() {
  if (!cache) return;
  let payload;
  try {
    payload = JSON.stringify(cache);
  } catch (e) {
    console.error('[flowgen] saveStore stringify failed:', e?.message || e);
    return;
  }
  const hash = createHash('sha256').update(payload).digest('hex');
  if (hash === lastMysqlPersistHash) return;
  lastMysqlPersistHash = hash;
  persistChain = persistChain
    .then(() => saveStoreToMysql(payload))
    .catch((e) => {
      console.error('[flowgen] MySQL save failed:', e?.message || e);
    });
}

function scheduleMysqlPersist() {
  if (mysqlSaveDebounceTimer) clearTimeout(mysqlSaveDebounceTimer);
  mysqlSaveDebounceTimer = setTimeout(() => {
    mysqlSaveDebounceTimer = null;
    flushMysqlPersistNow();
  }, MYSQL_SAVE_DEBOUNCE_MS);
}

export function saveStore(store) {
  cache = store;
  if (getStorageMode() === 'relational') {
    persistMetadataChain = persistMetadataChain
      .then(() => persistMetadataCache(store))
      .catch((e) => {
        console.error('[flowgen] relational metadata save failed:', e?.message || e);
      });
    return;
  }
  if (getStorageMode() === 'mysql') {
    scheduleMysqlPersist();
    return;
  }
  saveStoreToJson(store);
}

/** Wait for pending MySQL writes (tests / graceful shutdown). */
export async function flushStore() {
  if (getStorageMode() === 'relational') {
    await persistMetadataChain;
    return;
  }
  if (mysqlSaveDebounceTimer) {
    clearTimeout(mysqlSaveDebounceTimer);
    mysqlSaveDebounceTimer = null;
    flushMysqlPersistNow();
  }
  await persistChain;
}

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(String(plain), String(hash));
}

export function bootstrapAdminIfNeeded(store) {
  const adminUser = process.env.FLOWGEN_BOOTSTRAP_ADMIN_USER || 'admin';
  const adminPass = process.env.FLOWGEN_BOOTSTRAP_ADMIN_PASSWORD || 'admin';
  const hasSuper = store.users.some((u) => u.role === 'super_admin');
  if (hasSuper) return store;
  const exists = store.users.some((u) => u.username === adminUser);
  if (exists) return store;
  const id = randomUUID();
  const now = new Date().toISOString();
  store.users.push({
    id,
    username: adminUser,
    passwordHash: hashPassword(adminPass),
    role: 'super_admin',
    extendedJson: {},
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
  });
  saveStore(store);
  console.warn(
    `[flowgen] Seeded super_admin user "${adminUser}". Change password after login (env FLOWGEN_BOOTSTRAP_ADMIN_* overrides).`
  );
  return store;
}

export { ensureDataDirs, dataDir, storePath, uploadsDir, emptyStore, normalizeStore };
