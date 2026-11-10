# Reliable Webhook Delivery API

Node.js + Express + Sequelize (ORM) + MySQL. Customers register webhook endpoints, submit events, and the API delivers
them (inside the request flow) with a bounded retry. Duplicate events are rejected at the DB level.

## Setup

Requirements: Node.js >= 18.2, MySQL 8 (or `docker compose up -d`).

```bash
docker compose up -d          # optional: starts MySQL 8 on :3306 (root / password)
cp .env.example .env          # edit if your DB credentials differ
npm install
npm run migrate               # sequelize-cli: creates DB + runs migrations/ (safe to re-run)
npm start                     # http://localhost:3000
npm test                      # uses a separate DB "webhooks_test", auto-created
```

### Environment variables
| Var | Default | Meaning |
|---|---|---|
| PORT | 3000 | HTTP port |
| DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME | 127.0.0.1 / 3306 / root / (empty) / webhooks | MySQL connection |
| DELIVERY_TIMEOUT_MS | 5000 | Timeout for each delivery attempt |
| MAX_ATTEMPTS | 3 | Max attempts per endpoint (1 initial + 2 retries) |
| RETRY_DELAY_MS | 500 | Base retry delay (exponential) |
| TEST_DB_NAME | webhooks_test | DB used by tests |

## API
- `POST /webhook-endpoints` `{url, events[]}` -> 201 `{id,url,events}`; 400 with `details:[{field,message}]`
- `POST /events` `{eventId,eventType,payload}` -> 201 event + deliveries; 409 duplicate; 400 invalid
- `GET /events/:eventId` -> 200 event + per-endpoint deliveries; 404 unknown

## Schema (migrations/20260101000000-init-schema.js)
Created by a Sequelize migration (`npx sequelize-cli db:migrate`), which runs from a clean database. Models are in `src/models/index.js`.
- `webhook_endpoints` - id, url
- `endpoint_subscriptions` - PK (endpoint_id, event_type) + index (event_type, endpoint_id) for the subscription lookup
- `events` - **UNIQUE(event_id)** (migration + model) enforces one-time acceptance in the database
- `deliveries` - one row per (event, endpoint) via **UNIQUE(event_pk, endpoint_id)**, FKs to both; status `pending|succeeded|failed`, attempts, last_status_code, last_error, timestamps

## Design decisions

### Duplicate events -> `409 Conflict`
The same eventId is a conflict with existing state, not a new resource. 409 clearly tells the sender
"already accepted, do not expect new deliveries", and the body points to `GET /events/:eventId`.
Concurrency: the UNIQUE index decides the winner. The second concurrent INSERT waits for the first
transaction, then fails (Sequelize throws `UniqueConstraintError`), which is mapped to 409. No check-then-insert race.

### Accepted event but failed deliveries -> `201 Created`
The event was validated and durably stored; that is what the request asks for. A customer endpoint being
down is not the sender's error, so we don't return 5xx (which would invite the sender to retry and hit 409).
The 201 body contains each endpoint's final delivery status (`succeeded` / `failed`), and `GET /events/:eventId`
shows the same later.

### Retry strategy: bounded exponential backoff
Max 3 attempts per endpoint, delays `RETRY_DELAY_MS * 2^(n-1)` (500ms, 1000ms by default). Exponential
backoff gives a briefly-down endpoint time to recover without hammering it. Because delivery happens
inside the HTTP request (no workers allowed), the delays are short so the request does not hang for long.
The retry loop is a `for` loop with a fixed upper bound, so an infinite loop is impossible.
Tests set `RETRY_DELAY_MS=0`, so nothing waits.
Endpoints are delivered in parallel (`Promise.allSettled`), so one slow/failing endpoint never blocks others.
Worst case request time is about `MAX_ATTEMPTS * timeout + delays` (about 16.5s with defaults).

### Other choices
- Why Sequelize: models/relations/transactions are readable; the integrity rules still live in the DB (migration), not in the ORM.
- Event row and its pending delivery rows are created in ONE transaction (`sequelize.transaction`), then deliveries run after commit.
- 3xx responses are treated as failures (`redirect: 'manual'`), only 2xx is success.
- Every attempt is persisted right away, so `GET` shows progress and final state.

## Known limitations
- **Crash mid-delivery:** the event and `pending` delivery rows are already committed, but nothing resumes
  them after restart, so those deliveries stay `pending` forever and the client got no response. A fix needs a
  recovery job or a queue, which the brief excludes.
- A client that retries after a crash gets 409, because the event was already stored.
- Delivery inside the request means slow endpoints make the POST /events response slow.
- No SSRF protection (private/internal IPs are allowed as webhook URLs; tests need localhost).

## Not done / future work
Authentication, webhook signing, pagination, background worker with persistent retry schedule, SSRF blocklist,
endpoint deactivation/deletion APIs.
