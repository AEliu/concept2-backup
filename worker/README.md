# Concept2 webhook receiver

Concept2 documents an endpoint URL and JSON `data` envelope for its webhooks, but does not document delivery signatures or configurable request headers. This Worker authenticates the endpoint with a secret URL path. Configure the webhook in the Concept2 developer portal as:

```text
https://<your-worker-host>/webhook/<WEBHOOK_SECRET>
```

Generate `WEBHOOK_SECRET` as at least 32 cryptographically random bytes encoded with base64url (43 characters). Keep it out of source control, logs, screenshots, and issue reports. Set it and the GitHub token as Cloudflare Worker secrets using `wrangler secret put WEBHOOK_SECRET` and `wrangler secret put GITHUB_PAT`. The GitHub token needs only permission to create repository dispatch events for this repository. A missing or malformed secret, missing GitHub token, or missing Durable Object binding causes all webhook POST requests to fail closed with 503. Rotate a leaked secret by changing the Worker secret and the Concept2 endpoint URL together.

The `WEBHOOK_GATE` binding and SQLite Durable Object migration are in `wrangler.toml`. Worker Previews have a separate binding with isolated storage; configure test secrets in the Previews Base before functional preview testing. The gate admits at most ten valid deliveries per rolling 60 seconds across Worker instances, including duplicates, and suppresses a repeated canonical event payload for ten minutes. An in-flight duplicate gets 503 with `Retry-After`; a completed duplicate gets 200 without another dispatch. A failed GitHub dispatch releases its reservation for retry. Concept2 does not provide a signed delivery ID or timestamp in the documented payload, so this is bounded replay suppression, not permanent proof of origin. Do not deploy until the secret, endpoint URL, Durable Object migration, and token are reviewed and configured.

Run `npm ci` and `npm test` inside `worker/` for unit and local Worker integration tests. The integration suite mocks GitHub; it never uses a real token or dispatches a workflow.

References: [Concept2 webhook documentation](https://log.concept2.com/developers/documentation/), [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/), [Cloudflare Preview binding isolation](https://developers.cloudflare.com/workers/previews/resources/#durable-objects).
