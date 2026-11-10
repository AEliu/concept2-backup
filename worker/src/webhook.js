const MAX_BODY_BYTES = 64 * 1024;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const EVENT_TYPES = new Set(['result-added', 'result-updated', 'result-deleted']);

function json(status, body, requestId, retryAfter) {
  const headers = { 'Content-Type': 'application/json', 'X-Request-Id': requestId };
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidResultId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseEvent(body) {
  if (!isObject(body) || Object.keys(body).length !== 1 || !isObject(body.data)) return null;
  const data = body.data;
  if (!EVENT_TYPES.has(data.type)) return null;

  if (data.type === 'result-deleted') {
    if (Object.keys(data).length !== 2 || !isValidResultId(data.result_id)) return null;
    return { eventType: data.type, resultId: data.result_id, data };
  }

  if (Object.keys(data).length !== 2 || !isObject(data.result) ||
      !isValidResultId(data.result.id)) return null;
  return { eventType: data.type, resultId: data.result.id, data };
}

function canonicalJson(value, depth = 0) {
  if (depth > 16) throw new Error('Webhook payload nesting limit exceeded');
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function eventDigest(data) {
  const bytes = new TextEncoder().encode(canonicalJson(data));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readBoundedBody(request) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, requestId);

    // Concept2 documents a configurable endpoint URL, but no signature or custom headers.
    // A high-entropy secret URL path is therefore the compatible authentication factor.
    if (typeof env.WEBHOOK_SECRET !== 'string' || !SECRET_PATTERN.test(env.WEBHOOK_SECRET) ||
        !env.GITHUB_PAT || !env.WEBHOOK_GATE) {
      console.error(`Webhook ${requestId}: configuration unavailable`);
      return json(503, { error: 'Service unavailable' }, requestId);
    }
    if (new URL(request.url).pathname !== `/webhook/${env.WEBHOOK_SECRET}`) {
      console.warn(`Webhook ${requestId}: unauthorized`);
      return json(401, { error: 'Unauthorized' }, requestId);
    }

    let event;
    let digest;
    try {
      const bodyText = await readBoundedBody(request);
      if (bodyText === null) return json(413, { error: 'Payload too large' }, requestId);
      event = parseEvent(JSON.parse(bodyText));
      if (!event) return json(400, { error: 'Invalid webhook payload' }, requestId);
      digest = await eventDigest(event.data);
    } catch {
      return json(400, { error: 'Invalid webhook payload' }, requestId);
    }

    try {
      const gate = env.WEBHOOK_GATE.get(env.WEBHOOK_GATE.idFromName('concept2-webhooks'));
      const outcome = await gate.dispatch(event.eventType, event.resultId, digest);
      console.log(`Webhook ${requestId}: ${outcome}, ${event.eventType}, result ${event.resultId}`);

      if (outcome === 'accepted') {
        return json(200, { success: true, result_id: event.resultId, event_type: event.eventType }, requestId);
      }
      if (outcome === 'duplicate') return json(200, { success: true, duplicate: true }, requestId);
      if (outcome === 'rate_limited') return json(429, { error: 'Rate limit exceeded' }, requestId, 60);
      if (outcome === 'pending') return json(503, { error: 'Delivery pending' }, requestId, 10);
      return json(502, { error: 'Dispatch failed' }, requestId);
    } catch {
      console.error(`Webhook ${requestId}: dispatch unavailable`);
      return json(503, { error: 'Service unavailable' }, requestId);
    }
  }
};
