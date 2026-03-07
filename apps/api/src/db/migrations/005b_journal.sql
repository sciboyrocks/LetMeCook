/**
 * 008_journal.sql
 * Dev Journal — "What did you build today?" entries.
 */

CREATE TABLE IF NOT EXISTS journal_entries (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  mood       TEXT DEFAULT NULL,
  tags       TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS journal_entries_created_idx
  ON journal_entries(created_at DESC);
