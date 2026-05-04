# Doc Grounding Report — Sprint 3

_Generated: 2026-05-04 | Author: qa-engineer-persona_
_Scope: README.md, INSTALL.md, DEMO.md, ARCHITECTURE.md, CHANGELOG.md_

---

## Summary

| Document | References checked | Exists | Doesn't exist | Fixed in-sprint |
|---|---|---|---|---|
| README.md | 9 | 9 | 0 | — |
| INSTALL.md | 9 | 9 | 0 | 1 |
| DEMO.md | 9 | 9 | 0 | 1 |
| ARCHITECTURE.md | 18 | 18 | 0 | — |
| CHANGELOG.md | 28 | 28 | 0 | 1 |
| **Total** | **73** | **73** | **0** | **1** |

**One grounding defect identified and fixed in-sprint:**
`OAUTH_REDIRECT_URI` (documented in `.env.example`, `INSTALL.md`, `DEMO.md`) was read as
`ATLASSIAN_REDIRECT_URI` in `src/oauth/authorize.ts` and `src/oauth/tokenExchange.ts`.
Fixed by renaming the `process.env` key to `OAUTH_REDIRECT_URI` in both files.

---

## README.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `JiraHttpClient` | Class name | Yes | `src/http/JiraHttpClient.ts` |
| `/rest/api/3/myself` | API path | Yes | `src/probes/permissionProbes.ts:13` |
| `/rest/api/3/field` | API path | Yes | `src/probes/permissionProbes.ts:14` |
| `/rest/agile/1.0/board` | API path | Yes | `src/probes/permissionProbes.ts:15` |
| `/rest/api/3/workflow/search` | API path | Yes | `src/probes/permissionProbes.ts:16` |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts:8`, mounted in `server.ts` |
| `GET /api/connections` | Route | Yes | `src/routes/connections.ts:91` |
| `WorkloadCard` | Component | Yes | `src/ui/components/WorkloadCard.tsx` |
| `ConnectionsList` | Component | Yes | `src/ui/pages/ConnectionsList.tsx` |

---

## INSTALL.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `.env.example` | File | Yes | project root |
| `src/db/database.ts` | File | Yes | exports `getDb` |
| `npm run server` | Script | Yes | `package.json` → `tsx src/server.ts` |
| `npm run dev` | Script | Yes | `package.json` → `vite` |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts:63` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` (not read from `process.env` in source; stored in DB via manual-connection path) |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`; **fixed** — code now reads `OAUTH_REDIRECT_URI` (was `ATLASSIAN_REDIRECT_URI`) |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts:11` |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts:8` + mount `app.use('/api/oauth', ...)` in `server.ts` |

---

## DEMO.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`; **fixed** — code now reads `OAUTH_REDIRECT_URI` |
| `https://auth.atlassian.com/authorize` | URL | Yes | `src/oauth/authorize.ts:20` constant |
| `https://api.atlassian.com/oauth/token/accessible-resources` | URL | Yes | `src/oauth/tokenExchange.ts:6` constant |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts:8` |
| `http://localhost:3000/api/connections/${CONNECTION_ID}/probes` | Route | Yes | `src/routes/connections.ts:112` |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts:11` |
| Smoke probe — no `jq` dependency | Script | Yes | `grep -c jq` in bash code block = **0**; single occurrence in full file is prose negation ("does **not** require `jq`") |

---

## ARCHITECTURE.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/platform_workload_iface.ts` | File | Yes | project root `src/` |
| `src/types/connection.ts` | File | Yes | project `src/types/` |
| `PlatformWorkloadInterface` | Interface | Yes | `src/platform_workload_iface.ts:79` |
| `Connection` | Type | Yes | `src/types/connection.ts:16` |
| `CredentialRecord` | Type | Yes | `src/types/connection.ts:5` |
| `DiscoverResult` | Type | Yes | `src/platform_workload_iface.ts:16` |
| `SnapshotResult` | Type | Yes | `src/platform_workload_iface.ts:28` |
| `RestoreResult` | Type | Yes | `src/platform_workload_iface.ts:38` |
| `RefreshAuthResult` | Type | Yes | `src/platform_workload_iface.ts:49` |
| `phaseDiagnostic` | Field | Yes | `src/platform_workload_iface.ts:46` |
| `discover` | Method | Yes | `src/platform_workload_iface.ts:84` |
| `snapshot` | Method | Yes | `src/platform_workload_iface.ts:91` |
| `restore` | Method | Yes | `src/platform_workload_iface.ts:100` |
| `refresh_auth` | Method | Yes | `src/platform_workload_iface.ts:108` |
| `cloudId` | Field | Yes | `src/types/connection.ts:19` |
| `siteName` | Field | Yes | `src/types/connection.ts:21` |
| `scopes` | Field | Yes | `src/types/connection.ts:24` |
| `expiresAt` | Field | Yes | `src/types/connection.ts:9` |

---

