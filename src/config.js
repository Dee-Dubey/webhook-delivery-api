require('dotenv').config();

// Getters (not constants) so tests can change process.env at runtime.
const num = (name, def) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
};

module.exports = {
  get port() { return num('PORT', 3000); },
  get db() {
    return {
      host: process.env.DB_HOST || '127.0.0.1',
      port: num('DB_PORT', 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'webhooks',
    };
  },
  get delivery() {
    return {
      timeoutMs: num('DELIVERY_TIMEOUT_MS', 5000),
      maxAttempts: Math.max(1, Math.floor(num('MAX_ATTEMPTS', 3))),
      retryDelayMs: Math.max(0, num('RETRY_DELAY_MS', 500)),
    };
  },
};
