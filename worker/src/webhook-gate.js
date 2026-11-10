import { DurableObject } from 'cloudflare:workers';

const REPO_OWNER = 'AEliu';
const REPO_NAME = 'concept2-backup';
const GITHUB_API_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const PENDING_MS = 120_000;
const REPLAY_WINDOW_MS = 10 * 60_000;

export class WebhookGate extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at_ms INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS deliveries (
      digest TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL
    )`);
  }

  async dispatch(eventType, resultId, digest) {
    if (!['result-added', 'result-updated', 'result-deleted'].includes(eventType) ||
        !Number.isSafeInteger(resultId) || resultId <= 0 ||
        typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      return 'invalid';
    }

    const now = Date.now();
    const admission = this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM attempts WHERE at_ms <= ?', now - RATE_WINDOW_MS);
      this.sql.exec('DELETE FROM deliveries WHERE expires_at_ms <= ?', now);

      const count = this.sql.exec('SELECT COUNT(*) AS count FROM attempts').one().count;
      if (count >= RATE_LIMIT) return 'rate_limited';
      this.sql.exec('INSERT INTO attempts(at_ms) VALUES (?)', now);

      const previous = this.sql.exec('SELECT status FROM deliveries WHERE digest = ?', digest).toArray()[0];
      if (previous) return previous.status === 'delivered' ? 'duplicate' : 'pending';

      this.sql.exec(
        'INSERT INTO deliveries(digest, status, expires_at_ms) VALUES (?, ?, ?)',
        digest, 'pending', now + PENDING_MS
      );
      return 'admitted';
    });
    if (admission !== 'admitted') return admission;

    try {
      const response = await fetch(GITHUB_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.GITHUB_PAT}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'Concept2-Webhook-Handler/2.0'
        },
        body: JSON.stringify({
          event_type: 'c2_new_activity',
          client_payload: { result_id: resultId, event_type: eventType }
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error('GitHub dispatch rejected');
      this.sql.exec(
        'UPDATE deliveries SET status = ?, expires_at_ms = ? WHERE digest = ? AND status = ?',
        'delivered', Date.now() + REPLAY_WINDOW_MS, digest, 'pending'
      );
      return 'accepted';
    } catch {
      this.sql.exec('DELETE FROM deliveries WHERE digest = ? AND status = ?', digest, 'pending');
      return 'failed';
    }
  }
}
