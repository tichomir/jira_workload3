# OAuth Token Exchange Failure — Diagnosis

**Sprint:** Maintenance — Fix OAuth token exchange  
**Symptom:** `{"error":"token_exchange_failed"}` returned to the browser after completing the Atlassian OAuth consent screen.  
**Diagnosed by:** Software Architect  
**Date:** 2026-05-05

---

## Executive Summary

The POST to `https://auth.atlassian.com/oauth/token` succeeds in sending the request but Atlassian rejects it because the request body **omits `client_secret`**. Atlassian's OAuth 2.0 token endpoint treats this app as a *confidential client* (it has a registered client secret), so the secret is required even when PKCE is used. `ATLASSIAN_CLIENT_SECRET` is present in `.env` but is **never read** anywhere in the OAuth code path.

---

## Candidate Failure Modes — Verdict

| # | Failure Mode | Verdict | Evidence |
|---|---|---|---|
| 1 | `client_secret` missing from token request body | **FAIL — ROOT CAUSE** | `src/oauth/tokenExchange.ts:41-51` — body never includes `client_secret`; `ATLASSIAN_CLIENT_SECRET` env var is never read in any OAuth file |
| 2 | `redirect_uri` mismatch between `/authorize` and `/token` | **PASS** | Both `handleAuthorize` (`authorize.ts:71`) and `handleCallback` (`tokenExchange.ts:109`) use the same `process.env['OAUTH_REDIRECT_URI']` value first; `.env` line 8 sets it to `https://localhost:8443/api/oauth/callback` consistently |
| 3 | `client_id` / `client_secret` loading from env | `client_id` **PASS**, `client_secret` **FAIL** | `handleAuthorize` reads `ATLASSIAN_CLIENT_ID` at `authorize.ts:63`; `exchangeCodeForTokens` signature accepts `clientId` (passed from `stateRow.clientId`) but has no `clientSecret` parameter and never calls `process.env['ATLASSIAN_CLIENT_SECRET']` |
| 4 | `grant_type=authorization_code` body shape | **PARTIAL FAIL** | `grant_type: 'authorization_code'` is present (`tokenExchange.ts:45`) but body is structurally incomplete — `client_secret` is absent |
| 5 | `code` parameter capture from callback | **PASS** | `req.query.code` captured at `tokenExchange.ts:73`; `codeVerifier` retrieved from `oauth_state` table at `tokenExchange.ts:88-93` |
| 6 | HTTPS callback URL (Atlassian rejects plain HTTP) | **PASS** (with env set) | `.env` line 8 sets `OAUTH_REDIRECT_URI=https://localhost:8443/api/oauth/callback` — HTTPS is used. Without the env var the fallback (`req.protocol`) would return `http` because `server.ts` does not call `app.set('trust proxy', true)`, but this path is not currently triggered |
| 7 | PKCE / state param handling | **PASS** | PKCE S256 generated in `authorize.ts:31-35`; state stored, verified, and consumed (one-time use) in `tokenExchange.ts:87-107` |

---

## Root Cause — Detail

### File: `src/oauth/tokenExchange.ts`, lines 41–51

```typescript
const resp = await _fetchFn(ATLASSIAN_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    // ❌ client_secret is MISSING
  }),
});
```

Atlassian's token endpoint documentation specifies that for **confidential clients** (apps that have a `client_secret` registered in the developer console), the `client_secret` field is **mandatory** in every token exchange request, regardless of whether PKCE is also used. Without it, Atlassian returns an OAuth error response (HTTP 4xx), the `resp.ok` check at line 53 fails, the `catch` block at line 121 fires, and the handler returns `{"error":"token_exchange_failed"}`.

The secret *is* available — `ATLASSIAN_CLIENT_SECRET` is defined in `.env` (line 4) and loaded into the process environment — but the `exchangeCodeForTokens` function:

1. Has no `clientSecret` parameter in its signature (`tokenExchange.ts:35–40`).
2. Never calls `process.env['ATLASSIAN_CLIENT_SECRET']` internally.
3. Is never passed the secret by its caller `handleCallback` (`tokenExchange.ts:115–118`).

---

## Captured HTTP Request/Response (Simulated — no live Atlassian sandbox available)

Because no live Atlassian developer sandbox is available in this environment, the following represents the request that the code *currently constructs* (derived by static analysis of `tokenExchange.ts:41-51`) and the expected Atlassian response based on their published OAuth 2.0 error codes:

**Request sent by `exchangeCodeForTokens`:**

```
POST https://auth.atlassian.com/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "client_id": "1hCMINKiuGDOyWuGkI4BnMQhq8mwPEa9",
  "code": "<authorization_code_from_callback>",
  "redirect_uri": "https://localhost:8443/api/oauth/callback",
  "code_verifier": "<pkce_verifier_from_oauth_state>"
}
```

**Expected Atlassian response (client_secret absent, confidential client):**

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "error": "invalid_client",
  "error_description": "Invalid client credentials"
}
```

**Application response to browser (catch block at `tokenExchange.ts:121-124`):**

```
HTTP/1.1 502 Bad Gateway
Content-Type: application/json

{"error":"token_exchange_failed"}
```

---

## Secondary Finding: Trust-Proxy Not Set

`server.ts` does not call `app.set('trust proxy', true)`. When the app runs behind Caddy (which terminates TLS), `req.protocol` returns `'http'`, not `'https'`. The fallback redirect URI (`${req.protocol}://${req.get('host')}/api/oauth/callback`) would therefore be `http://`, which Atlassian rejects.

This is **not currently triggered** because `.env` sets `OAUTH_REDIRECT_URI` explicitly, but it is a latent bug that would break any deployment where the env var is absent.

**File:** `src/server.ts` — `app.set('trust proxy', true)` is absent between lines 18 and 22.

---

## Fix Tasks

The following subsequent tasks should implement the fix:

### Task 1 — Primary Fix (Backend Developer)
**Add `client_secret` to token exchange request**

In `src/oauth/tokenExchange.ts`:
1. Add `clientSecret: string` parameter to `exchangeCodeForTokens` signature (line 35).
2. Add `client_secret: clientSecret` to the JSON body (line 44–50).
3. In `handleCallback`, read `process.env['ATLASSIAN_CLIENT_SECRET']` and pass it to `exchangeCodeForTokens` (line 115).
4. Return `500` with `{ error: 'ATLASSIAN_CLIENT_SECRET is not configured' }` if the env var is absent (mirrors the `ATLASSIAN_CLIENT_ID` guard at `authorize.ts:64-68`).
5. Update `tokenExchange.test.ts` to pass a `clientSecret` argument in all `exchangeCodeForTokens` call sites and assert the secret appears in the captured fetch body.

### Task 2 — Secondary Fix (Backend Developer)
**Enable trust-proxy so fallback redirect URI is HTTPS-correct**

In `src/server.ts`, add `app.set('trust proxy', true)` after `const app = express()` (line 18). This ensures `req.protocol` returns `'https'` when behind Caddy, making the fallback URI safe even when `OAUTH_REDIRECT_URI` is not set.

---

## Files Implicated

| File | Lines | Issue |
|---|---|---|
| `src/oauth/tokenExchange.ts` | 35–51, 115–118 | `client_secret` never added to body; `handleCallback` never reads the env var |
| `src/server.ts` | 18 | `app.set('trust proxy', true)` missing |
| `.env` | 4 | `ATLASSIAN_CLIENT_SECRET` defined but unused |
