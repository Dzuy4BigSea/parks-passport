// Promotes (or with --remove, demotes) a member to admin.
//   npm run make-admin -- someone@example.com [--remove]
// On aster: docker exec parks-passport node scripts/make-admin.js someone@example.com
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { setAdmin } from '../src/domain/users.js';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run make-admin -- <email> [--remove]');
  process.exit(2);
}
const db = openDb(path.join(loadConfig().dataDir, 'app.db'));
const changed = setAdmin(db, email, flag !== '--remove');
db.close();
if (!changed) {
  console.error(`No account found for ${email}. They need to sign up first.`);
  process.exit(1);
}
console.log(`${email} is ${flag === '--remove' ? 'no longer an admin' : 'now an admin'}.`);
