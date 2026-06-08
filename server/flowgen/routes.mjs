import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import {
  loadStore,
  saveStore,
  hashPassword,
  verifyPassword,
  bootstrapAdminIfNeeded,
  uploadsDir,
  ensureDataDirs,
} from './store.mjs';
import { signToken, authMiddleware, requireAdmin } from './jwt.mjs';
import { normalizeCategoryForStore } from './subjectCategory.mjs';
import {
  ensureWorkspaceEnvelope,
  getUserWorkspaceView,
  putUserWorkspaceSlice,
  isPerUserWorkspaceEnvelope,
} from './workspacePerUser.mjs';
import { sanitizeWorkspacePayload } from '../../utils/persistSanitize.mjs';
import * as workspaceRepo from './repos/workspaceRepo.mjs';
import * as chatRepo from './repos/chatRepo.mjs';
import { deleteProjectRelational } from './relationalStore.mjs';
import {
  canAccessProject,
  canManageProject,
  canManageProjectAssets,
  isMember,
  assertValidGlobalRole,
  normalizeGlobalRoleInput,
} from './permissions.mjs';
import { pingMysql, isMysqlConfigured } from './db.mjs';
import { getStorageMode } from './store.mjs';
import { saveNodeMediaFile, resolveNodeMediaFilePath } from './nodeMedia.mjs';
import {
  saveProjectCoverFile,
  resolveProjectCoverFile,
  deleteProjectCoverFile,
  normalizeProjectCoverImageForApi,
} from './projectCover.mjs';
import { syncProjectCoverFromWorkspaceGraph } from './workspaceProjectCover.mjs';
import {
  assetThumbPath,
  deleteAssetThumbIfExists,
  ensureAssetThumbFile,
} from './assetThumb.mjs';
import { isImageAssetMime, normalizeAssetMime } from './assetMime.mjs';

function assetApiPaths(projectId, assetId) {
  const base = `/flowgen-api/projects/${projectId}/assets/${assetId}`;
  return {
    file: `${base}/file`,
    thumb: `${base}/thumb`,
  };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });

function assetDebugEnabled() {
  return process.env.FLOWGEN_DEBUG_ASSETS === '1' || process.env.FLOWGEN_DEBUG_ASSETS === 'true';
}

function logAssetDebug(...args) {
  if (assetDebugEnabled()) console.warn('[flowgen:assets]', ...args);
}

/** 从完整 URL 解析标签（含挂载前缀 /flowgen-api）；避免 req.query 在部分代理/版本下与 originalUrl 不一致 */
function categoryFromUrlQuery(req) {
  try {
    const raw = req.originalUrl || req.url || '';
    const qm = raw.indexOf('?');
    if (qm === -1) return '';
    const sp = new URLSearchParams(raw.slice(qm + 1));
    const b64 = (sp.get('categoryB64') || '').trim();
    if (b64) {
      try {
        return Buffer.from(b64, 'base64').toString('utf8').trim();
      } catch {
        return '';
      }
    }
    return (sp.get('category') || '').trim();
  } catch {
    return '';
  }
}

function getUser(store, id) {
  return store.users.find((u) => u.id === id);
}

function getProject(store, id) {
  return store.projects.find((p) => p.id === id);
}

