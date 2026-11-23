// Reads every environment variable the app uses. Keep .env.example in sync.
export function loadConfig(env = process.env) {
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT) || 8080,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || '/data',
    baseUrl: env.BASE_URL || 'http://localhost:8080',
  };
}
