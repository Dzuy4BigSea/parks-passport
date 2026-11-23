import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { seedParksIfEmpty, seedBadges } from './db/seed.js';
import { createMailer } from './lib/mail.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'app.db'));
const mailer = createMailer(config.mail);
const app = buildApp({
  db, mailer, logger: config.nodeEnv !== 'test',
  config: { baseUrl: config.baseUrl, secureCookies: config.secureCookies },
});

const seeded = seedParksIfEmpty(db);
if (seeded) app.log.info({ ...seeded, invalid: seeded.invalid.length }, 'seeded parks from seed/parks.csv');
const badgeCount = seedBadges(db);
if (badgeCount) app.log.info({ badges: badgeCount }, 'seeded badges from seed/badges.json');

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
