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
  };
}

export function isMysqlConfigured() {
  return Boolean(process.env.MYSQL_PASSWORD);
}

export function getPool() {
  if (!isMysqlConfigured()) {
    throw new Error('MySQL not configured: set MYSQL_PASSWORD in environment');
  }
  if (!pool) {
    pool = mysql.createPool(mysqlConfigFromEnv());
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
