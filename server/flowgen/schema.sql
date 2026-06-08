-- FlowGen MySQL schema (MySQL 5.7+ / MariaDB 10.2+)
-- Run: mysql -u flowgen -p flowgen < server/flowgen/schema.sql
-- Or: node scripts/mysql-init-schema.mjs

CREATE DATABASE IF NOT EXISTS flowgen
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE flowgen;

-- Chunked snapshot mirroring data/flowgen/store.json (each chunk < max_allowed_packet)
CREATE TABLE IF NOT EXISTS flowgen_store_chunk (
  snapshot_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  part INT UNSIGNED NOT NULL,
  payload LONGBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (snapshot_id, part)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Legacy single-row table (optional upgrade from early init)
CREATE TABLE IF NOT EXISTS flowgen_store_snapshot (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  payload LONGBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Connectivity probe (always present after init)
CREATE TABLE IF NOT EXISTS flowgen_meta (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  `value` VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO flowgen_meta (`key`, `value`)
VALUES ('schema_version', '1')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP;
