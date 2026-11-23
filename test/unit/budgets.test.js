import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// SPEC NFR: JS shipped per page is 50 KB gzipped or less, excluding Leaflet. Every page loads at
// most a few of these, so the whole folder staying under the budget proves it for each page.
test('all of public/js together is under 50 KB gzipped', () => {
  const dir = 'public/js';
  const total = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .reduce((sum, f) => sum + zlib.gzipSync(fs.readFileSync(path.join(dir, f))).length, 0);
  assert.ok(total < 50 * 1024, `${total} bytes gzipped`);
});
