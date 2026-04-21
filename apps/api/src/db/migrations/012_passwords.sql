CREATE TABLE IF NOT EXISTS passwords (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  username         TEXT DEFAULT '',
  website          TEXT DEFAULT '',
  notes            TEXT DEFAULT '',
  password_cipher  TEXT DEFAULT NULL,
  totp_cipher      TEXT DEFAULT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS passwords_updated_at_idx
  ON passwords (updated_at DESC);
