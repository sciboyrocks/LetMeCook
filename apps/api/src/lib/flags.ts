import type { Database } from 'better-sqlite3';

/**
 * Read a feature flag from the settings table.
 * Flags are stored as `feature_<name>` keys with value '1' / '0'.
 */
export function getFlag(db: Database, name: string): boolean {
  const row = db
    .prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?'
    )
    .get(`feature_${name}`);
  return row?.value === '1';
}

export function setFlag(db: Database, name: string, enabled: boolean): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `feature_${name}`,
    enabled ? '1' : '0'
  );
}
