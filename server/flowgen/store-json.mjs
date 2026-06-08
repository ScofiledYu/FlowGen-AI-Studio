/**
 * JSON file persistence for FlowGen (dev / fallback when MySQL not configured).
 */
import fs from 'fs';
import path from 'path';

function dataDir() {
  const fromEnv = process.env.FLOWGEN_DATA_DIR;
  return fromEnv ? path.resolve(fromEnv) : path.join(process.cwd(), 'data', 'flowgen');
}

function storePath() {
  return path.join(dataDir(), 'store.json');
}

function uploadsDir(projectId) {
  return path.join(dataDir(), 'uploads', projectId);
}

export function emptyStore() {
  return {
    users: [],
    projects: [],
    members: [],
    workspaces: {},
    assets: [],
    fieldDefinitions: { user: [], project: [] },
    chatHistory: {},
    meta: { version: 1 },
  };
}

export function normalizeStore(parsed) {
  const base = emptyStore();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return base;
  }
  const fd =
    parsed.fieldDefinitions && typeof parsed.fieldDefinitions === 'object' && !Array.isArray(parsed.fieldDefinitions)
      ? parsed.fieldDefinitions
      : null;
  return {
    ...base,
    ...parsed,
    users: Array.isArray(parsed.users) ? parsed.users : base.users,
    projects: Array.isArray(parsed.projects) ? parsed.projects : base.projects,
    members: Array.isArray(parsed.members) ? parsed.members : base.members,
    workspaces:
      parsed.workspaces && typeof parsed.workspaces === 'object' && !Array.isArray(parsed.workspaces)
        ? parsed.workspaces
        : {},
    assets: Array.isArray(parsed.assets) ? parsed.assets : base.assets,
    fieldDefinitions: fd
      ? {
          user: Array.isArray(fd.user) ? fd.user : [],
          project: Array.isArray(fd.project) ? fd.project : [],
        }
      : base.fieldDefinitions,
    chatHistory:
      parsed.chatHistory && typeof parsed.chatHistory === 'object' && !Array.isArray(parsed.chatHistory)
        ? parsed.chatHistory
        : base.chatHistory,
    meta:
      parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)
        ? { ...base.meta, ...parsed.meta }
        : base.meta,
  };
}

export function ensureDataDirs() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(path.join(dataDir(), 'uploads'), { recursive: true });
}

export function loadStoreFromJson() {
  ensureDataDirs();
  const p = storePath();
  if (!fs.existsSync(p)) {
    const s = emptyStore();
    fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8');
    return s;
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function saveStoreToJson(store) {
  ensureDataDirs();
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
}

export { dataDir, storePath, uploadsDir };
