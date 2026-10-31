CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS journal_layout_state (
  owner_id CHAR(36) PRIMARY KEY,
  structure_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_expiry (expires_at), INDEX idx_sessions_user (user_id)
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose ENUM('verify','reset') NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_auth_tokens_expiry (expires_at)
);
CREATE TABLE IF NOT EXISTS assets (
  storage_key VARCHAR(128) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  bytes BIGINT UNSIGNED NOT NULL,
  mime VARCHAR(40) NOT NULL,
  status ENUM('active','staged') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_assets_owner (owner_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  scope VARCHAR(64) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  requests BIGINT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (scope,key_hash),
  INDEX idx_rate_limits_expiry (expires_at)
);
