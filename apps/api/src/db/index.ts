import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import { runMigrations } from './migrate.js';

const DB_PATH = `${config.dataDir}/app.db`;

// Ensure the data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Run migrations on startup
runMigrations(db);

export { db };
export type { DatabaseType as Database };
