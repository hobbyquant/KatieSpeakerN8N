# Add Header-Based API Key Authentication (Backward-Compatible)

**Audience:** Katie Speaker backend team
**Author of request:** n8n community node maintainer (`n8n-nodes-katiespeaker`)
**Status:** Proposal — non-breaking change

---

## Why this change

The Katie Speaker API currently authenticates the `channel_apikey` in two different places depending on the HTTP method:

| Method | Where the key is read from |
| --- | --- |
| `GET /v1/messaging/subscriber-filters` | Query string (`?channel_apikey=...`) |
| `POST /v1/messaging/publish` | JSON request body (`{"channel_apikey": "..."}`) |

This split caused two concrete problems during the n8n verification review of the community node:

1. **n8n reviewers flagged it as a [MEDIUM] issue.** n8n's credential framework injects authentication via a single mechanism per credential. The current API forces the node to either inject auth in two places (current workaround) or maintain method-specific code (which n8n actively discourages — they want the credential's `authenticate` block to be the single source of truth).
2. **It's an integration footgun for everyone.** Anyone hitting the API from curl, Postman, Zapier, custom scripts, etc. has to remember which method goes where. There is no consistent pattern.

A secondary concern: `?channel_apikey=...` in the URL leaks the credential into nginx access logs, browser history, HTTP `Referer` headers when redirecting cross-origin, and any intermediary cache or proxy logs. This is a known anti-pattern for API key auth — see [OWASP API Security Top 10 (2023): API2 — Broken Authentication](https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/) and [RFC 6750 §2.3](https://datatracker.ietf.org/doc/html/rfc6750#section-2.3) (which deprecates URI query parameters for bearer tokens specifically because of this leakage).

## Goals

1. Add header-based auth as the new canonical method.
2. Keep every existing auth method working unchanged — **zero breakage** for live integrations.
3. Establish a clear deprecation path for the query-string method (do not remove it yet).

## Non-goals

- Removing the body or query-string methods. Both stay supported indefinitely (or at least until a planned major-version cutover communicated well in advance).
- Changing the value or format of the API key itself.
- Changing any response shapes, status codes, or error bodies for existing call patterns.
- Rotating or invalidating any existing keys.

---

## Required changes

### 1. Accept the API key in two new header forms

The auth middleware should read the `channel_apikey` from any of these locations, in this priority order:

| Priority | Source | Format |
| --- | --- | --- |
| 1 | `Authorization` header | `Authorization: Bearer <key>` |
| 2 | `X-API-Key` header | `X-API-Key: <key>` |
| 3 | Query string | `?channel_apikey=<key>` (existing) |
| 4 | Request body | `{"channel_apikey": "<key>"}` (existing, POST/PUT only) |

**Priority rule:** if the key appears in more than one location, **the highest-priority source wins** and the others are ignored (do not error). This is consistent with how most API gateways handle multi-source credentials and avoids breaking clients that send the key in two places "to be safe" (the n8n node currently does this).

**Header parsing rules:**

- HTTP header names are case-insensitive. Match `x-api-key`, `X-Api-Key`, `X-API-KEY`, etc. equivalently.
- The `Authorization` scheme prefix (`Bearer`) is also case-insensitive per [RFC 7235 §2.1](https://datatracker.ietf.org/doc/html/rfc7235#section-2.1). Match `Bearer`, `bearer`, `BEARER`.
- Exactly one space between scheme and token. Trim leading/trailing whitespace from the token.
- If the `Authorization` header is present but the scheme is not `Bearer` (e.g. `Basic`, `Digest`), **fall through** to the next source rather than rejecting — the client may be doing something else with `Authorization` (this should be rare on this API, but defensive parsing avoids breaking unexpected use).

### 2. Apply uniformly across all routes and methods

Currently the body-vs-qs split appears tied to the route. After this change, **every authenticated route should accept all four sources for any HTTP method**, including:

- `GET /v1/messaging/subscriber-filters`
- `POST /v1/messaging/publish`
- Any other authenticated routes (current and future)

This is the entire point: callers should never have to think about *where* the key goes based on the route or method.

### 3. Apply this in middleware, not per-route

Centralize the resolution logic in the existing auth middleware (or wherever `channel_apikey` is currently extracted). Per-route auth handling is what created the inconsistency in the first place — fixing it per-route would just create new inconsistencies later.

Pseudocode:

```python
def resolve_channel_apikey(request) -> str | None:
    # 1. Authorization: Bearer <key>
    auth = request.headers.get("Authorization", "").strip()
    if auth:
        parts = auth.split(maxsplit=1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1].strip()
            if token:
                return token

    # 2. X-API-Key header
    header_key = request.headers.get("X-API-Key", "").strip()
    if header_key:
        return header_key

    # 3. ?channel_apikey=... query string
    qs_key = request.query_params.get("channel_apikey", "").strip()
    if qs_key:
        return qs_key

    # 4. {"channel_apikey": "..."} JSON body — only for methods that have a body
    if request.method in ("POST", "PUT", "PATCH"):
        body = request.get_json(silent=True) or {}
        body_key = (body.get("channel_apikey") or "").strip()
        if body_key:
            return body_key

    return None
```

Adapt to your framework (FastAPI / Flask / Express / etc.) — the logic is what matters.

### 4. Do not change error responses for existing patterns

Whatever the API currently returns when the key is missing, invalid, or for an unknown channel must stay byte-identical for callers that are already using qs or body auth. Specifically:

- Same status codes (401 / 403 / 404 / 422 — whatever you currently return)
- Same JSON error envelope (`{"error": "...", "detail": "...", "request_id": "..."}` based on what we observed)
- Same `validation_errors` array shape

This guarantees zero behavior change for existing integrations.

### 5. Do not log the key value

Standard hygiene reminder: when adding the new sources, ensure the key value never lands in logs:

- Don't log the full `Authorization` header (redact the token portion).
- Don't log the `X-API-Key` header value.
- The query-string version may already be in nginx access logs — this change doesn't make that worse, but it's worth noting in the deprecation plan (below).

### 6. (Optional, recommended) Emit telemetry on auth method used

Per request, record (in metrics / structured logs, NOT the key value) which source was used:

- `auth.source = "header_bearer" | "header_x_api_key" | "query_string" | "body"`

This gives you data to drive the deprecation timeline. After header support has been live for a few months, you'll be able to see what fraction of traffic still uses qs/body and target outreach accordingly.

---

## Backward compatibility checklist

This change must be **purely additive**. Before rolling out, confirm:

- [ ] Existing GET requests with `?channel_apikey=...` succeed unchanged (same 200 response, same body).
- [ ] Existing POST requests with `{"channel_apikey": "..."}` in body succeed unchanged.
- [ ] Existing requests with **both** qs and body (which the current n8n node sends) still succeed unchanged.
- [ ] An invalid or missing key produces the same error response as today.
- [ ] No existing field, header, or response shape was renamed, removed, or restructured.
- [ ] No existing rate limits, channel scoping, or permission checks changed behavior.
- [ ] Status codes for all existing patterns are byte-identical.

If any of those checkboxes can't be ticked, the change isn't backward compatible and needs revision.

---

## Test cases to add

Add these to your API test suite. Each should be tested against at least one GET route and one POST route (so the behavior is verified to be uniform).

### New: header-based auth

| # | Request | Expected |
| --- | --- | --- |
| H1 | `Authorization: Bearer <valid_key>` | 200 |
| H2 | `Authorization: bearer <valid_key>` (lowercase scheme) | 200 |
| H3 | `Authorization: Bearer <invalid_key>` | Same 4xx as today's invalid-key response |
| H4 | `X-API-Key: <valid_key>` | 200 |
| H5 | `x-api-key: <valid_key>` (lowercase header name) | 200 |
| H6 | `X-API-Key: <invalid_key>` | Same 4xx as today |
| H7 | `Authorization: Basic <something>` (wrong scheme) and no other auth | Same 4xx as missing-key today (does NOT error on the unrecognized scheme) |
| H8 | `Authorization: Bearer ` (empty token after scheme) | Same 4xx as missing-key today |

### Backward compatibility (must still pass — these are the existing behaviors)

| # | Request | Expected |
| --- | --- | --- |
| B1 | GET with `?channel_apikey=<valid>` | 200 (unchanged) |
| B2 | POST with `{"channel_apikey": "<valid>", ...}` | 200 (unchanged) |
| B3 | POST with `?channel_apikey=<valid>` AND `{"channel_apikey": "<valid>", ...}` | 200 (unchanged — current n8n node sends this) |
| B4 | GET with no key anywhere | Same 4xx as today |
| B5 | POST with no key anywhere | Same 4xx as today |

### Multi-source priority

| # | Request | Expected |
| --- | --- | --- |
| P1 | `Authorization: Bearer <valid>` AND `?channel_apikey=<INVALID>` | 200 (header wins) |
| P2 | `X-API-Key: <valid>` AND `{"channel_apikey": "<INVALID>"}` in body | 200 (header wins) |
| P3 | `Authorization: Bearer <INVALID>` AND `X-API-Key: <valid>` | 4xx (Authorization is higher priority and its token is invalid — should fail rather than silently fall through, otherwise a typo in `Authorization` would be invisibly papered over by `X-API-Key`) |

Note on P3: this is a judgment call. The alternative — fall through and use `X-API-Key` — is also defensible. Pick one and document it. The pseudocode above would silently fall through (return the first non-empty source). Either is fine; just be consistent and write it down.

### Cross-method uniformity

| # | Request | Expected |
| --- | --- | --- |
| U1 | `GET /v1/messaging/subscriber-filters` with `Authorization: Bearer <valid>` | 200 |
| U2 | `POST /v1/messaging/publish` with `Authorization: Bearer <valid>` (no body key, no qs key) | 200 |
| U3 | `GET /v1/messaging/subscriber-filters` with `X-API-Key: <valid>` | 200 |
| U4 | `POST /v1/messaging/publish` with `X-API-Key: <valid>` | 200 |

U2 and U4 are the most important — they confirm the previous body-only requirement on POSTs is gone.

---

## Documentation updates

When the change ships, update the public API docs:

1. **Promote the header method as the recommended way.** Lead the auth section with `Authorization: Bearer <key>`. Show qs and body as "also supported."
2. **Mark qs as deprecated.** Add a callout: "Query-string authentication is supported for backward compatibility but is no longer recommended. Use the `Authorization` header instead." Do NOT yet announce a removal date.
3. **Update code samples.** All the curl / Python / JS examples should use the header.
4. **Update the n8n quickstart at `https://katiespeaker.com/developers/quickstart`** so new integrators see the header method first.

Sample updated curl:

```bash
# Recommended
curl -X POST https://api.katiespeaker.com/v1/messaging/publish \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'

# Also supported (legacy)
curl -X POST "https://api.katiespeaker.com/v1/messaging/publish?channel_apikey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello"}'
```

---

## Deprecation plan (future, separate work)

Don't do this as part of this change. This is the path *after* header support has been live for a while.

1. **T+0 (this change):** Header support ships. qs and body still work, undocumented as deprecated yet.
2. **T+1 month:** API docs update qs → "deprecated, supported indefinitely" callout. Add `Deprecation: true` and `Sunset: <future-date>` HTTP response headers ([RFC 8594](https://datatracker.ietf.org/doc/html/rfc8594)) on responses to qs-auth requests so integrations using e.g. axios interceptors or sentry can surface the warning.
3. **T+3 months:** Use the telemetry from §6 above to identify top users of qs auth and reach out individually.
4. **T+12 months minimum:** Reassess. Only consider removal if telemetry shows qs auth at <1% of traffic AND every known integration has been notified. Even then, removal is a breaking change and warrants a major version bump on the API (e.g. `/v2/`) rather than removing from `/v1/`.

The body-auth method is fine to leave indefinitely — it's not a security issue, just a consistency one. The header method just becomes the "first-class" path.

---

## Effort estimate

For a typical Python/FastAPI or Express/Node backend with existing auth middleware:

- Implementation: ~1–2 hours (it's a small middleware change)
- Tests: ~2–4 hours (the matrix above is ~20 cases)
- Docs: ~1–2 hours
- Code review + deploy: standard

Total: half a day to a day for a single engineer.

---

## Coordination with the n8n node

Once header auth is live in production, the n8n community node (`n8n-nodes-katiespeaker`) will be updated in a follow-up release to use the header method:

```ts
// Future v0.5.0 of the n8n node — drops the dual-injection workaround
authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
        header: {
            'X-API-Key': '={{$credentials.channelApiKey}}',
        },
    },
};
```

This will be the textbook n8n credential pattern (matches the docs example exactly) and removes the workaround currently in `credentials/KatieSpeakerApi.credentials.ts`. **No coordination needed for the cut-over** — the n8n node release can ship any time after the backend supports headers, since the existing qs+body injection will keep working until then.

---

## Questions / decisions needed from the backend team

1. Confirm `X-API-Key` is acceptable as a header name (vs an alternative like `X-Katie-Speaker-Api-Key` for clarity). `X-API-Key` is the most common convention.
2. Confirm both `Authorization: Bearer` AND `X-API-Key` are wanted, or pick one. (Recommendation: support both — they're trivial to add together and let integrators use whichever their tooling prefers.)
3. Decide P3 priority semantics (silently fall through vs hard-fail). Document whichever is chosen.
4. Confirm there are no other authenticated routes besides `/v1/messaging/publish` and `/v1/messaging/subscriber-filters` that need the same treatment. If there are, they're all in scope.
