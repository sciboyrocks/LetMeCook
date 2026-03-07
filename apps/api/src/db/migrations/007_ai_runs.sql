-- AI runs tracking table
CREATE TABLE IF NOT EXISTS ai_runs (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,      -- 'gemini-cli' | 'openai' | 'anthropic' | 'gemini-api'
  action       TEXT NOT NULL,      -- 'plan' | 'next-task' | 'commit-message' | 'ask' | 'bootstrap' | 'recap'
  project_id   TEXT,               -- nullable (some actions are global)
  prompt_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  latency_ms   INTEGER,
  status       TEXT NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'error', 'timeout', 'rate_limited')),
  error        TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_runs_created_idx ON ai_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_project_idx ON ai_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_action_idx  ON ai_runs (action, created_at DESC);

-- Per-project AI daily usage counters (for rate limiting)
CREATE TABLE IF NOT EXISTS ai_project_limits (
  project_id TEXT NOT NULL,
  date       TEXT NOT NULL,   -- YYYY-MM-DD
  calls      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, date)
);

-- Global AI daily usage counter
CREATE TABLE IF NOT EXISTS ai_global_limits (
  date  TEXT PRIMARY KEY,   -- YYYY-MM-DD
  calls INTEGER NOT NULL DEFAULT 0
);
