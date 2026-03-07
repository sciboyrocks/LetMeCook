/**
 * 006_journal_ext.sql
 * Adds date + project_id columns to journal_entries.
 * Used by AI recap (Phase 8.9) and direct journal routes.
 */

-- date column for easy "one entry per day" queries
ALTER TABLE journal_entries ADD COLUMN date TEXT DEFAULT NULL;
-- back-fill existing rows from created_at
UPDATE journal_entries SET date = date(created_at) WHERE date IS NULL;

-- link journal entries to a specific project (optional)
ALTER TABLE journal_entries ADD COLUMN project_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS journal_entries_date_idx     ON journal_entries (date DESC);
CREATE INDEX IF NOT EXISTS journal_entries_project_idx  ON journal_entries (project_id, date DESC);
