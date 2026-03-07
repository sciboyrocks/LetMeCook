CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  progress          INTEGER NOT NULL DEFAULT 0,
  timeout_ms        INTEGER NOT NULL,
  cancel_requested  INTEGER NOT NULL DEFAULT 0,
  payload_json      TEXT NOT NULL,
  result_json       TEXT,
  error_code        TEXT,
  error_message     TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at        DATETIME,
  finished_at       DATETIME,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS jobs_type_idx ON jobs (type, created_at DESC);

CREATE TABLE IF NOT EXISTS job_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  message     TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS job_logs_job_id_idx ON job_logs (job_id, id ASC);