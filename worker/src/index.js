/**
 * Concept2 Webhook Handler
 *
 * This Cloudflare Worker handles incoming webhooks from Concept2 Logbook API
 * and triggers GitHub Repository Dispatch events to initiate TCX downloads.
 *
 * Configuration:
 * - Set GITHUB_PAT secret: wrangler secret put GITHUB_PAT
 * - Update REPO_OWNER and REPO_NAME if needed
 */

const REPO_OWNER = 'AEliu';
const REPO_NAME = 'concept2-backup';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_PER_WINDOW = 20;
const SECURITY_GATE_OBJECT_NAME = 'webhook-security-gate';
const REPLAY_CLEANUP_CHANCE = 0.1;
const REPLAY_CLEANUP_BATCH_SIZE = 100;

function safeEquals(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function sha256Hex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isValidWebhookSecret(expectedSecret, providedSecret) {
  if (!providedSecret || !expectedSecret) {
    return false;
  }
  const expectedHash = await sha256Hex(expectedSecret);
  const providedHash = await sha256Hex(providedSecret);
  return safeEquals(expectedHash, providedHash);
}

async function callSecurityGate(env, path, payload) {
  if (!env.SECURITY_GATE) {
    throw new Error('SECURITY_GATE binding is missing');
  }

  const gateId = env.SECURITY_GATE.idFromName(SECURITY_GATE_OBJECT_NAME);
  const gateStub = env.SECURITY_GATE.get(gateId);
  const response = await gateStub.fetch(`https://security-gate${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`SECURITY_GATE error ${response.status}: ${details}`);
  }

  return response.json();
}

export class SecurityGate {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { pathname } = new URL(request.url);
    if (pathname === '/rate-limit') {
      return this.handleRateLimit(body);
    }
    if (pathname === '/replay-check') {
      return this.handleReplayCheck(body);
    }

    return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handleRateLimit({ clientKey, maxPerWindow, now }) {
    if (!clientKey || !maxPerWindow || !now) {
      return new Response(JSON.stringify({ error: 'Missing rate-limit parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_WINDOW_MS;
    const countKey = `rl:${clientKey}:${windowStart}`;
    const lastWindowKey = `rl:last:${clientKey}`;

    let allowed = false;
    let remaining = 0;

    await this.state.storage.transaction(async (txn) => {
      const previousWindowCountKey = await txn.get(lastWindowKey);
      if (previousWindowCountKey && previousWindowCountKey !== countKey) {
        await txn.delete(previousWindowCountKey);
      }

      const currentCount = (await txn.get(countKey)) || 0;
      if (currentCount >= maxPerWindow) {
        allowed = false;
        remaining = 0;
        return;
      }

      allowed = true;
      remaining = maxPerWindow - currentCount - 1;
      await txn.put(countKey, currentCount + 1);
      await txn.put(lastWindowKey, countKey);
    });

    return new Response(JSON.stringify({ allowed, remaining }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async handleReplayCheck({ replayKey, now, ttlMs }) {
    if (!replayKey || !now || !ttlMs) {
      return new Response(JSON.stringify({ error: 'Missing replay-check parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const storageKey = `rp:${replayKey}`;
    const expiresAt = now + ttlMs;
    const existing = await this.state.storage.get(storageKey);
    if (existing && existing > now) {
      return new Response(JSON.stringify({ duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await this.state.storage.put(storageKey, expiresAt);

    if (Math.random() < REPLAY_CLEANUP_CHANCE) {
      await this.cleanupExpiredReplayKeys(now);
    }

    return new Response(JSON.stringify({ duplicate: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async cleanupExpiredReplayKeys(now) {
    const list = await this.state.storage.list({ prefix: 'rp:', limit: REPLAY_CLEANUP_BATCH_SIZE });
    const expiredKeys = [];
    for (const [key, expiresAt] of list.entries()) {
      if (typeof expiresAt === 'number' && expiresAt <= now) {
        expiredKeys.push(key);
      }
    }
    if (expiredKeys.length > 0) {
      await this.state.storage.delete(expiredKeys);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    // Only allow POST requests
    if (request.method !== 'POST') {
      console.log(`[${new Date().toISOString()}] Rejected ${request.method} request`);
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const now = Date.now();
      const maxPerWindow = Number.parseInt(env.WEBHOOK_RATE_LIMIT_MAX_PER_MINUTE || '', 10) || DEFAULT_RATE_LIMIT_MAX_PER_WINDOW;
      const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
      const clientKey = `ip:${clientIp}`;

      const rateLimit = await callSecurityGate(env, '/rate-limit', {
        clientKey,
        maxPerWindow,
        now,
      });
      if (!rateLimit.allowed) {
        console.warn(`[${new Date().toISOString()}] Rate limit exceeded for ${clientIp}`);
        return new Response(
          JSON.stringify({ error: 'Too many requests' }),
          {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      const expectedSecret = env.WEBHOOK_SECRET;
      if (!expectedSecret) {
        console.error(`[${new Date().toISOString()}] WEBHOOK_SECRET environment variable not set`);
        return new Response(
          JSON.stringify({ error: 'Server configuration error: WEBHOOK_SECRET not set' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      const url = new URL(request.url);
      const providedSecret = request.headers.get('X-Webhook-Secret') || url.searchParams.get('token') || '';
      const isAuthorized = await isValidWebhookSecret(expectedSecret, providedSecret);
      if (!isAuthorized) {
        console.warn(`[${new Date().toISOString()}] Unauthorized webhook request from ${clientIp}`);
        return new Response(
          JSON.stringify({ error: 'Unauthorized' }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      const rawBody = await request.text();
      const bodyHash = await sha256Hex(rawBody);
      const replayKey = request.headers.get('X-Webhook-Id') || bodyHash;

      const replayCheck = await callSecurityGate(env, '/replay-check', {
        replayKey,
        now,
        ttlMs: REPLAY_TTL_MS,
      });
      if (replayCheck.duplicate) {
        console.warn(`[${new Date().toISOString()}] Duplicate webhook ignored: ${replayKey}`);
        return new Response(
          JSON.stringify({ success: true, duplicate: true }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Parse the incoming webhook JSON body
      const webhookData = JSON.parse(rawBody);

      console.log(`[${new Date().toISOString()}] Received webhook:`, JSON.stringify(webhookData, null, 2));

      // Concept2 webhook format (actual implementation, not docs):
      // { "type": "result-added", "result": { "id": 123, ... } }
      // NOT: { "data": { "type": "result-added", ... } }

      const eventType = webhookData.type;

      console.log(`[${new Date().toISOString()}] Event type: ${eventType}`);

      let resultId = null;

      // Handle different event types
      if (eventType === 'result-added' || eventType === 'result-updated') {
        // For added/updated events, result is in webhookData.result
        if (!webhookData.result || !webhookData.result.id) {
          console.error(`[${new Date().toISOString()}] Missing result.id in ${eventType} event`);
          return new Response(
            JSON.stringify({ error: `Missing result.id in ${eventType} event` }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        resultId = webhookData.result.id;
        console.log(`[${new Date().toISOString()}] Processing ${eventType} for result_id: ${resultId}`);

      } else if (eventType === 'result-deleted') {
        // For deleted events, result_id is directly in webhookData
        if (!webhookData.result_id) {
          console.error(`[${new Date().toISOString()}] Missing result_id in ${eventType} event`);
          return new Response(
            JSON.stringify({ error: `Missing result_id in ${eventType} event` }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
        resultId = webhookData.result_id;
        console.log(`[${new Date().toISOString()}] Processing ${eventType} for result_id: ${resultId}`);
        // Note: We still trigger the workflow for deletion events
        // The workflow can decide how to handle it (e.g., delete the file)

      } else {
        console.error(`[${new Date().toISOString()}] Unknown event type: ${eventType}`);
        return new Response(
          JSON.stringify({ error: `Unknown event type: ${eventType}` }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Check for GitHub PAT
      const githubPat = env.GITHUB_PAT;
      if (!githubPat) {
        console.error(`[${new Date().toISOString()}] GITHUB_PAT environment variable not set`);
        return new Response(
          JSON.stringify({ error: 'Server configuration error: GITHUB_PAT not set' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      // Trigger GitHub Repository Dispatch event
      console.log(`[${new Date().toISOString()}] Triggering GitHub workflow for result_id: ${resultId}, event_type: ${eventType}`);

      const githubResponse = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubPat}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'Concept2-Webhook-Handler/1.0'
        },
        body: JSON.stringify({
          event_type: 'c2_new_activity',
          client_payload: {
            result_id: resultId,
            event_type: eventType
          }
        })
      });

      if (!githubResponse.ok) {
        const errorText = await githubResponse.text();
        console.error(`[${new Date().toISOString()}] GitHub API error: ${githubResponse.status} - ${errorText}`);
        return new Response(
          JSON.stringify({
            error: 'Failed to trigger GitHub workflow',
            details: `GitHub API returned ${githubResponse.status}`
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      console.log(`[${new Date().toISOString()}] Successfully triggered GitHub workflow for result_id: ${resultId}`);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Webhook processed successfully',
          result_id: resultId,
          event_type: eventType
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );

    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error processing webhook: ${error.message}`);
      console.error(`[${new Date().toISOString()}] Stack trace:`, error.stack);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          message: error.message
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
};
