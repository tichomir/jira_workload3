import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env['DB_PATH'] ?? join(__dirname, '../../data/jira_workload.db');
const MIGRATIONS_DIR = join(__dirname, 'migrations');

let _db: Database.Database | null = null;

function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename  TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    )
  `);

  const applied = new Set<string>(
    (db.prepare('SELECT filename FROM schema_migrations').all() as { filename: string }[])
      .map(r => r.filename)
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (filename, appliedAt) VALUES (?, ?)').run(
      file,
      new Date().toISOString()
    );
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applyMigrations(_db);
  return _db;
}

/** For testing only: replace the singleton with an injected database. */
export function _setDbForTesting(db: Database.Database): void {
  _db = db;
}

/** For testing only: close and clear the singleton so the next getDb() call starts fresh. */
export function _resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

if (process.argv[1] === __filename) {
  getDb();
  console.log(`Database initialized at ${DB_PATH}`);
}
