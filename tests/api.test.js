const request = require('supertest');

// Fast, deterministic settings for tests (no real waiting).
// Must be set BEFORE the app/db modules read the config.
process.env.DB_NAME = process.env.TEST_DB_NAME || 'webhooks_test';
process.env.DELIVERY_TIMEOUT_MS = '300';
process.env.MAX_ATTEMPTS = '3';
process.env.RETRY_DELAY_MS = '0';

const { createApp } = require('../src/app');
const { execSync } = require('child_process');
const { sequelize, Endpoint, Subscription, Event, Delivery } = require('../src/models');
const { startMockServer } = require('./mockServer');

const app = createApp();
let mock;

beforeAll(async () => {
  // Run the REAL sequelize migration on a clean test DB (proves migrations work from scratch).
  execSync('npx sequelize-cli db:create && npx sequelize-cli db:migrate', { env: process.env, stdio: 'pipe' });
  mock = await startMockServer();
}, 60000);

afterAll(async () => {
  await mock.close();
  await sequelize.close();
});

beforeEach(async () => {
  // Children first, parents last (foreign keys)
  await Delivery.destroy({ where: {} });
  await Event.destroy({ where: {} });
  await Subscription.destroy({ where: {} });
  await Endpoint.destroy({ where: {} });
  mock.reset();
});

const registerEndpoint = (path, events = ['order.created']) =>
  request(app).post('/webhook-endpoints').send({ url: `${mock.baseUrl}${path}`, events });

const sendEvent = (eventId, eventType = 'order.created') =>
  request(app).post('/events').send({ eventId, eventType, payload: { orderId: 'order_123', amount: 1500 } });

describe('POST /webhook-endpoints', () => {
  test('1. registers a valid endpoint', async () => {
    const res = await registerEndpoint('/ok', ['order.created', 'order.updated']);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.events).toEqual(['order.created', 'order.updated']);
  });

  test('2. rejects invalid input and names the wrong field', async () => {
    const badUrl = await request(app).post('/webhook-endpoints').send({ url: 'not-a-url', events: ['order.created'] });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.details[0].field).toBe('url');

    const ftp = await request(app).post('/webhook-endpoints').send({ url: 'ftp://x.com/a', events: ['order.created'] });
    expect(ftp.status).toBe(400);

    const badType = await request(app).post('/webhook-endpoints').send({ url: 'https://x.com', events: ['nope.event'] });
    expect(badType.status).toBe(400);
    expect(badType.body.details[0].field).toBe('events');

    const empty = await request(app).post('/webhook-endpoints').send({ url: 'https://x.com', events: [] });
    expect(empty.status).toBe(400);

    const missing = await request(app).post('/webhook-endpoints').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.details.map((d) => d.field).sort()).toEqual(['events', 'url']);
  });

  test('rejects invalid event input', async () => {
    const res = await request(app).post('/events').send({ eventId: '', eventType: 'x', payload: [] });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field).sort()).toEqual(['eventId', 'eventType', 'payload']);
  });
});

describe('POST /events + GET /events/:eventId', () => {
  test('3. accepts an event and delivers it successfully', async () => {
    const ep = await registerEndpoint('/ok');
    const res = await sendEvent('evt_1001');

    expect(res.status).toBe(201);
    expect(res.body.deliveries).toHaveLength(1);
    expect(res.body.deliveries[0]).toMatchObject({
      endpointId: ep.body.id, status: 'succeeded', attempts: 1, lastStatusCode: 200,
    });
    expect(mock.hits['/ok']).toBe(1);
    expect(mock.bodies['/ok'][0]).toEqual({
      eventId: 'evt_1001', eventType: 'order.created', payload: { orderId: 'order_123', amount: 1500 },
    });

    const get = await request(app).get('/events/evt_1001');
    expect(get.status).toBe(200);
    expect(get.body.deliveries[0].status).toBe('succeeded');
  });

  test('GET unknown eventId returns 404', async () => {
    const res = await request(app).get('/events/does_not_exist');
    expect(res.status).toBe(404);
  });

  test('only endpoints subscribed to the type receive the event', async () => {
    await registerEndpoint('/ok', ['order.created']);
    await registerEndpoint('/fail', ['payment.failed']);
    const res = await sendEvent('evt_sub');
    expect(res.body.deliveries).toHaveLength(1);
    expect(mock.hits['/fail']).toBeUndefined();
  });

  test('4. rejects a duplicate eventId submitted sequentially', async () => {
    await registerEndpoint('/ok');
    const first = await sendEvent('evt_dup');
    const second = await sendEvent('evt_dup');

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(mock.hits['/ok']).toBe(1); // no second round of deliveries

    expect(await Event.count()).toBe(1);
  });

  test('5. rejects a duplicate eventId submitted concurrently (exactly one accepted)', async () => {
    await registerEndpoint('/ok');
    const results = await Promise.all(Array.from({ length: 15 }, () => sendEvent('evt_race')));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(14);
    expect(mock.hits['/ok']).toBe(1);

    expect(await Event.count()).toBe(1);
  });

  test('6. retries a failing endpoint, stops at the attempt limit, status = failed', async () => {
    await registerEndpoint('/fail');
    const res = await sendEvent('evt_fail');

    expect(res.status).toBe(201); // event itself was accepted
    expect(res.body.deliveries[0]).toMatchObject({
      status: 'failed', attempts: 3, lastStatusCode: 500,
    });
    expect(mock.hits['/fail']).toBe(3); // exactly 3, never more
  });

  test('7. treats a slow endpoint as a failed attempt via timeout', async () => {
    await registerEndpoint('/slow');
    const res = await sendEvent('evt_slow');

    const d = res.body.deliveries[0];
    expect(d.status).toBe('failed');
    expect(d.attempts).toBe(3);
    expect(d.lastStatusCode).toBeNull();
    expect(d.lastError).toMatch(/timeout/i);
  });

  test('one failing endpoint does not block the others', async () => {
    await registerEndpoint('/fail');
    await registerEndpoint('/slow');
    await registerEndpoint('/ok');
    const res = await sendEvent('evt_mixed');

    const byUrl = Object.fromEntries(res.body.deliveries.map((d) => [d.url.replace(mock.baseUrl, ''), d.status]));
    expect(byUrl).toEqual({ '/fail': 'failed', '/slow': 'failed', '/ok': 'succeeded' });
  });

  test('unreachable endpoint (connection refused) is a failure, not a crash', async () => {
    await request(app).post('/webhook-endpoints').send({ url: 'http://127.0.0.1:1/nothing', events: ['order.created'] });
    const res = await sendEvent('evt_refused');
    expect(res.status).toBe(201);
    expect(res.body.deliveries[0].status).toBe('failed');
    expect(res.body.deliveries[0].lastError).toBeTruthy();
  });
});
