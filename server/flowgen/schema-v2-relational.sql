-- FlowGen schema v2: relational storage for 300+ concurrent editors
-- Run: npm run mysql:init-v2

CREATE TABLE IF NOT EXISTS flowgen_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  extended_json JSON NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_flowgen_users_username (username),
  KEY idx_flowgen_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flowgen_projects (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  cover_image LONGTEXT NULL,
  extended_json JSON NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_flowgen_projects_created_by (created_by),
  KEY idx_flowgen_projects_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flowgen_members (
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, user_id),
  KEY idx_flowgen_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Hot path: one row per (project, user) workspace slice; incremental UPSERT only
CREATE TABLE IF NOT EXISTS flowgen_workspace_slices (
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  payload_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  updated_by CHAR(36) NULL,
  PRIMARY KEY (project_id, user_id),
  KEY idx_flowgen_workspace_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flowgen_assets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'OTHER',
  episode VARCHAR(16) NULL DEFAULT NULL,
  sequence VARCHAR(16) NULL DEFAULT NULL,
  mime VARCHAR(128) NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_flowgen_assets_project (project_id),
  KEY idx_flowgen_assets_category (project_id, category),
  KEY idx_flowgen_assets_episode (project_id, episode),
  KEY idx_flowgen_assets_sequence (project_id, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flowgen_chat_sessions (
  chat_id VARCHAR(191) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  model_id VARCHAR(128) NOT NULL,
  messages JSON NOT NULL,
  message_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_flowgen_chat_user_project (user_id, project_id),
  KEY idx_flowgen_chat_project (project_id),
  KEY idx_flowgen_chat_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flowgen_field_definitions (
  scope ENUM('user', 'project') NOT NULL,
  payload JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO flowgen_meta (`key`, `value`)
VALUES ('schema_version', '2-relational-draft')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP;
