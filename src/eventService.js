const { UniqueConstraintError } = require('sequelize');
const { sequelize, Event, Subscription, Delivery, Endpoint } = require('./models');

// MySQL returns JSON as an object, MariaDB as a string. Handle both.
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/**
 * Atomically: insert the event + create one pending delivery row per subscribed endpoint.
 *
 * Duplicate protection: the UNIQUE index on events.event_id. With two concurrent
 * requests for the same eventId, the 2nd INSERT waits for the 1st transaction and then
 * fails -> Sequelize throws UniqueConstraintError -> we return { duplicate: true }.
 * The managed transaction auto-rolls back when the callback throws.
 */
async function acceptEvent({ eventId, eventType, payload }) {
  try {
    return await sequelize.transaction(async (t) => {
      const event = await Event.create({ eventId, eventType, payload }, { transaction: t });

      const subs = await Subscription.findAll({
        where: { eventType },
        attributes: ['endpointId'],
        transaction: t,
      });

      if (subs.length > 0) {
        await Delivery.bulkCreate(
          subs.map((s) => ({ eventPk: event.id, endpointId: s.endpointId })),
          { transaction: t }
        );
      }
      return { duplicate: false, eventPk: event.id };
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) return { duplicate: true };
    throw err;
  }
}

async function getPendingDeliveries(eventPk) {
  const rows = await Delivery.findAll({
    where: { eventPk },
    include: [{ model: Endpoint, as: 'endpoint', attributes: ['id', 'url'] }],
  });
  return rows.map((d) => ({ id: d.id, endpointId: d.endpointId, url: d.endpoint.url }));
}

async function getEventWithDeliveries(eventId) {
  const ev = await Event.findOne({
    where: { eventId },
    include: [
      {
        model: Delivery,
        as: 'deliveries',
        include: [{ model: Endpoint, as: 'endpoint', attributes: ['url'] }],
      },
    ],
    order: [[{ model: Delivery, as: 'deliveries' }, 'endpointId', 'ASC']],
  });
  if (!ev) return null;

  return {
    eventId: ev.eventId,
    eventType: ev.eventType,
    payload: parseJson(ev.payload),
    createdAt: ev.createdAt,
    deliveries: ev.deliveries.map((d) => ({
      endpointId: d.endpointId,
      url: d.endpoint.url,
      status: d.status,
      attempts: d.attempts,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      lastAttemptAt: d.lastAttemptAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  };
}

module.exports = { acceptEvent, getPendingDeliveries, getEventWithDeliveries };
