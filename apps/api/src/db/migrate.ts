import type { Database } from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function runMigrations(db: Database): void {
  // Bootstrap: schema_migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db
      .prepare<[], { version: string }>('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((r) => r.version)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');
    if (applied.has(version)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    db.transaction(() => {
      const already = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
      if (already) return;
      db.exec(sql);
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(version);
    })();

    console.log(`✅ Migration applied: ${file}`);
  }
}
