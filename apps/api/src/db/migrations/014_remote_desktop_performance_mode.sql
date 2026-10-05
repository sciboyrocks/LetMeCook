-- Speed-first sessions: existing connections keep starting in Fast.
ALTER TABLE remote_desktop_connections ADD COLUMN performance_mode TEXT NOT NULL DEFAULT 'fast';
