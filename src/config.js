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
    // Analytics (SPEC Flow 10). Empty = not loaded.
    analytics: {
      gtmId: /^GTM-[A-Z0-9]{4,12}$/.test(env.GTM_ID || '') ? env.GTM_ID : '',
      gtmScriptOrigin: (env.GTM_SCRIPT_ORIGIN || 'https://www.googletagmanager.com').replace(/\/$/, ''),
      umamiWebsiteId: /^[0-9a-f-]{36}$/i.test(env.UMAMI_WEBSITE_ID || '') ? env.UMAMI_WEBSITE_ID : '',
      umamiScriptUrl: env.UMAMI_SCRIPT_URL || '/stats/script.js',
      umamiHostUrl: (env.UMAMI_HOST_URL || `${(env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '')}/stats`).replace(/\/$/, ''),
    },
    // Admin › City theme: AI research and icon drafts (Claude). Empty = the Generate button is off.
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    // Home page "nearest city" suggestion: a MaxMind GeoLite2-City .mmdb file. Empty = off.
    geoipDb: env.GEOIP_DB || '',
    // Gary dresses for the weather (Open-Meteo, no key). WEATHER=off turns it off (the e2e tests do).
    weatherOn: env.WEATHER !== 'off',
    mail: {
      transport: env.MAIL_TRANSPORT || (production ? 'sendgrid' : 'outbox'),
      outboxDir: path.join(dataDir, 'outbox'),
      sendgridApiKey: env.SENDGRID_API_KEY || '',
      from: env.MAIL_FROM || 'hello@parkspassport.dzuynguyen.com',
    },
  };
}