/** 列表展示用：兼容 name 为空或仅写在 extendedJson 的旧数据 */
function projectNameFromRow(p) {
  if (!p) return '';
  if (typeof p.name === 'string' && p.name.trim()) return p.name.trim();
  const ext = p.extendedJson && typeof p.extendedJson === 'object' ? p.extendedJson : {};
  for (const k of ['title', 'projectName', 'displayName']) {
    const v = ext[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return p.id ? `未命名 (${String(p.id).slice(0, 8)})` : '';
}

function requireProjectAssetWrite(req, res, next) {
  const store = loadStore();
  const p = getProject(store, req.params.projectId);
  if (!p) return res.status(404).json({ error: '项目不存在' });
  if (!canManageProjectAssets(store, req.user, p.id)) {
    return res.status(403).json({
      error: '无权管理项目资产库（普通用户仅可查看与引用；项目管理员或平台管理员可增删改）',
    });
  }
  next();
}

export function createFlowgenRouter() {
  const router = express.Router();

  router.get('/health/db', async (_req, res) => {
    const storage = getStorageMode();
    if (!isMysqlConfigured()) {
      return res.json({
        ok: storage === 'json',
        storage,
        mysql: { configured: false, message: 'MYSQL_PASSWORD 未设置；当前使用 JSON 文件存储' },
      });
    }
    const mysqlStatus = await pingMysql();
    const storageOk =
      storage === 'json'
        ? mysqlStatus.ok
        : storage === 'relational'
          ? mysqlStatus.ok
          : mysqlStatus.ok && storage === 'mysql';
    return res.json({
      ok: storageOk,
      storage,
      mysql: { configured: true, ...mysqlStatus },
    });
  });

  router.post('/auth/logout', (_req, res) => {
    res.json({ ok: true });
  });

  router.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '需要用户名和密码' });
    }
    let store = loadStore();
    store = bootstrapAdminIfNeeded(store);
    const user = store.users.find((u) => u.username === String(username));
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    // 检查用户状态
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
    }
    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        extendedJson: user.extendedJson || {},
        mustChangePassword: !!user.mustChangePassword,
      },
    });
  });

  router.get('/auth/me', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const user = getUser(store, req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      extendedJson: user.extendedJson || {},
      mustChangePassword: !!user.mustChangePassword,
    });
  });

  router.post('/auth/change-password', authMiddleware(true), (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: '新密码至少 4 位' });
    }
    const store = loadStore();
    const user = getUser(store, req.user.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    if (currentPassword && !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: '当前密码错误' });
    }
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ ok: true });
  });

  router.get('/users', authMiddleware(true), requireAdmin, (req, res) => {
    let store = loadStore();
    store = bootstrapAdminIfNeeded(store);
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const role = (req.query.role || '').toString().trim();
    const center = (req.query.center || '').toString().trim();
    const status = (req.query.status || '').toString().trim();

    /** 与项目成员表一致：用户列表附带已加入的项目，便于与用户管理/项目成员双向对照 */
    /** @type {Map<string, Array<{ id: string; name: string }>>} */
    const projectsByUser = new Map();
    for (const m of store.members) {
      const proj = store.projects.find((p) => p.id === m.projectId);
      const name = projectNameFromRow(proj) || m.projectId;
      const list = projectsByUser.get(m.userId) || [];
      if (!list.some((x) => x.id === m.projectId)) {
        list.push({ id: m.projectId, name });
        projectsByUser.set(m.userId, list);
      }
    }
    for (const [, list] of projectsByUser) {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    }

    let rows = store.users.map((u) => {
      const ext = u.extendedJson || {};
      return {
        id: u.id,
        username: u.username,
        displayName: ext.displayName || ext.realName || ext.name || '',
        role: u.role,
        center: ext.center || '',
        status: u.status || 'active',
        extendedJson: ext,
        mustChangePassword: !!u.mustChangePassword,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        projects: projectsByUser.get(u.id) || [],
      };
    });
    
    if (q) {
      rows = rows.filter(
        (r) =>
          r.username.toLowerCase().includes(q) ||
          (r.displayName && r.displayName.toLowerCase().includes(q)) ||
          JSON.stringify(r.extendedJson || {}).toLowerCase().includes(q) ||
          (Array.isArray(r.projects) &&
            r.projects.some((p) => String(p.name).toLowerCase().includes(q)))
      );
    }
    if (role) rows = rows.filter((r) => r.role === role);
    if (center) rows = rows.filter((r) => r.center === center);
    if (status) rows = rows.filter((r) => r.status === status);
    
    res.json({ users: rows });
  });

  router.post('/users', authMiddleware(true), requireAdmin, (req, res) => {
    const { username, password, role = 'user', center = '', status = 'active', extendedJson = {}, mustChangePassword = true } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '需要用户名与初始密码' });
    const store = loadStore();
    if (store.users.some((u) => u.username === String(username))) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    const now = new Date().toISOString();
    const ext = typeof extendedJson === 'object' && extendedJson ? extendedJson : {};
    if (center) ext.center = center;
    const row = {
      id: randomUUID(),
      username: String(username),
      passwordHash: hashPassword(password),
      role: assertValidGlobalRole(role),
      status: String(status),
      extendedJson: ext,
      mustChangePassword: !!mustChangePassword,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(row);
    saveStore(store);
    res.status(201).json({
      id: row.id,
      username: row.username,
      role: row.role,
      center: ext.center || '',
      status: row.status,
      extendedJson: row.extendedJson,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt,
    });
  });

  router.patch('/users/:id', authMiddleware(true), requireAdmin, (req, res) => {
    const store = loadStore();
    const user = getUser(store, req.params.id);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    const { password, role, center, status, extendedJson, mustChangePassword } = req.body || {};
    if (password) user.passwordHash = hashPassword(password);
    if (role) user.role = assertValidGlobalRole(role);
    if (status) user.status = String(status);
    if (extendedJson && typeof extendedJson === 'object') {
      user.extendedJson = { ...user.extendedJson, ...extendedJson };
    }
    if (center !== undefined) {
      user.extendedJson = user.extendedJson || {};
      if (center) {
        user.extendedJson.center = center;
      } else {
        delete user.extendedJson.center;
      }
    }
    if (mustChangePassword !== undefined) user.mustChangePassword = !!mustChangePassword;
    user.updatedAt = new Date().toISOString();
    saveStore(store);
    res.json({ ok: true });
  });

  router.delete('/users/:id', authMiddleware(true), requireAdmin, (req, res) => {
    const store = loadStore();
    const idx = store.users.findIndex((u) => u.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: '用户不存在' });
    const victim = store.users[idx];
    if (victim.role === 'super_admin') {
      const cnt = store.users.filter((u) => u.role === 'super_admin').length;
      if (cnt <= 1) return res.status(400).json({ error: '不能删除最后一个超级管理员' });
    }
    store.users.splice(idx, 1);
    store.members = store.members.filter((m) => m.userId !== req.params.id);
    saveStore(store);
    res.json({ ok: true });
  });

  router.post('/users/import', authMiddleware(true), requireAdmin, (req, res) => {
    const { rows } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ error: '需要 rows 数组' });
    const store = loadStore();
    const errors = [];
    let ok = 0;
    rows.forEach((row, i) => {
      try {
        const username = row.username ?? row['用户名'];
        const password = row.password ?? row['初始密码'] ?? row.passwordPlain;
        if (!username || !password) {
          errors.push({ row: i + 1, message: '缺少用户名或密码' });
          return;
        }
        if (store.users.some((u) => u.username === String(username))) {
          errors.push({ row: i + 1, message: `用户 ${username} 已存在` });
          return;
        }
        const now = new Date().toISOString();
        store.users.push({
          id: randomUUID(),
          username: String(username),
          passwordHash: hashPassword(password),
          role: normalizeGlobalRoleInput(row.role ?? row['权限'] ?? row['角色'] ?? 'user'),
          extendedJson: typeof row.extendedJson === 'object' ? row.extendedJson : {},
          mustChangePassword: true,
          createdAt: now,
          updatedAt: now,
        });
        ok++;
      } catch (e) {
        errors.push({ row: i + 1, message: String(e?.message || e) });
      }
    });
    saveStore(store);
    res.json({ imported: ok, errors });
  });

  router.get('/field-definitions', authMiddleware(true), requireAdmin, (req, res) => {
    const store = loadStore();
    res.json(store.fieldDefinitions || { user: [], project: [] });
  });

  router.put('/field-definitions', authMiddleware(true), requireAdmin, (req, res) => {
    const store = loadStore();
    const { user = [], project = [] } = req.body || {};
    store.fieldDefinitions = {
      user: Array.isArray(user) ? user : [],
      project: Array.isArray(project) ? project : [],
    };
    saveStore(store);
    res.json(store.fieldDefinitions);
  });

  router.get('/projects', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const status = (req.query.status || '').toString().trim();
    let list = store.projects.filter((p) => {
      if (req.user.role === 'super_admin' || req.user.role === 'admin') return true;
      return isMember(store, p.id, req.user.id);
    });
    if (q) {
      list = list.filter(
        (p) =>
          projectNameFromRow(p).toLowerCase().includes(q) ||
          JSON.stringify(p.extendedJson || {}).toLowerCase().includes(q)
      );
    }
    if (status) list = list.filter((p) => p.status === status);
    let storeDirty = false;
    const projects = list.map((p) => {
      const coverImage = normalizeProjectCoverImageForApi(p.id, p.coverImage);
      const raw = typeof p.coverImage === 'string' ? p.coverImage.trim() : '';
      if (
        coverImage &&
        coverImage !== raw &&
        (raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('flowgen-local:'))
      ) {
        p.coverImage = coverImage;
        p.updatedAt = new Date().toISOString();
        storeDirty = true;
      }
      return {
        id: p.id,
        name: projectNameFromRow(p),
        status: p.status,
        coverImage,
        extendedJson: p.extendedJson || {},
        createdBy: p.createdBy,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
    if (storeDirty && getStorageMode() !== 'relational') saveStore(store);
    res.json({ projects });
  });

  router.post('/projects', authMiddleware(true), requireAdmin, (req, res) => {
    const { name, status = 'active', extendedJson = {} } = req.body || {};
    if (!name) return res.status(400).json({ error: '需要项目名称' });
    const store = loadStore();
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      name: String(name),
      status: String(status),
      extendedJson: typeof extendedJson === 'object' ? extendedJson : {},
      createdBy: req.user.id,
      createdAt: now,
      updatedAt: now,
    };
    store.projects.push(row);
    store.members.push({ projectId: row.id, userId: req.user.id, role: 'owner' });
    saveStore(store);
    res.status(201).json(row);
  });

  router.patch('/projects/:projectId', authMiddleware(true), async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '需要项目管理员、owner/editor 或平台管理员' });
    }
    const { name, status, coverImage, extendedJson } = req.body || {};
    if (name) p.name = String(name);
    if (status) p.status = String(status);
    if (coverImage !== undefined) {
      const next = coverImage ? String(coverImage) : null;
      if (next && (next.startsWith('data:') || next.startsWith('blob:') || next.startsWith('flowgen-local:'))) {
        return res.status(400).json({ error: '封面请使用上传接口，勿传 data/blob 临时地址' });
      }
      p.coverImage = next;
    }
    if (extendedJson && typeof extendedJson === 'object') p.extendedJson = extendedJson;
    p.updatedAt = new Date().toISOString();
    saveStore(store);
    if (getStorageMode() === 'relational' && extendedJson && typeof extendedJson === 'object') {
      const { flushStore } = await import('./store.mjs');
      await flushStore();
    }
    res.json(p);
  });

  router.post(
    '/projects/:projectId/cover',
    authMiddleware(true),
    upload.single('file'),
    async (req, res) => {
      const store = loadStore();
      const p = getProject(store, req.params.projectId);
      if (!p) return res.status(404).json({ error: '项目不存在' });
      if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
      if (!canManageProject(store, req.user, p.id)) {
        return res.status(403).json({ error: '需要项目管理员、owner/editor 或平台管理员' });
      }
      if (!req.file || !req.file.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: '需要图片文件 file' });
      }
      const url = saveProjectCoverFile(
        p.id,
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname || 'cover.jpg'
      );
      const { markProjectCoverSource } = await import('./projectCoverMeta.mjs');
      p.coverImage = url;
      p.extendedJson = markProjectCoverSource(p.extendedJson || {}, 'manual');
      p.updatedAt = new Date().toISOString();
      saveStore(store);
      if (getStorageMode() === 'relational') {
        try {
          const { persistMetadataCache } = await import('./relationalStore.mjs');
          await persistMetadataCache(store);
        } catch (e) {
          console.warn('[flowgen] cover upload DB sync failed', p.id, e);
        }
      }
      res.json({ url, coverImage: url, updatedAt: p.updatedAt });
    }
  );

  router.delete('/projects/:projectId/cover', authMiddleware(true), async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '需要项目管理员、owner/editor 或平台管理员' });
    }
    deleteProjectCoverFile(p.id);
    const { clearProjectCoverSource } = await import('./projectCoverMeta.mjs');
    p.coverImage = null;
    p.extendedJson = clearProjectCoverSource(p.extendedJson || {});
    p.updatedAt = new Date().toISOString();
    saveStore(store);
    if (getStorageMode() === 'relational') {
      try {
        const { persistMetadataCache } = await import('./relationalStore.mjs');
        await persistMetadataCache(store);
      } catch (e) {
        console.warn('[flowgen] cover delete DB sync failed', p.id, e);
      }
    }
    res.json({ ok: true, coverImage: null });
  });

  router.get('/projects/:projectId/cover/file', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const fp = resolveProjectCoverFile(p.id);
    if (!fp || !fs.existsSync(fp)) return res.status(404).end();
    const ext = path.extname(fp).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    fs.createReadStream(fp).pipe(res);
  });

  /** 删除项目及关联数据（成员、工作区、素材文件、该项目下的聊天记录） */
  function deleteProjectCascade(store, projectId) {
    const assets = store.assets.filter((a) => a.projectId === projectId);
    for (const a of assets) {
      try {
        fs.unlinkSync(path.join(uploadsDir(projectId), a.fileName));
      } catch {
        /* ignore missing file */
      }
    }
    store.assets = store.assets.filter((a) => a.projectId !== projectId);
    store.members = store.members.filter((m) => m.projectId !== projectId);
    if (store.workspaces && typeof store.workspaces === 'object') {
      delete store.workspaces[projectId];
    }
    if (store.chatHistory && typeof store.chatHistory === 'object') {
      for (const [chatId, record] of Object.entries(store.chatHistory)) {
        if (record?.projectId === projectId) delete store.chatHistory[chatId];
      }
    }
    store.projects = store.projects.filter((p) => p.id !== projectId);
    try {
      const dir = uploadsDir(projectId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  router.delete('/projects/:projectId', authMiddleware(true), requireAdmin, async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (getStorageMode() === 'relational') {
      deleteProjectCascade(store, p.id);
      await deleteProjectRelational(p.id);
    } else {
      deleteProjectCascade(store, p.id);
      saveStore(store);
    }
    res.json({ ok: true });
  });

  router.get('/projects/:projectId/members', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const mids = store.members.filter((m) => m.projectId === p.id);
    const users = mids.map((m) => {
      const u = getUser(store, m.userId);
      const ext = u?.extendedJson || {};
      const displayName = ext.displayName || ext.realName || ext.name || '';
      return {
        userId: m.userId,
        username: u?.username || '',
        displayName: String(displayName || ''),
        role: m.role,
      };
    });
    res.json({ members: users });
  });

  router.get('/projects/:projectId/member-candidates', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '无权管理该项目成员' });
    }
    const memberIds = new Set(
      store.members.filter((m) => m.projectId === p.id).map((m) => m.userId)
    );
    const users = store.users
      .filter((u) => !memberIds.has(u.id))
      .map((u) => {
        const ext = u.extendedJson || {};
        const displayName = ext.displayName || ext.realName || ext.name || '';
        return {
          id: u.id,
          username: u.username,
          displayName: String(displayName || ''),
          role: u.role,
        };
      });
    res.json({ users });
  });

  router.post('/projects/:projectId/members', authMiddleware(true), (req, res) => {
    const { userId, role = 'editor' } = req.body || {};
    if (!userId) return res.status(400).json({ error: '需要 userId' });
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '无权管理该项目成员' });
    }
    if (!getUser(store, userId)) return res.status(404).json({ error: '用户不存在' });
    const exists = store.members.some((m) => m.projectId === p.id && m.userId === userId);
    if (exists) return res.status(409).json({ error: '已在项目中' });
    store.members.push({ projectId: p.id, userId, role: String(role) });
    saveStore(store);
    res.status(201).json({ ok: true });
  });

  router.delete('/projects/:projectId/members/:userId', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '无权管理该项目成员' });
    }
    store.members = store.members.filter(
      (m) => !(m.projectId === req.params.projectId && m.userId === req.params.userId)
    );
    saveStore(store);
    res.json({ ok: true });
  });

  router.patch('/projects/:projectId/members/:userId', authMiddleware(true), (req, res) => {
    const { role } = req.body || {};
    if (!role) return res.status(400).json({ error: '需要 role' });
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canManageProject(store, req.user, p.id)) {
      return res.status(403).json({ error: '无权管理该项目成员' });
    }
    const m = store.members.find(
      (x) => x.projectId === req.params.projectId && x.userId === req.params.userId
    );
    if (!m) return res.status(404).json({ error: '不在项目中' });
    m.role = String(role);
    saveStore(store);
    res.json({ ok: true, role: m.role });
  });

  router.post('/projects/:projectId/users', authMiddleware(true), requireAdmin, (req, res) => {
    const { username, password, role = 'user', memberRole = 'editor', extendedJson = {} } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '需要用户名与初始密码' });
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (store.users.some((u) => u.username === String(username))) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      username: String(username),
      passwordHash: hashPassword(password),
      role: assertValidGlobalRole(role),
      extendedJson: typeof extendedJson === 'object' ? extendedJson : {},
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    };
    store.users.push(row);
    store.members.push({ projectId: p.id, userId: row.id, role: String(memberRole) });
    saveStore(store);
    res.status(201).json({ user: { id: row.id, username: row.username }, member: { role: memberRole } });
  });

  router.post('/projects/import', authMiddleware(true), requireAdmin, (req, res) => {
    const { rows } = req.body || {};
    if (!Array.isArray(rows)) return res.status(400).json({ error: '需要 rows 数组' });
    const store = loadStore();
    const errors = [];
    let ok = 0;
    rows.forEach((row, i) => {
      try {
        const name = row.name ?? row['项目名称'];
        if (!name) {
          errors.push({ row: i + 1, message: '缺少项目名称' });
          return;
        }
        if (store.projects.some((p) => p.name === String(name))) {
          errors.push({ row: i + 1, message: `项目 ${name} 已存在` });
          return;
        }
        const now = new Date().toISOString();
        const proj = {
          id: randomUUID(),
          name: String(name),
          status: String(row.status || 'active'),
          extendedJson: typeof row.extendedJson === 'object' ? row.extendedJson : {},
          createdBy: req.user.id,
          createdAt: now,
          updatedAt: now,
        };
        store.projects.push(proj);
        store.members.push({ projectId: proj.id, userId: req.user.id, role: 'owner' });
        ok++;
      } catch (e) {
        errors.push({ row: i + 1, message: String(e?.message || e) });
      }
    });
    saveStore(store);
    res.json({ imported: ok, errors });
  });

  router.get('/projects/:projectId/workspace', authMiddleware(true), async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    if (getStorageMode() === 'relational') {
      const view = await workspaceRepo.getUserWorkspaceView(p.id, req.user.id);
      return res.json(view);
    }
    const wsBefore = store.workspaces[p.id];
    const envelope = ensureWorkspaceEnvelope(store, p.id);
    const view = getUserWorkspaceView(envelope, req.user.id);
    const wsAfter = store.workspaces[p.id];
    const migratedEnvelope = !isPerUserWorkspaceEnvelope(wsBefore);
    const adoptedLegacySlice =
      wsBefore?._legacyPayload != null && wsAfter?._legacyPayload == null;
    if (migratedEnvelope || adoptedLegacySlice) saveStore(store);
    res.json(view);
  });

  /** 画布节点预览：文件落盘 data/flowgen/uploads/{projectId}/node-media/，JSON 里只存短 URL */
  router.post(
    '/projects/:projectId/node-media',
    authMiddleware(true),
    upload.single('file'),
    (req, res) => {
      const store = loadStore();
      const p = getProject(store, req.params.projectId);
      if (!p) return res.status(404).json({ error: '项目不存在' });
      if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
      const m = store.members.find((x) => x.projectId === p.id && x.userId === req.user.id);
      if (
        req.user.role !== 'super_admin' &&
        req.user.role !== 'admin' &&
        (!m || (m.role !== 'owner' && m.role !== 'editor'))
      ) {
        return res.status(403).json({ error: '只读成员不可上传' });
      }
      if (!req.file) return res.status(400).json({ error: '需要文件 file' });
      const out = saveNodeMediaFile(
        p.id,
        req.file.buffer,
        req.file.originalname || 'image.png',
        req.file.mimetype || 'application/octet-stream'
      );
      res.status(201).json(out);
    }
  );

  router.get('/projects/:projectId/node-media/:mediaId/file', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const fp = resolveNodeMediaFilePath(p.id, req.params.mediaId);
    if (!fp || !fs.existsSync(fp)) return res.status(404).end();
    const ext = path.extname(fp).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.mp4'
                ? 'video/mp4'
                : ext === '.webm'
                  ? 'video/webm'
                  : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(fp).pipe(res);
  });

  router.put('/projects/:projectId/workspace', authMiddleware(true), async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const m = store.members.find((x) => x.projectId === p.id && x.userId === req.user.id);
    if (
      req.user.role !== 'super_admin' &&
      req.user.role !== 'admin' &&
      (!m || (m.role !== 'owner' && m.role !== 'editor'))
    ) {
      return res.status(403).json({ error: '只读成员不可保存' });
    }
    const { payload, version, allowEmptyGraph } = req.body || {};
    try {
      const sanitizedPayload = sanitizeWorkspacePayload(payload);
      const graphNodes = sanitizedPayload?.graph?.nodes;
      const putBody = {
        payload: sanitizedPayload,
        version,
        allowEmptyGraph: !!allowEmptyGraph,
      };
      if (getStorageMode() === 'relational') {
        const out = await workspaceRepo.putUserWorkspaceSlice(p.id, req.user.id, putBody);
        try {
          await syncProjectCoverFromWorkspaceGraph(p.id, graphNodes);
        } catch (coverErr) {
          console.warn('[flowgen] workspace project cover sync failed', p.id, coverErr);
        }
        return res.json(out);
      }
      const out = putUserWorkspaceSlice(store, p.id, req.user.id, putBody);
      saveStore(store);
      try {
        await syncProjectCoverFromWorkspaceGraph(p.id, graphNodes);
      } catch (coverErr) {
        console.warn('[flowgen] workspace project cover sync failed', p.id, coverErr);
      }
      res.json(out);
    } catch (e) {
      if (e && typeof e === 'object' && e.code === 'VERSION_CONFLICT') {
        return res.status(409).json({ error: '版本冲突', serverVersion: e.serverVersion });
      }
      if (e && typeof e === 'object' && e.code === 'EMPTY_GRAPH_REJECTED') {
        return res.status(409).json({
          error: '拒绝用空画布覆盖非空工程',
          code: 'EMPTY_GRAPH_REJECTED',
          serverNodeCount: e.serverNodeCount,
        });
      }
      throw e;
    }
  });

  router.get('/projects/:projectId/assets', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const dir = uploadsDir(p.id);
    const assets = store.assets
      .filter((a) => a.projectId === p.id)
      .map((a) => {
        const paths = assetApiPaths(p.id, a.id);
        const fp = path.join(dir, a.fileName);
        const fileOnDisk = fs.existsSync(fp);
        return {
          id: a.id,
          name: a.name,
          category: normalizeCategoryForStore(a.category),
          url: paths.file,
          thumbUrl: paths.thumb,
          mime: a.mime,
          createdAt: a.createdAt,
          createdBy: a.createdBy,
          fileOnDisk,
        };
      });
    res.json({ assets });
  });

  router.post(
    '/projects/:projectId/assets',
    authMiddleware(true),
    requireProjectAssetWrite,
    upload.single('file'),
    (req, res) => {
      const store = loadStore();
      const p = getProject(store, req.params.projectId);
      if (!p) return res.status(404).json({ error: '项目不存在' });
      const name = (req.body?.name || req.file?.originalname || 'asset').toString();

      const pickStr = (v) => {
        if (v == null) return '';
        if (Array.isArray(v)) return String(v[0] ?? '').trim();
        return String(v).trim();
      };

      const decodeCategoryB64 = (v) => {
        const s = pickStr(v);
        if (!s) return '';
        try {
          return Buffer.from(s, 'base64').toString('utf8').trim();
        } catch {
          return '';
        }
      };

      /** flowgen_asset_tag：纯 ASCII；可与 URL 查询 ?flowgen_asset_tag=PROP 同传（创建时即入库，避免第二步 PATCH 被代理吃掉） */
      const categoryRaw =
        pickStr(req.query?.flowgen_asset_tag) ||
        pickStr(req.body?.flowgen_asset_tag) ||
        decodeCategoryB64(req.headers['x-asset-category-b64']) ||
        pickStr(categoryFromUrlQuery(req)) ||
        decodeCategoryB64(req.query?.categoryB64) ||
        decodeCategoryB64(req.body?.categoryB64) ||
        pickStr(req.query?.category) ||
        pickStr(req.body?.category) ||
        pickStr(req.body?.tag) ||
        pickStr(req.body?.label) ||
        pickStr(req.headers['x-asset-category']);
      const category = normalizeCategoryForStore(categoryRaw);
      logAssetDebug('POST asset', {
        projectId: p.id,
        queryKeys: Object.keys(req.query || {}),
        bodyKeys: Object.keys(req.body || {}),
        categoryRaw,
        category,
        b64QueryLen: pickStr(req.query?.categoryB64).length,
        b64BodyLen: pickStr(req.body?.categoryB64).length,
      });
      if (!req.file) return res.status(400).json({ error: '需要文件 file' });
      const id = randomUUID();
      const ext = path.extname(req.file.originalname || '') || '';
      const safeName = `${id}${ext}`;
      ensureDataDirs();
      const dir = uploadsDir(p.id);
      fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, safeName);
      fs.writeFileSync(fp, req.file.buffer);
      const mime = normalizeAssetMime(req.file.mimetype, safeName);
      void ensureAssetThumbFile(fp, assetThumbPath(dir, safeName), mime, safeName);
      const now = new Date().toISOString();
      const row = {
        id,
        projectId: p.id,
        name,
        category,
        fileName: safeName,
        mime,
        createdBy: req.user.id,
        createdAt: now,
      };
      store.assets.push(row);
      saveStore(store);
      const paths = assetApiPaths(p.id, row.id);
      res.status(201).json({
        id: row.id,
        name: row.name,
        category: row.category,
        url: paths.file,
        thumbUrl: paths.thumb,
        mime: row.mime,
        createdAt: row.createdAt,
      });
    }
  );

  /** category 与 tag 均可能上传；若 category 被代理置为空字符串，勿覆盖 tag（否则会入库成 OTHER） */
  function pickAssetCategoryInput(body) {
    if (!body || typeof body !== 'object') return undefined;
    const c = body.category;
    const t = body.tag;
    const cOk = c !== undefined && c !== null && String(c).trim() !== '';
    const tOk = t !== undefined && t !== null && String(t).trim() !== '';
    if (cOk) return c;
    if (tOk) return t;
    return undefined;
  }

  function applyAssetMeta(req, res) {
    const body = req.body || {};
    const name = body.name;
    /** 与可灵 kLingMainLibrary/save 一致：允许 JSON 使用 tag 字段传 PERSON/SCENE/… */
    const categoryInput = pickAssetCategoryInput(body);
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canManageProjectAssets(store, req.user, p.id)) {
      return res.status(403).json({
        error: '无权管理项目资产库（普通用户仅可查看与引用；项目管理员或平台管理员可增删改）',
      });
    }
    const a = store.assets.find((x) => x.id === req.params.assetId && x.projectId === p.id);
    if (!a) return res.status(404).json({ error: '素材不存在' });
    if (name !== undefined) {
      const n = String(name).trim();
      if (n) a.name = n;
    }
    if (categoryInput !== undefined && categoryInput !== null) {
      a.category = normalizeCategoryForStore(categoryInput);
    }
    logAssetDebug('asset meta', {
      method: req.method,
      projectId: p.id,
      assetId: req.params.assetId,
      bodyCategory: categoryInput,
      storedCategory: a.category,
    });
    saveStore(store);
    res.json({
      id: a.id,
      name: a.name,
      category: normalizeCategoryForStore(a.category),
    });
  }

  /** POST 与 PATCH 等价：部分反向代理对 PATCH + JSON 处理异常，创建后同步标签走此路由更稳 */
  router.post(
    '/projects/:projectId/assets/:assetId/meta',
    authMiddleware(true),
    applyAssetMeta
  );

  router.patch('/projects/:projectId/assets/:assetId', authMiddleware(true), applyAssetMeta);

  /** POST 与 PATCH 等价（无 /meta 子路径）：部分网关未放行 PATCH 或未转发 .../meta 时仍可用 */
  router.post('/projects/:projectId/assets/:assetId', authMiddleware(true), applyAssetMeta);

  /** 单条素材元数据（创建后立即校验分类比扫 GET .../assets 更可靠） */
  router.get('/projects/:projectId/assets/:assetId', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const a = store.assets.find((x) => x.id === req.params.assetId && x.projectId === p.id);
    if (!a) return res.status(404).json({ error: '素材不存在' });
    const paths = assetApiPaths(p.id, a.id);
    res.json({
      asset: {
        id: a.id,
        name: a.name,
        category: normalizeCategoryForStore(a.category),
        url: paths.file,
        thumbUrl: paths.thumb,
        mime: a.mime,
        createdAt: a.createdAt,
        createdBy: a.createdBy,
      },
    });
  });

  router.put(
    '/projects/:projectId/assets/:assetId/file',
    authMiddleware(true),
    requireProjectAssetWrite,
    upload.single('file'),
    (req, res) => {
      const store = loadStore();
      const p = getProject(store, req.params.projectId);
      if (!p) return res.status(404).json({ error: '项目不存在' });
      const a = store.assets.find((x) => x.id === req.params.assetId && x.projectId === p.id);
      if (!a) return res.status(404).json({ error: '素材不存在' });
      if (!req.file) return res.status(400).json({ error: '需要文件 file' });
      ensureDataDirs();
      const dir = uploadsDir(p.id);
      fs.mkdirSync(dir, { recursive: true });
      deleteAssetThumbIfExists(dir, a.fileName);
      try {
        fs.unlinkSync(path.join(dir, a.fileName));
      } catch {
        /* ignore */
      }
      const ext = path.extname(req.file.originalname || '') || '';
      const safeName = `${randomUUID()}${ext}`;
      const fp = path.join(dir, safeName);
      fs.writeFileSync(fp, req.file.buffer);
      a.fileName = safeName;
      a.mime = normalizeAssetMime(req.file.mimetype, safeName);
      void ensureAssetThumbFile(fp, assetThumbPath(dir, safeName), a.mime, safeName);
      saveStore(store);
      res.json({
        ok: true,
        mime: a.mime,
        ...assetApiPaths(p.id, a.id),
      });
    }
  );

  router.delete(
    '/projects/:projectId/assets/:assetId',
    authMiddleware(true),
    requireProjectAssetWrite,
    (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    const idx = store.assets.findIndex((x) => x.id === req.params.assetId && x.projectId === p.id);
    if (idx < 0) return res.status(404).json({ error: '素材不存在' });
    const a = store.assets[idx];
    const dir = uploadsDir(p.id);
    deleteAssetThumbIfExists(dir, a.fileName);
    try {
      fs.unlinkSync(path.join(dir, a.fileName));
    } catch {
      /* ignore */
    }
    store.assets.splice(idx, 1);
    saveStore(store);
    res.json({ ok: true });
  });

  router.get('/projects/:projectId/assets/:assetId/thumb', authMiddleware(true), async (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const a = store.assets.find((x) => x.id === req.params.assetId && x.projectId === p.id);
    if (!a) return res.status(404).end();
    const dir = uploadsDir(p.id);
    const fp = path.join(dir, a.fileName);
    if (!fs.existsSync(fp)) return res.status(404).end();
    const tp = assetThumbPath(dir, a.fileName);
    if (!fs.existsSync(tp)) {
      await ensureAssetThumbFile(fp, tp, a.mime, a.fileName);
    }
    if (fs.existsSync(tp)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
      return fs.createReadStream(tp).pipe(res);
    }
    const imageMime = normalizeAssetMime(a.mime, a.fileName);
    if (isImageAssetMime(a.mime, a.fileName)) {
      res.setHeader('Content-Type', imageMime);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return fs.createReadStream(fp).pipe(res);
    }
    return res.status(404).end();
  });

  router.get('/projects/:projectId/assets/:assetId/file', authMiddleware(true), (req, res) => {
    const store = loadStore();
    const p = getProject(store, req.params.projectId);
    if (!p) return res.status(404).json({ error: '项目不存在' });
    if (!canAccessProject(store, req.user, p.id)) return res.status(403).json({ error: '无权访问' });
    const a = store.assets.find((x) => x.id === req.params.assetId && x.projectId === p.id);
    if (!a) return res.status(404).end();
    const fp = path.join(uploadsDir(p.id), a.fileName);
    if (!fs.existsSync(fp)) return res.status(404).end();
    res.setHeader('Content-Type', normalizeAssetMime(a.mime, a.fileName));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(fp).pipe(res);
  });

  // ================== Qwen 聊天记录存储 API ==================
  // 获取指定会话的历史记录
  const chatHistoryOwnedBy = (record, user) => {
    if (!record || !user?.id) return false;
    if (!record.userId) return false; // 无 userId 的旧数据不向普通用户暴露
    return record.userId === user.id;
  };

  router.get('/chat-history/:chatId', authMiddleware(true), async (req, res) => {
    const { chatId } = req.params;
    const filterProjectId = req.query?.projectId ? String(req.query.projectId) : null;
    if (getStorageMode() === 'relational') {
      const record = await chatRepo.getChatSession(chatId);
      if (!record) return res.status(404).json({ error: '未找到该会话记录' });
      if (!chatHistoryOwnedBy(record, req.user)) {
        return res.status(403).json({ error: '无权访问该会话' });
      }
      if (filterProjectId && String(record.projectId || '') !== filterProjectId) {
        return res.status(403).json({ error: '无权访问该项目会话' });
      }
      return res.json({ chatId, ...record });
    }
    const store = loadStore();
    const record = store.chatHistory?.[chatId];
    if (!record) return res.status(404).json({ error: '未找到该会话记录' });
    if (!chatHistoryOwnedBy(record, req.user)) {
      return res.status(403).json({ error: '无权访问该会话' });
    }
    if (filterProjectId && String(record.projectId || '') !== filterProjectId) {
      return res.status(403).json({ error: '无权访问该项目会话' });
    }
    res.json({ chatId, ...record });
  });

  // 保存/更新会话历史
  router.post('/chat-history/:chatId', authMiddleware(true), async (req, res) => {
    const { chatId } = req.params;
    const { modelId, messages, projectId } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }
    if (getStorageMode() === 'relational') {
      const prev = await chatRepo.getChatSession(chatId);
      if (prev && !chatHistoryOwnedBy(prev, req.user)) {
        return res.status(403).json({ error: '无权覆盖该会话' });
      }
      if (prev?.projectId && projectId && String(prev.projectId) !== String(projectId)) {
        return res.status(403).json({ error: '无权跨项目覆盖会话' });
      }
      await chatRepo.upsertChatSession(chatId, {
        modelId: modelId || 'qwen',
        messages: messages.slice(0, 200),
        updatedAt: new Date().toISOString(),
        userId: req.user?.id || null,
        projectId: projectId ? String(projectId) : prev?.projectId || null,
      });
      return res.json({ ok: true, chatId });
    }
    const store = loadStore();
    const prev = store.chatHistory[chatId];
    if (prev && !chatHistoryOwnedBy(prev, req.user)) {
      return res.status(403).json({ error: '无权覆盖该会话' });
    }
    store.chatHistory[chatId] = {
      modelId: modelId || 'qwen',
      messages: messages.slice(0, 200), // 限制存储数量
      updatedAt: new Date().toISOString(),
      userId: req.user?.id || null,
      projectId: projectId ? String(projectId) : prev?.projectId || null,
    };
    saveStore(store);
    res.json({ ok: true, chatId });
  });

  // 删除会话历史
  router.delete('/chat-history/:chatId', authMiddleware(true), async (req, res) => {
    const { chatId } = req.params;
    const filterProjectId = req.query?.projectId ? String(req.query.projectId) : null;
    if (getStorageMode() === 'relational') {
      const record = await chatRepo.getChatSession(chatId);
      if (record) {
        if (!chatHistoryOwnedBy(record, req.user)) {
          return res.status(403).json({ error: '无权删除该会话' });
        }
        if (filterProjectId && String(record.projectId || '') !== filterProjectId) {
          return res.status(403).json({ error: '无权删除该项目会话' });
        }
        await chatRepo.deleteChatSession(chatId);
      }
      return res.json({ ok: true });
    }
    const store = loadStore();
    const record = store.chatHistory?.[chatId];
    if (record) {
      if (!chatHistoryOwnedBy(record, req.user)) {
        return res.status(403).json({ error: '无权删除该会话' });
      }
      if (filterProjectId && String(record.projectId || '') !== filterProjectId) {
        return res.status(403).json({ error: '无权删除该项目会话' });
      }
      delete store.chatHistory[chatId];
      saveStore(store);
    }
    res.json({ ok: true });
  });

  // 获取当前用户的所有会话列表
  router.get('/chat-history', authMiddleware(true), async (req, res) => {
    const filterProjectId = req.query?.projectId ? String(req.query.projectId) : null;
    if (getStorageMode() === 'relational') {
      const rows = await chatRepo.listChatSessionsForUser(req.user, { projectId: filterProjectId });
      const list = rows.slice(0, 60).map((r) => ({
        chatId: r.chatId,
        modelId: r.modelId,
        updatedAt: r.updatedAt,
        messageCount: r.messageCount,
        firstMessage: String(r.firstMessage || ''),
        projectId: r.projectId || null,
      }));
      return res.json({ sessions: list });
    }
    const store = loadStore();
    const list = Object.entries(store.chatHistory || {})
      .filter(([, record]) => chatHistoryOwnedBy(record, req.user))
      .filter(([, record]) => {
        if (!filterProjectId) return true;
        return record.projectId === filterProjectId;
      })
      .map(([chatId, record]) => ({
        chatId,
        modelId: record.modelId,
        updatedAt: record.updatedAt,
        messageCount: record.messages?.length || 0,
        firstMessage: record.messages?.[0]?.content?.slice(0, 50) || '',
        projectId: record.projectId || null,
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 60);
    res.json({ sessions: list });
  });

  return router;
}
