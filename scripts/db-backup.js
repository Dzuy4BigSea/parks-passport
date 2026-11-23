// Writes a consistent copy of the live SQLite database (online backup API; the app keeps running).
//   node scripts/db-backup.js <output file>
// Used by scripts/backup.sh inside the container.
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from '../src/config.js';

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/db-backup.js <output file>');
  process.exit(2);
}
const db = new Database(path.join(loadConfig().dataDir, 'app.db'), { readonly: true, fileMustExist: true });
await db.backup(out);
db.close();
const check = new Database(out, { readonly: true });
const ok = check.pragma('integrity_check', { simple: true });
check.close();
if (ok !== 'ok') {
  console.error(`Backup integrity check failed: ${ok}`);
  process.exit(1);
}
console.log(`Backed up to ${out}`);
