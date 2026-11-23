import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db/index.js';
import { seedParksIfEmpty } from '../../src/db/seed.js';

test('db-backup copies a live database consistently and checks its integrity', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-backup-'));
  const live = openDb(path.join(dir, 'app.db')); // WAL mode, still open (like the running app)
  seedParksIfEmpty(live);
  live.prepare("UPDATE parks SET name = 'Changed while live' WHERE slug = 'abercrombie-park'").run();
  const out = path.join(dir, 'copy.db');
  const log = execFileSync(process.execPath, ['scripts/db-backup.js', out], { env: { ...process.env, DATA_DIR: dir } }).toString();
  assert.match(log, /Backed up to/);
  const copy = new Database(out, { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) FROM parks').pluck().get(), 102);
  assert.equal(copy.prepare("SELECT name FROM parks WHERE slug = 'abercrombie-park'").pluck().get(), 'Changed while live');
  copy.close();
  live.close();
});

test('backup.sh is valid bash', () => {
  execFileSync('bash', ['-n', 'scripts/backup.sh']);
});
