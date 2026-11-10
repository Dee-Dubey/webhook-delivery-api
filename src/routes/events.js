const express = require('express');
const { validateEventInput } = require('../validation');
const { acceptEvent, getPendingDeliveries, getEventWithDeliveries } = require('../eventService');
const { deliverAll } = require('../delivery');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const errors = validateEventInput(req.body);
    if (errors.length) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { eventId, eventType, payload } = req.body;

    const accepted = await acceptEvent({ eventId, eventType, payload });
    if (accepted.duplicate) {
      return res.status(409).json({
        error: 'Duplicate event',
        message: `eventId "${eventId}" was already accepted. Use GET /events/${eventId} to see its delivery status.`,
      });
    }

    // Delivery happens inside the request flow (no queue / worker, per the brief).
    const deliveries = await getPendingDeliveries(accepted.eventPk);
    await deliverAll(deliveries, { eventId, eventType, payload });

    // Event is accepted (and stored) regardless of delivery outcome -> 201.
    const result = await getEventWithDeliveries(eventId);
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:eventId', async (req, res, next) => {
  try {
    const result = await getEventWithDeliveries(req.params.eventId);
    if (!result) {
      return res.status(404).json({ error: `Event "${req.params.eventId}" not found` });
    }
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
