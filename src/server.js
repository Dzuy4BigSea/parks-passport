import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { seedBadges, seedCities, seedActivityData } from './db/seed.js';
import { createMailer } from './lib/mail.js';
import { createSecretBox } from './lib/secret-box.js';
import { emailSettings, sendgridKey } from './domain/settings.js';
import { buildApp } from './app.js';
import { createThemeGenerator } from './lib/theme-ai.js';
import { createGeoIp } from './lib/geoip.js';
import { createIdeaTriager } from './lib/idea-ai.js';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'app.db'));
const secretBox = createSecretBox({ envKey: process.env.SETTINGS_KEY || '', keyFile: path.join(config.dataDir, 'settings.key') });
const mailer = createMailer({
  transport: config.mail.transport,
  outboxDir: config.mail.outboxDir,
  // Admin-saved settings win over .env, read on every send.
  resolve: () => {
    const s = emailSettings(db, { envFrom: config.mail.from });
    return {
      apiKey: sendgridKey(db, secretBox, { envKey: config.mail.sendgridApiKey }).key,
      fromAddress: s.mail_from_address, fromName: s.mail_from_name, replyTo: s.mail_reply_to,
    };
  },
});
const geoip = await createGeoIp({ file: config.geoipDb, log: { warn: (obj, msg) => console.warn(msg, obj) } }).catch((err) => {
  console.error(`GEOIP_DB could not be opened (${err.message}); the nearest-city suggestion is off`);
  return null;
});
const app = buildApp({
  db, mailer, secretBox, geoip, logger: config.nodeEnv !== 'test', themeAi: createThemeGenerator({ apiKey: config.anthropicApiKey }),
  ideaAi: createIdeaTriager({ apiKey: config.anthropicApiKey }),
  config: {
    baseUrl: config.baseUrl, secureCookies: config.secureCookies, uploadsDir: path.join(config.dataDir, 'uploads'),
    mailTransport: config.mail.transport, mailFrom: config.mail.from, sendgridEnvKey: config.mail.sendgridApiKey,
    analytics: config.analytics,
  },
});

// Badges for every city first: seedBadges only runs on an empty badges table.
const badgeCount = seedBadges(db);
if (badgeCount) app.log.info({ badges: badgeCount }, 'seeded badges from seed/badges.json');
const activityBadges = seedActivityData(db);
if (activityBadges) app.log.info({ badges: activityBadges }, 'added activity badges from seed/activity-badges.json');
for (const c of seedCities(db)) {
  if (c.motifs || c.parks || c.badges) {
    app.log.info({ city: c.key, motifs: c.motifs, parks: c.parks?.added ?? 0, invalidParks: c.parks?.invalid.length ?? 0, badges: c.badges },
      `seeded city pack seed/cities/${c.key}`);
  }
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
