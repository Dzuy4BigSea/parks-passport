// Makes a member the super admin (or with --remove, takes it away). The super admin sees and
// triages every badge idea (SPEC Flow 13). Making someone super admin also makes them an admin.
//   npm run make-super-admin -- someone@example.com [--remove]
// On aster: docker exec parks-passport node scripts/make-super-admin.js someone@example.com
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { setSuperAdmin } from '../src/domain/users.js';

const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run make-super-admin -- <email> [--remove]');
  process.exit(2);
}
const db = openDb(path.join(loadConfig().dataDir, 'app.db'));
const changed = setSuperAdmin(db, email, flag !== '--remove');
db.close();
if (!changed) {
  console.error(`No account found for ${email}. They need to sign up first.`);
  process.exit(1);
}
console.log(`${email} is ${flag === '--remove' ? 'no longer the super admin (still an admin)' : 'now a super admin'}.`);
