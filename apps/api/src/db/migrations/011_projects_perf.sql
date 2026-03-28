/*
 * 011_projects_perf.sql
 * Performance indexes for high-traffic project list/sort patterns.
 */

CREATE INDEX IF NOT EXISTS projects_list_order_idx
  ON projects (pinned DESC, last_opened_at DESC, updated_at DESC);
