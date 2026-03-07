/**
 * 009_infra.sql
 * Infrastructure tables: backups + audit_logs.
 */

CREATE TABLE IF NOT EXISTS backups (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  size_bytes INTEGER DEFAULT 0,
  drive_id   TEXT DEFAULT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'completed', 'failed')),
  error_msg  TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS backups_project_idx ON backups (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,
  entity     TEXT DEFAULT NULL,
  entity_id  TEXT DEFAULT NULL,
  detail     TEXT DEFAULT NULL,
  ip         TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity, entity_id);
