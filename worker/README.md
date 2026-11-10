# Concept2 webhook receiver

Concept2 documents an endpoint URL and JSON `data` envelope for its webhooks, but does not document delivery signatures or configurable request headers. This Worker authenticates the endpoint with a secret URL path. Configure the webhook in the Concept2 developer portal as:

```text
https://<your-worker-host>/webhook/<WEBHOOK_SECRET>
```

Generate `WEBHOOK_SECRET` as at least 32 cryptographically random bytes encoded with base64url (43 characters). Keep it out of source control, logs, screenshots, and issue reports. Set it and the GitHub token as Cloudflare Worker secrets using `wrangler secret put WEBHOOK_SECRET` and `wrangler secret put GITHUB_PAT`. The GitHub token needs only permission to create repository dispatch events for this repository. A missing or malformed secret, missing GitHub token, or missing rate limiting binding causes webhook POST requests to fail closed with 503. Rotate a leaked secret by changing the Worker secret and the Concept2 endpoint URL together.

`wrangler.toml` declares two [Cloudflare Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) bindings. One limits authenticated, valid requests to approximately ten per 60 seconds. The other limits each canonical event payload digest to approximately one per 60 seconds. These counters are local to each Cloudflare location and eventually consistent. Requests can exceed the thresholds; this is not global, strict, or permanent deduplication. Concept2 does not document a signed delivery ID or timestamp.

A request blocked by the event limiter gets HTTP 503 with `Retry-After: 60`, because the Worker cannot know whether an earlier GitHub dispatch succeeded. A failed dispatch also gets HTTP 503 with `Retry-After: 60` and can be retried after the limiter window. This may produce extra retry attempts; downstream activity processing must remain idempotent. No Durable Object migration or new storage resource is required. Before any future deployment, configure the secrets and Concept2 endpoint URL, and review the rate limiter namespace IDs for uniqueness in the Cloudflare account.

Run `npm ci` and `npm test` inside `worker/` for isolated regression tests. The suite mocks GitHub; it never uses a real token or dispatches a workflow.

Reference: [Concept2 webhook documentation](https://log.concept2.com/developers/documentation/).
