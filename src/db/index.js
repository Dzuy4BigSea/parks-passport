import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Opens (or creates) the SQLite database and applies pending migrations in filename order.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''); // an editor's BOM must not hide the marker
    // A migration that rebuilds a table (create new, copy, drop old, rename) must run with foreign
    // keys off, or dropping the old table cascades into the rows that reference it. The pragma
    // can't change inside a transaction, so it's switched around it, and every foreign key is
    // checked before the migration commits.
    const fkOff = sql.startsWith('-- migrate:foreign-keys-off');
    // Dropping a table with foreign keys on deletes every row that references it (cascades).
    if (!fkOff && /\bDROP\s+TABLE\b/i.test(sql)) throw new Error(`${name} drops a table: start it with -- migrate:foreign-keys-off`);
    if (fkOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (fkOff) {
          const broken = db.pragma('foreign_key_check');
          if (broken.length) throw new Error(`${name} broke ${broken.length} foreign keys (first: ${JSON.stringify(broken[0])})`);
        }
        db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      })();
    } finally {
      if (fkOff) db.pragma('foreign_keys = ON');
    }
  }
}
