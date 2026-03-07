/**
 * 004_tunnels.sql
 * Cloudflared quick tunnels — expose project ports to the internet.
 */

CREATE TABLE IF NOT EXISTS tunnels (
  id         TEXT PRIMARY KEY,
  project_id TEXT DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL,
  port       INTEGER NOT NULL,
  url        TEXT DEFAULT NULL,
  pid        INTEGER DEFAULT NULL,
  status     TEXT NOT NULL DEFAULT 'starting'
    CHECK (status IN ('starting', 'active', 'stopped', 'error')),
  error_msg  TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tunnels_status_idx ON tunnels (status);
CREATE INDEX IF NOT EXISTS tunnels_project_idx ON tunnels (project_id);
