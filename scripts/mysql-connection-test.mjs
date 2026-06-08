/**
 * Verify MySQL connectivity and schema tables.
 * Usage: node scripts/mysql-connection-test.mjs  (reads .env.local)
 */
import './load-env-local.mjs';
import mysql from 'mysql2/promise';

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'flowgen',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'flowgen',
};

async function main() {
  if (!config.password) {
    console.error('[mysql-test] 请设置 MYSQL_PASSWORD（勿将密码写入仓库）');
    process.exit(1);
  }
  let conn;
  try {
    conn = await mysql.createConnection(config);
    const [rows] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
    const dbName = config.database;
    const [tables] = await conn.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
      [dbName]
    );
    const tableNames = tables.map((r) => r.TABLE_NAME);
    console.log('[mysql-test] 连接成功');
    console.log(
      JSON.stringify(
        { ...rows[0], tables: tableNames, tableCount: tableNames.length },
        null,
        2
      )
    );
    process.exit(0);
  } catch (e) {
    console.error('[mysql-test] 连接失败:', e.message || e);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
