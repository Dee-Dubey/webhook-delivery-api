const express = require('express');
const { sequelize, Endpoint, Subscription } = require('../models');
const { validateEndpointInput } = require('../validation');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const errors = validateEndpointInput(req.body);
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { url } = req.body;
    const events = [...new Set(req.body.events)]; // remove duplicate subscriptions

    // Endpoint + its subscriptions are saved together or not at all.
    const endpoint = await sequelize.transaction(async (t) => {
      const created = await Endpoint.create({ url }, { transaction: t });
      await Subscription.bulkCreate(
        events.map((eventType) => ({ endpointId: created.id, eventType })),
        { transaction: t }
      );
      return created;
    });

    return res.status(201).json({ id: endpoint.id, url, events });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
