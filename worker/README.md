# Concept2 webhook receiver

Concept2 documents an endpoint URL and JSON `data` envelope for its webhooks, but does not document delivery signatures or configurable request headers. This Worker authenticates the endpoint with a secret URL path. Configure the webhook in the Concept2 developer portal as:

```text
https://<your-worker-host>/webhook/<WEBHOOK_SECRET>
```

Generate `WEBHOOK_SECRET` as at least 32 cryptographically random bytes encoded with base64url (43 characters); the Worker accepts 43–128 base64url characters. Keep it out of source control, logs, screenshots, and issue reports. Set it and the GitHub token as Cloudflare Worker secrets using `wrangler secret put WEBHOOK_SECRET` and `wrangler secret put GITHUB_PAT`. Use the same secret in the Concept2 URL above. For the fixed GitHub repository in `src/webhook.js`, a fine-grained `GITHUB_PAT` needs repository **Contents: write**; a classic PAT needs the `repo` scope. `C2_ACCESS_TOKEN` belongs in GitHub Actions Secrets for the Concept2 download steps, not in the Worker. A missing or malformed secret, missing GitHub token, or missing rate limiting binding causes webhook POST requests to fail closed with 503. Rotate a leaked secret by changing the Worker secret and the Concept2 endpoint URL together.

The Logbook account must authorize the **same Concept2 OAuth client** whose developer portal entry holds this URL. Confirm it under **Edit Profile → Applications → Clients**; use that client's OAuth Link if authorization is missing. A valid personal API token used by GitHub Actions does not authorize the webhook client. Concept2 sends events only for users who have authorized that client. The Worker accepts the official `data` envelope: added/updated events carry `data.result.id`; deleted events carry `data.result_id`.

`wrangler.toml` declares two [Cloudflare Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) bindings. One limits authenticated, valid requests to approximately ten per 60 seconds. The other limits each canonical event payload digest to approximately one per 60 seconds. These counters are local to each Cloudflare location and eventually consistent. Requests can exceed the thresholds; this is not global, strict, or permanent deduplication. Concept2 does not document a signed delivery ID or timestamp.

A request blocked by the event limiter gets HTTP 503 with `Retry-After: 60`, because the Worker cannot know whether an earlier GitHub dispatch succeeded. A failed dispatch also gets HTTP 503 with `Retry-After: 60` and can be retried after the limiter window. This may produce extra retry attempts. No Durable Object migration or new Cloudflare storage resource is required.

The Worker sends the canonical SHA-256 `event_digest` in the GitHub repository dispatch. The backup workflow serializes runs for the branch and checks GitHub Actions artifacts for a completed, unexpired `c2-webhook-<digest>` marker before doing any backup or deployment work. It uploads that marker only after the backup and Pages deployment jobs succeed. The marker has one-day retention, covering repeated attempts during that window; after expiry the same payload can run again. Existing download and statistics logic must remain idempotent as a fallback. Manual and scheduled runs do not consult this marker. An artifact lookup failure fails the preflight job, so it cannot silently treat an unknown delivery as new.

To diagnose a real delivery, compare a fresh Concept2 add/update event with a Worker POST and then a GitHub Actions `repository_dispatch` run. A direct GitHub dispatch tests only GitHub and the workflow. A scheduled reconciliation may fill a missing activity without proving Webhook delivery. `wrangler tail` can include the full secret-bearing request URL: never share its raw output; use only the time, HTTP status, `X-Request-Id`, and generic error phrase. A POST 401 points to path/secret mismatch; 400 to an invalid body; 503 `Dispatch unavailable` to Worker-to-GitHub delivery. If no POST reaches the Worker, check the client URL and authorization first.

Before any future deployment, configure the secrets and Concept2 endpoint URL, and review the rate limiter namespace IDs for uniqueness in the Cloudflare account.

Run `npm ci` and `npm test` inside `worker/` for isolated regression tests. The suite mocks GitHub; it never uses a real token or dispatches a workflow.

Reference: [Concept2 webhook documentation](https://log.concept2.com/developers/documentation/).
