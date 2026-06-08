/**
 * Apply server/flowgen/schema.sql using MYSQL_* env vars.
 * Usage: node scripts/mysql-init-schema.mjs  (reads .env.local)
 */
import './load-env-local.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'server', 'flowgen', 'schema.sql');

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'flowgen',
  password: process.env.MYSQL_PASSWORD || '',
  multipleStatements: true,
};

async function main() {
  if (!config.password) {
    console.error('[mysql-init] 请设置 MYSQL_PASSWORD');
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const conn = await mysql.createConnection(config);
  try {
    await conn.query(sql);
    const [tables] = await conn.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [process.env.MYSQL_DATABASE || 'flowgen']
    );
    console.log('[mysql-init] 架构初始化完成，表数量:', tables.length);
    for (const row of tables) console.log('  -', row.TABLE_NAME);
    process.exit(0);
  } catch (e) {
    console.error('[mysql-init] 失败:', e.message || e);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
