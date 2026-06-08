import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.FLOWGEN_JWT_SECRET || 'flowgen-dev-jwt-change-me-in-production';
const JWT_EXPIRES = process.env.FLOWGEN_JWT_EXPIRES || '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function tokenFromUrlQueryString(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const qm = rawUrl.indexOf('?');
  if (qm === -1) return null;
  try {
    const sp = new URLSearchParams(rawUrl.slice(qm + 1));
    const t = (sp.get('access_token') || sp.get('token') || '').trim();
    return t || null;
  } catch {
    return null;
  }
}

function extractAuthToken(req) {
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (m?.[1]) return m[1];
  const q = req.query?.access_token ?? req.query?.token;
  if (typeof q === 'string' && q.trim()) return q.trim();
  // 子路由挂载下 req.query 有时为空；与资产上传 category 解析一致，回退 originalUrl
  return (
    tokenFromUrlQueryString(req.originalUrl) ||
    tokenFromUrlQueryString(req.url) ||
    null
  );
}

export function authMiddleware(required = true) {
  return (req, res, next) => {
    const tok = extractAuthToken(req);
    if (!tok) {
      if (required) return res.status(401).json({ error: '未授权' });
      req.user = null;
      return next();
    }
    const decoded = verifyToken(tok);
    if (!decoded || !decoded.sub) {
      if (required) return res.status(401).json({ error: '令牌无效' });
      req.user = null;
      return next();
    }
    req.user = {
      id: decoded.sub,
      username: decoded.username,
      role: decoded.role,
    };
    next();
  };
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未授权' });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: '权限不足' });
  };
}

/** Project owner/editor viewer checked separately via membership */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '未授权' });
  if (req.user.role === 'super_admin' || req.user.role === 'admin') return next();
  return res.status(403).json({ error: '需要管理员权限' });
}
