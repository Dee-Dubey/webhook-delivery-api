const { createApp } = require('./app');
const config = require('./config');
const { sequelize } = require('./models');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Webhook API listening on http://localhost:${config.port}`);
});

// Last-resort safety net: log, don't die silently.
process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r));

const shutdown = () => {
  server.close(async () => {
    await sequelize.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
