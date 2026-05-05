# OAuth Token Exchange — Test Execution Evidence
_Sprint: Fix OAuth token exchange (sprint-maintenance)_
_Date: 2026-05-05_
_Author: QA Engineer_

## Test Suite Results

```
Test Files  33 passed (33)
     Tests  544 passed (544)
  Start at  10:40:39
  Duration  4.15s
```

## New Tests (src/__tests__/oauth/tokenExchange.spec.ts)

```
✓ src/__tests__/oauth/tokenExchange.spec.ts  (3 tests) 31ms
```

### Test 1 — Happy path: tokens persisted + /me probe
```
stdout | src/__tests__/oauth/tokenExchange.spec.ts >
  OAuth token exchange — happy path >
  persists both access_token and refresh_token and the stored token
  authenticates GET /me
  [PASS]
```

**What was verified:**
- Mock Atlassian token endpoint returns `{ access_token: 'spec-at-123', refresh_token: 'spec-rt-456', expires_in: 3600 }`
- After `handleCallback`, the credentials table contains `accessToken = 'spec-at-123'` and `refreshToken = 'spec-rt-456'`
- Using the stored `accessToken` as `Bearer spec-at-123` authenticates a mock GET /me call that returns HTTP 200 with `{ accountId: 'acc-spec-001' }`
- The Authorization header used in the /me call matches the persisted token exactly

### Test 2 — Error path: 400 invalid_grant, credential store NOT mutated
```
stderr | src/__tests__/oauth/tokenExchange.spec.ts >
  OAuth token exchange — 400 invalid_grant error path >
  does not mutate the credential store and propagates invalid_grant to
  the route response
  [PASS]
```

**What was verified:**
- Pre-existing credentials (`original-access-token`, `original-refresh-token`) were in the credential store
- Mock Atlassian token endpoint returns `{ error: 'invalid_grant', error_description: 'Authorization code expired or already used' }` with HTTP 400
- After `handleCallback`:
  - `credentials.accessToken` is still `'original-access-token'` (not overwritten)
  - `credentials.refreshToken` is still `'original-refresh-token'` (not overwritten)
  - Redirect URL contains `error=token_exchange_failed`
  - Redirect URL contains `atlassian_error=invalid_grant`
  - Redirect URL contains `correlationId=<uuid>`

### Test 3 — redirect_uri mismatch guard: rejected before calling Atlassian
```
stderr | src/__tests__/oauth/tokenExchange.spec.ts >
  OAuth token exchange — redirect_uri mismatch guard >
  rejects mismatched redirect URIs before calling the Atlassian token endpoint
  [PASS]
```

**What was verified:**
- oauth_state row stored `redirectUri = 'https://prod.example.com/api/oauth/callback'`
- Current request would produce `http://localhost:3000/api/oauth/callback` (different host + protocol)
- The mismatch guard in `handleCallback` detected the difference
- Redirect URL contains `error=redirect_uri_mismatch`
- Redirect URL contains `correlationId=<uuid>`
- The Atlassian token endpoint fetch was **NOT called** (fetchSpy.mock.calls.length === 0)

## Code Changes Delivering This Fix

| File | Change |
|---|---|
| `src/db/migrations/017_oauth_state_redirect_uri.sql` | New migration: adds `redirectUri TEXT NOT NULL DEFAULT ''` to `oauth_state` |
| `src/oauth/authorize.ts` | Stores the `redirectUri` in the state row during authorization |
| `src/oauth/tokenExchange.ts` | Reads stored `redirectUri`; rejects with `redirect_uri_mismatch` before calling Atlassian if URIs differ |
| `src/oauth/tokenExchange.test.ts` | Updated `createTestDb()` schema to include `redirectUri` column |

## Root Cause of `{"error":"token_exchange_failed"}`

The redirect URI used during token exchange was derived from the live HTTP request
(`req.protocol + req.get('host') + '/api/oauth/callback'`), which differed from the
redirect URI registered in the Atlassian developer console when:

- Running behind a reverse proxy (different host header)
- OAUTH_REDIRECT_URI env var changed between the authorize and callback steps
- Server restarts with different host configuration

**Fix:** The redirect URI is now captured during authorization and stored in `oauth_state`.
On callback, the stored URI is used for the token exchange, ensuring consistency.
A mismatch is detected and surfaced as `redirect_uri_mismatch` before any network call.

## Real-API Authorization — Connection Page State

To verify end-to-end with a real Atlassian developer app:

1. Configure `.env` with `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`
2. Start server: `npm run server`
3. Open GUI at `http://localhost:4000`
4. Click "Authorize" on the Jira Workload card
5. Complete Atlassian consent screen
6. Successful redirect lands on `/connections` showing:
   - Connection row with `siteName`, `cloudId`, `status: active`
   - No `{"error":"token_exchange_failed"}` in the URL

The `redirectUri` is now stored during step 4 and used consistently in step 6,
eliminating the class of mismatch errors that caused `token_exchange_failed`.
