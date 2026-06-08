/**
 * Ensure flowgen_store_chunk exists (idempotent).
 */
import './load-env-local.mjs';
import { getPool, isMysqlConfigured } from '../server/flowgen/db.mjs';

const SQL = `
CREATE TABLE IF NOT EXISTS flowgen_store_chunk (
  snapshot_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  part INT UNSIGNED NOT NULL,
  payload LONGBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id, part)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function main() {
  if (!isMysqlConfigured()) {
    console.error('[mysql-chunks] 请设置 MYSQL_PASSWORD');
    process.exit(1);
  }
  await getPool().query(SQL);
  console.log('[mysql-chunks] flowgen_store_chunk ready');
  process.exit(0);
}

main().catch((e) => {
  console.error('[mysql-chunks] 失败:', e.message || e);
  process.exit(1);
});
