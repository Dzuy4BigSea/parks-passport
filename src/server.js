import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { seedParksIfEmpty } from './db/seed.js';
import { buildApp } from './app.js';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'app.db'));
const app = buildApp({ db, logger: config.nodeEnv !== 'test' });

const seeded = seedParksIfEmpty(db);
if (seeded) app.log.info({ ...seeded, invalid: seeded.invalid.length }, 'seeded parks from seed/parks.csv');

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
