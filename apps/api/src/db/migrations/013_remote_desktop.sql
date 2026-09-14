CREATE TABLE IF NOT EXISTS remote_desktop_connections (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  host                TEXT NOT NULL,
  port                INTEGER NOT NULL DEFAULT 5900,
  username            TEXT DEFAULT '',
  password_cipher     TEXT DEFAULT NULL,
  color               TEXT DEFAULT '#f97316',
  view_only           INTEGER DEFAULT 0,
  quality             INTEGER DEFAULT 6,
  compression         INTEGER DEFAULT 2,
  scale_mode          TEXT DEFAULT 'fit',
  show_dot_cursor     INTEGER DEFAULT 0,
  last_connected_at   DATETIME DEFAULT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS remote_desktop_connections_updated_at_idx
  ON remote_desktop_connections (updated_at DESC);