## CHANGELOG.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/oauth/authorize.ts` | File | Yes | |
| `src/oauth/tokenExchange.ts` | File | Yes | |
| `buildAuthorizeUrl` | Function | Yes | `src/oauth/authorize.ts:42` |
| `handleAuthorize` | Function | Yes | `src/oauth/authorize.ts:62` |
| `handleCallback` | Function | Yes | `src/oauth/tokenExchange.ts:72` |
| `oauth_state` | DB table | Yes | `src/db/migrations/003_oauth_state.sql` |
| `src/http/JiraHttpClient.ts` | File | Yes | |
| `JiraHttpClient.forConnection` | Method | Yes | `src/http/JiraHttpClient.ts:33` |
| `FetchFn` | Type | Yes | `src/http/JiraHttpClient.ts:18` |
| `_createForTesting` | Method | Yes | `src/http/JiraHttpClient.ts:44` |
| `_clearInstances` | Method | Yes | `src/http/JiraHttpClient.ts:51` |
| `credentials` | DB table | Yes | `src/db/migrations/004_client_creds.sql` |
| `src/probes/permissionProbes.ts` | File | Yes | |
| `runPermissionProbes(connectionId)` | Function | Yes | `src/probes/permissionProbes.ts:21` |
| `probe_results` | DB table | Yes | `src/db/migrations/006_probe_results.sql` |
| `ProbeResult[]` | Type | Yes | `src/probes/permissionProbes.ts:4` |
| `remediationNeeded` | Field | Yes | `src/probes/permissionProbes.ts:8` |
| `getProbeResults(connectionId)` | Function | Yes | `src/probes/permissionProbes.ts:87` |
| `src/routes/connections.ts` | File | Yes | |
| `src/routes/oauth.ts` | File | Yes | |
| `src/server.ts` | File | Yes | |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts:8` |
| `GET /api/connections` | Route | Yes | `src/routes/connections.ts:91` |
| `GET /api/connections/:id/probes` | Route | Yes | `src/routes/connections.ts:112` |
| `GET /api/oauth/authorize` | Route | Yes | `src/routes/oauth.ts:7` |
| `GET /api/oauth/callback` | Route | Yes | `src/routes/oauth.ts:8` |
| `src/db/migrations/002_connections.sql` | File | Yes | |
| `src/db/migrations/003_oauth_state.sql` | File | Yes | |
| `src/db/migrations/004_client_creds.sql` | File | Yes | |
| `src/db/migrations/005_oauth_state_connectionid.sql` | File | Yes | |
| `src/db/migrations/006_probe_results.sql` | File | Yes | |
| `connections` | DB table | Yes | `src/db/migrations/002_connections.sql` |
| `src/ui/components/WorkloadCard.tsx` | File | Yes | |
| `src/ui/pages/ConnectionsList.tsx` | File | Yes | |
| `.env.example` | File | Yes | |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`; **fixed** |
| `PORT` | Env var | Yes | `.env.example` |

---

## Smoke Probe Execution Record

**Script:** `DEMO.md` — "Smoke probes (machine-readable)" bash block

**Exit code:** `0`

**Execution transcript:**
```
==> [1/3] Create smoke connection
PASS: POST /api/connections returned status field
PASS: connection status is connected
==> [2/3] Verify connection appears in GET /api/connections
PASS: connection found in list
==> [3/3] Verify GET /api/connections returns valid JSON
PASS: valid JSON response

All smoke checks passed.
```

**jq audit:** `grep -c jq DEMO.md` = 1 (prose negation only); bash code block = **0 jq occurrences**

---

## [permission-probe] Log Evidence

Permission probes run against smoke connection `369a1321-affd-4212-bed0-4c30715cc4d9`
(cloudId `smoke-cloud-1777925861`, fake tokens). Atlassian returned HTTP 404 for the
unknown cloudId; no 401 was returned so **`[auth-refresh]` was not triggered on first auth**.

```
[permission-probe] endpoint=/rest/api/3/field status=404 duration_ms=160
[permission-probe] endpoint=/rest/api/3/myself status=404 duration_ms=186
[permission-probe] endpoint=/rest/api/3/workflow/search status=404 duration_ms=180
[permission-probe] endpoint=/rest/agile/1.0/board status=404 duration_ms=182
```

All 4 `[permission-probe]` lines emitted. `[auth-refresh]` lines: **0** (not triggered — no HTTP 401 on first auth).

---

## In-Sprint Fixes

| Doc | Section | Reference | Problem | Fix applied |
|---|---|---|---|---|
| INSTALL.md, DEMO.md, .env.example | Env vars | `OAUTH_REDIRECT_URI` | Code read `ATLASSIAN_REDIRECT_URI` — env var never populated | Renamed to `OAUTH_REDIRECT_URI` in `src/oauth/authorize.ts:71` and `src/oauth/tokenExchange.ts:110` |

---

_0 unresolved "doesn't exist" entries after in-sprint fix._
