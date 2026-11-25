import path from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { seedParksIfEmpty, seedBadges, seedCityTheme, seedActivityData } from './db/seed.js';
import { createMailer } from './lib/mail.js';
import { createSecretBox } from './lib/secret-box.js';
import { emailSettings, sendgridKey } from './domain/settings.js';
import { buildApp } from './app.js';
import { createThemeGenerator } from './lib/theme-ai.js';
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
const app = buildApp({
  db, mailer, secretBox, logger: config.nodeEnv !== 'test', themeAi: createThemeGenerator({ apiKey: config.anthropicApiKey }),
  ideaAi: createIdeaTriager({ apiKey: config.anthropicApiKey }),
  config: {
    baseUrl: config.baseUrl, secureCookies: config.secureCookies, uploadsDir: path.join(config.dataDir, 'uploads'),
    mailTransport: config.mail.transport, mailFrom: config.mail.from, sendgridEnvKey: config.mail.sendgridApiKey,
    analytics: config.analytics,
  },
});

const seeded = seedParksIfEmpty(db);
if (seeded) app.log.info({ ...seeded, invalid: seeded.invalid.length }, 'seeded parks from seed/parks.csv');
const badgeCount = seedBadges(db);
if (badgeCount) app.log.info({ badges: badgeCount }, 'seeded badges from seed/badges.json');
const activityBadges = seedActivityData(db);
if (activityBadges) app.log.info({ badges: activityBadges }, 'added activity badges from seed/activity-badges.json');
const motifCount = seedCityTheme(db);
if (motifCount) app.log.info({ motifs: motifCount }, 'seeded the city theme from seed/city-st-pete.json');

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => app.close().then(() => process.exit(0)));
}
