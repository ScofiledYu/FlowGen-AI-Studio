/**
 * MySQL connection pool for FlowGen (optional; app still defaults to JSON store).
 */
import mysql from 'mysql2/promise';

let pool;

export function mysqlConfigFromEnv() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'flowgen',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'flowgen',
    waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 50),
    charset: 'utf8mb4',
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

export function isMysqlPacketTooLarge(err) {
  return err?.code === 'ER_NET_PACKET_TOO_LARGE' || err?.errno === 1153;
}

export function isMysqlConnectionError(err) {
  const msg = String(err?.message || err || '');
  return (
    err?.code === 'PROTOCOL_CONNECTION_LOST' ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ECONNABORTED' ||
    msg.includes('closed state') ||
    msg.includes('Connection lost') ||
    msg.includes('Pool is closed')
  );
}

export async function resetPool() {
  if (!pool) return;
  const old = pool;
  pool = undefined;
  try {
    await old.end();
  } catch {
    /* ignore */
  }
}

export function isMysqlConfigured() {
  return Boolean(process.env.MYSQL_PASSWORD);
}

export function getPool() {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL not configured: set MYSQL_PASSWORD in environment');
  }
  if (!pool) {
    const p = mysql.createPool(mysqlConfigFromEnv());
    p.on('connection', (conn) => {
      conn.query('SET SESSION max_allowed_packet = 67108864', () => {});
    });
    pool = p;
  }
  return pool;
}

/** @returns {Promise<{ ok: boolean, version?: string, database?: string, tableCount?: number, error?: string }>} */
export async function pingMysql() {
  if (!isMysqlConfigured()) {
    return { ok: false, error: 'MYSQL_PASSWORD not set' };
  }
  try {
    const p = getPool();
    const [verRows] = await p.query('SELECT VERSION() AS version, DATABASE() AS db');
    const [tables] = await p.query('SHOW TABLES');
    return {
      ok: true,
      version: verRows[0]?.version,
      database: verRows[0]?.db,
      tableCount: tables.length,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
