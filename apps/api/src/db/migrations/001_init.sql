/**
 * 001_init.sql
 * Base tables: settings, projects, login_attempts
 * Matches the existing server.js schema (+ new columns for Phase 1).
 */

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL DEFAULT '',
  description    TEXT DEFAULT '',
  color          TEXT DEFAULT '#6366f1',
  status         TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('idea','active','paused','maintenance','done','graveyard')),
  pinned         INTEGER NOT NULL DEFAULT 0,
  tags           TEXT DEFAULT '[]',
  last_opened_at DATETIME DEFAULT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_idx ON projects (slug);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ip           TEXT NOT NULL,
  success      INTEGER DEFAULT 0,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
