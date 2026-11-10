const express = require('express');
const endpointsRouter = require('./routes/endpoints');
const eventsRouter = require('./routes/events');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/webhook-endpoints', endpointsRouter);
  app.use('/events', eventsRouter);

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

  // Central error handler: malformed JSON -> 400, everything else -> 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
