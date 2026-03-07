/**
 * 010_journal_images.sql
 * Image attachments for journal entries.
 */

CREATE TABLE IF NOT EXISTS journal_images (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS journal_images_entry_idx ON journal_images (entry_id);
