import path from 'node:path';

// Reads every environment variable the app uses. Keep .env.example in sync.
export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const dataDir = env.DATA_DIR || (production ? '/data' : './data');
  return {
    nodeEnv,
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    dataDir,
    baseUrl: (env.BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
    secureCookies: production,
    mail: {
      transport: env.MAIL_TRANSPORT || (production ? 'sendgrid' : 'outbox'),
      outboxDir: path.join(dataDir, 'outbox'),
      sendgridApiKey: env.SENDGRID_API_KEY || '',
      from: env.MAIL_FROM || 'hello@parkspassport.dzuynguyen.com',
    },
  };
}
