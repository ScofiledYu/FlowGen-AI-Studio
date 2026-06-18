/**
 * Apply schema-v2-relational.sql
 */
import './load-env-local.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'server', 'flowgen', 'schema-v2-relational.sql');

async function main() {
  if (!process.env.MYSQL_PASSWORD) {
    console.error('[mysql-init-v2] 请设置 MYSQL_PASSWORD');
    process.exit(1);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'flowgen',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'flowgen',
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    for (const [col, ddl] of [
      ['episode', 'ADD COLUMN episode VARCHAR(16) NULL DEFAULT NULL'],
      ['sequence', 'ADD COLUMN sequence VARCHAR(16) NULL DEFAULT NULL'],
    ]) {
      const [existing] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flowgen_assets' AND COLUMN_NAME = ?`,
        [col]
      );
      if (!existing.length) {
        await conn.query(`ALTER TABLE flowgen_assets ${ddl}`);
        console.log(`[mysql-init-v2] migrated flowgen_assets.${col}`);
      }
    }
    const [tables] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'flowgen_%'
       ORDER BY TABLE_NAME`
    );
    console.log('[mysql-init-v2] ok, tables:', tables.map((t) => t.TABLE_NAME).join(', '));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[mysql-init-v2] failed:', e.message || e);
  process.exit(1);
});
