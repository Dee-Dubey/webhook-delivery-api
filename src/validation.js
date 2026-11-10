const SUPPORTED_EVENT_TYPES = [
  'order.created',
  'order.updated',
  'order.cancelled',
  'payment.succeeded',
  'payment.failed',
];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const u = new URL(value); // throws for relative / garbage URLs
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Each validator returns an array of { field, message }. Empty array = valid.
function validateEndpointInput(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }];
  }
  if (body.url === undefined) {
    errors.push({ field: 'url', message: 'url is required' });
  } else if (!isValidHttpUrl(body.url)) {
    errors.push({ field: 'url', message: 'url must be a valid absolute http or https URL' });
  }

  if (body.events === undefined) {
    errors.push({ field: 'events', message: 'events is required' });
  } else if (!Array.isArray(body.events) || body.events.length === 0) {
    errors.push({ field: 'events', message: 'events must be a non-empty array' });
  } else {
    const bad = body.events.filter((e) => !SUPPORTED_EVENT_TYPES.includes(e));
    if (bad.length) {
      errors.push({
        field: 'events',
        message: `unsupported event type(s): ${bad.map(String).join(', ')}. Supported: ${SUPPORTED_EVENT_TYPES.join(', ')}`,
      });
    }
  }
  return errors;
}

function validateEventInput(body) {
  const errors = [];
  if (!isPlainObject(body)) {
    return [{ field: 'body', message: 'Request body must be a JSON object' }];
  }
  if (typeof body.eventId !== 'string' || body.eventId.trim() === '') {
    errors.push({ field: 'eventId', message: 'eventId is required and must be a non-empty string' });
  } else if (body.eventId.length > 255) {
    errors.push({ field: 'eventId', message: 'eventId must be at most 255 characters' });
  }

  if (body.eventType === undefined) {
    errors.push({ field: 'eventType', message: 'eventType is required' });
  } else if (!SUPPORTED_EVENT_TYPES.includes(body.eventType)) {
    errors.push({
      field: 'eventType',
      message: `eventType must be one of: ${SUPPORTED_EVENT_TYPES.join(', ')}`,
    });
  }

  if (body.payload === undefined) {
    errors.push({ field: 'payload', message: 'payload is required' });
  } else if (!isPlainObject(body.payload)) {
    errors.push({ field: 'payload', message: 'payload must be a JSON object' });
  }
  return errors;
}

module.exports = { SUPPORTED_EVENT_TYPES, validateEndpointInput, validateEventInput, isValidHttpUrl };
