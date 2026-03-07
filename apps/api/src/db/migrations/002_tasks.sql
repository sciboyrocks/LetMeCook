CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'doing', 'done')),
  priority     INTEGER NOT NULL DEFAULT 3
    CHECK (priority IN (1, 2, 3)),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tasks_project_status_position_idx
  ON tasks (project_id, status, position ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS tasks_project_priority_idx
  ON tasks (project_id, priority ASC, created_at DESC);

ALTER TABLE projects ADD COLUMN milestone_name TEXT DEFAULT '';
ALTER TABLE projects ADD COLUMN target_date TEXT DEFAULT NULL;
