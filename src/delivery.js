const { Delivery } = require('./models');
const config = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One HTTP attempt. NEVER throws: always resolves to
 * { ok, statusCode, error }.
 */
async function attemptOnce(url, body, timeoutMs) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs), // hard per-attempt timeout
      redirect: 'manual', // a 3xx is not a 2xx -> counts as failure
    });
    // Free the socket; we don't need the response body.
    try { await res.body?.cancel(); } catch { /* ignore */ }

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, statusCode: res.status, error: null };
    }
    return { ok: false, statusCode: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const msg = isTimeout
      ? `Timeout after ${timeoutMs}ms`
      : `${err?.cause?.code || err?.name || 'Error'}: ${err?.cause?.message || err?.message || 'unknown'}`;
    return { ok: false, statusCode: null, error: msg.slice(0, 500) };
  }
}

async function recordAttempt(deliveryId, attemptNo, result, finalStatus) {
  await Delivery.update(
    {
      attempts: attemptNo,
      status: finalStatus,
      lastStatusCode: result.statusCode,
      lastError: result.error,
      lastAttemptAt: new Date(),
    },
    { where: { id: deliveryId } }
  );
}

/**
 * Deliver to ONE endpoint with bounded retry.
 * The for-loop has a fixed upper bound => impossible to loop forever.
 * Never throws, so one bad endpoint can't break the others.
 */
async function deliverWithRetry(delivery, webhookBody) {
  const { timeoutMs, maxAttempts, retryDelayMs } = config.delivery;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await attemptOnce(delivery.url, webhookBody, timeoutMs);

    const isLast = attempt === maxAttempts;
    const finalStatus = result.ok ? 'succeeded' : isLast ? 'failed' : 'pending';

    try {
      await recordAttempt(delivery.id, attempt, result, finalStatus);
    } catch (dbErr) {
      console.error(`Failed to record attempt for delivery ${delivery.id}:`, dbErr.message);
    }

    if (result.ok || isLast) return;

    // Exponential backoff: delay, 2*delay, 4*delay ...
    await sleep(retryDelayMs * 2 ** (attempt - 1));
  }
}

/** Deliver to all endpoints in parallel; failures are isolated per endpoint. */
async function deliverAll(deliveries, webhookBody) {
  await Promise.allSettled(deliveries.map((d) => deliverWithRetry(d, webhookBody)));
}

module.exports = { attemptOnce, deliverWithRetry, deliverAll };
