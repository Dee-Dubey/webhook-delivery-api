// Config used by sequelize-cli (migrations). Reads the same .env as the app.
const config = require('../src/config');

const base = {
  username: config.db.user,
  password: config.db.password,
  database: config.db.database,
  host: config.db.host,
  port: config.db.port,
  dialect: 'mysql',
  logging: false,
};

module.exports = { development: base, test: base, production: base };
