/**
 * 003_activity.sql
 * Activity tracking: heartbeat-based coding time per project per day.
 */

CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,  -- YYYY-MM-DD
  minutes    INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS activity_logs_project_date_idx
  ON activity_logs(project_id, date);

CREATE INDEX IF NOT EXISTS activity_logs_date_idx
  ON activity_logs(date);
