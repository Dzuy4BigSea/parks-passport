// Runs once, after the test server is up (Playwright starts webServer before globalSetup).
// Night Owl is a surprise badge for looking at parks between 9 pm and 4 am in the park's city.
// The server's clock is real, so in the evening it would pop up in specs that don't expect it.
// It's switched off here; test/unit/rewards.test.js covers it with a fake clock.
import path from 'node:path';
import { openDb } from '../../src/db/index.js';

export default async function globalSetup() {
  const db = openDb(path.join(process.env.PP_E2E_DATA_DIR, 'app.db'));
  try {
    for (let i = 0; i < 50; i++) {
      if (db.prepare("UPDATE badges SET enabled = 0 WHERE slug = 'night-owl'").run().changes) return;
      await new Promise((r) => setTimeout(r, 100)); // the server is still seeding
    }
    throw new Error('night-owl badge not found in the e2e database');
  } finally {
    db.close();
  }
}
