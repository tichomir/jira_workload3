# Doc Grounding Report — Sprint 4

_Generated: 2026-05-04 | Author: qa-engineer-persona_
_Scope: README.md, INSTALL.md, DEMO.md, ARCHITECTURE.md, CHANGELOG.md_
_Sprint focus: Sprint 2 additions — Manual Connection, Inventory, Policies, Restores, Caddyfile, Platform Contracts_

---

## Summary

| Document | References checked | Exists | Doesn't exist | Fixed in-sprint |
|---|---|---|---|---|
| README.md | 13 | 13 | 0 | 1 |
| INSTALL.md | 9 | 9 | 0 | — |
| DEMO.md | 12 | 12 | 0 | — |
| ARCHITECTURE.md | 34 | 34 | 0 | 6 |
| CHANGELOG.md | 37 | 37 | 0 | — |
| **Total** | **105** | **105** | **0** | **7** |

**Seven grounding defects identified and fixed in-sprint:**
1. `ARCHITECTURE.md`: endpoint paths `/api/restore` → `/api/restores` (2 occurrences in Endpoint Map and section headings).
2. `ARCHITECTURE.md`: `POST /api/policies` success status code `200` → `201`.
3. `ARCHITECTURE.md`: `POST /api/restores` success status code `202` → `201`.
4. `ARCHITECTURE.md`: `POST /api/restores` response shape `{ jobId, status: "running", startedAt }` → `{ restoreId, status: "pending" }`.
5. `ARCHITECTURE.md`: `GET /api/restores/:id` response field `jobId` → `restoreId`; added `connectionId`, `backupPointId`, `createdAt` fields.
6. `ARCHITECTURE.md`: error field `job_not_found` → `restore_not_found`; parameter `:jobId` → `:id`.
7. `README.md`: "What is built (Sprint 3)" was stale — Sprint 2 additions (inventory, policies, restores, manual connection, Caddyfile) were not listed. Added "Sprints 2–3" section.

---

## README.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `DEMO.md` | File (link) | Yes | project root |
| `ARCHITECTURE.md` | File (link) | Yes | project root |
| `CHANGELOG.md` | File (link) | Yes | project root |
| `JiraHttpClient` | Class name | Yes | `src/http/JiraHttpClient.ts` |
| `/rest/api/3/myself` | API path | Yes | `src/probes/permissionProbes.ts` |
| `/rest/api/3/field` | API path | Yes | `src/probes/permissionProbes.ts` |
| `/rest/agile/1.0/board` | API path | Yes | `src/probes/permissionProbes.ts` |
| `/rest/api/3/workflow/search` | API path | Yes | `src/probes/permissionProbes.ts` |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts`, mounted in `server.ts` |
| `GET /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `WorkloadCard` | Component | Yes | `src/ui/components/WorkloadCard.tsx` |
| `ConnectionsList` | Component | Yes | `src/ui/pages/ConnectionsList.tsx` |

**In-sprint fix:** Added Sprint 2 additions to "What is built" section — `GET /api/inventory`, `POST /api/policies`, `POST /api/restores`, `GET /api/restores/:id`, `GET /api/restores/:id/events`, `Caddyfile`, manual connection (`clientIdMasked`).

---

## INSTALL.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `.env.example` | File | Yes | project root |
| `src/db/database.ts` | File | Yes | exports `getDb`, `_setDbForTesting`, `_resetDb` |
| `npm run server` | Script | Yes | `package.json` → `tsx src/server.ts` |
| `npm run dev` | Script | Yes | `package.json` → `vite` |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example`, `src/http/JiraHttpClient.ts` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts:10` |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts` + mounted in `server.ts` |

---

## DEMO.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `https://auth.atlassian.com/authorize` | URL | Yes | `src/oauth/authorize.ts` |
| `https://api.atlassian.com/oauth/token/accessible-resources` | URL | Yes | `src/oauth/tokenExchange.ts` |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts` |
| `http://localhost:3000/api/connections/${CONNECTION_ID}/probes` | Route | Yes | `src/routes/connections.ts` (`GET /:id/probes`) |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts:10` |
| `POST /api/connections` (mode=manual) | Route | Yes | `src/routes/connections.ts` — `_handleManual` branch |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts`, mounted at `/api/inventory` in `server.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts`, mounted at `/api/policies` in `server.ts` |

---

## ARCHITECTURE.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/platform_workload_iface.ts` | File | Yes | project root `src/` |
| `src/types/connection.ts` | File | Yes | `src/types/` |
| `src/platform/contracts.ts` | File | Yes | `src/platform/` — new in Sprint 2 |
| `PlatformWorkloadInterface` | Interface | Yes | `src/platform_workload_iface.ts` |
| `Connection` | Type | Yes | `src/types/connection.ts` |
| `CredentialRecord` | Type | Yes | `src/types/connection.ts` |
| `DiscoverResult` | Type | Yes | `src/platform_workload_iface.ts` |
| `SnapshotResult` | Type | Yes | `src/platform_workload_iface.ts` |
| `RestoreResult` | Type | Yes | `src/platform_workload_iface.ts` |
| `RefreshAuthResult` | Type | Yes | `src/platform_workload_iface.ts` |
| `phaseDiagnostic` | Field | Yes | `src/platform_workload_iface.ts` + `src/routes/restores.ts` |
| `discover` | Method | Yes | `src/platform_workload_iface.ts` |
| `snapshot` | Method | Yes | `src/platform_workload_iface.ts` |
| `restore` | Method | Yes | `src/platform_workload_iface.ts` |
| `refresh_auth` | Method | Yes | `src/platform_workload_iface.ts` |
| `cloudId` | Field | Yes | `src/types/connection.ts` |
| `siteName` | Field | Yes | `src/types/connection.ts` |
| `scopes` | Field | Yes | `src/types/connection.ts` |
| `expiresAt` | Field | Yes | `src/types/connection.ts` |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts` mounted at `/api/inventory` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` mounted at `/api/policies`; **fixed** — status was documented as 200, actual is 201 |
| `POST /api/restores` | Route | Yes | `src/routes/restores.ts` mounted at `/api/restores`; **fixed** — was `/api/restore` (singular) |
| `GET /api/restores/:id` | Route | Yes | `src/routes/restores.ts` (`GET /:id`); **fixed** — was `/api/restore/:jobId` |
| `GET /api/restores/:id/events` | Route | Yes | `src/routes/restores.ts` (`GET /:id/events`) — new entry added to Endpoint Map |
| `OAuthConnectionCreateRequest` | Type | Yes | `src/platform/contracts.ts` |
| `ManualConnectionCreateRequest` | Type | Yes | `src/platform/contracts.ts` |
| `ConnectionResponse` | Type | Yes | `src/platform/contracts.ts` |
| `CloudIdMismatchError` | Type | Yes | `src/platform/contracts.ts` |
| `InventoryResponse` | Type | Yes | `src/platform/contracts.ts` |
| `PolicyRequest` | Type | Yes | `src/platform/contracts.ts` |
| `PolicyResponse` | Type | Yes | `src/platform/contracts.ts` |
| `RestoreRequest` | Type | Yes | `src/platform/contracts.ts` |
| `RestoreJobStatus` | Type | Yes | `src/platform/contracts.ts` |

---

## CHANGELOG.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/routes/connections.ts` | File | Yes | |
| `src/routes/inventory.ts` | File | Yes | new in Sprint 2 |
| `src/routes/policies.ts` | File | Yes | new in Sprint 2 |
| `src/routes/restores.ts` | File | Yes | new in Sprint 2 |
| `src/server.ts` | File | Yes | updated in Sprint 2 |
| `007_restores.sql` | File | Yes | `src/db/migrations/007_restores.sql` |
| `008_policies.sql` | File | Yes | `src/db/migrations/008_policies.sql` |
| `Caddyfile` | File | Yes | project root |
| `.env.example` | File | Yes | project root |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `GET /api/inventory?connectionId=<id>` | Route | Yes | `src/routes/inventory.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` |
| `POST /api/restores` | Route | Yes | `src/routes/restores.ts` |
| `GET /api/restores/:id` | Route | Yes | `src/routes/restores.ts` |
| `GET /api/restores/:id/events` | Route | Yes | `src/routes/restores.ts` |
| `manifestId` | Field | Yes | `src/routes/inventory.ts:26`, `src/platform/contracts.ts:96` |
| `completedAt` | Field | Yes | `src/routes/inventory.ts:27`, `src/platform/contracts.ts:97` |
| `counts` | Field | Yes | `src/routes/inventory.ts:28`, `src/platform/contracts.ts:98` |
| `policyId` | Field | Yes | `src/routes/policies.ts:31`, `src/platform/contracts.ts:113` |
| `projectScope` | Field | Yes | `src/routes/policies.ts`, `src/platform/contracts.ts` |
| `selectedProjectKeys` | Field | Yes | `src/routes/policies.ts`, `src/platform/contracts.ts` |
| `retentionDays` | Field | Yes | `src/routes/policies.ts`, `src/platform/contracts.ts` |
| `updatedAt` | Field | Yes | `src/routes/policies.ts:46`, `src/platform/contracts.ts:138` |
| `restoreId` | Field | Yes | `src/routes/restores.ts:34` |
| `status` | Field | Yes | `src/routes/restores.ts:34`, `src/routes/connections.ts` |
| `conflictMode` | Field | Yes | `src/routes/restores.ts:28`, `src/db/migrations/007_restores.sql:6` |
| `destination` | Field | Yes | `src/routes/restores.ts:29`, `src/db/migrations/007_restores.sql:7` |
| `itemIds` | Field | Yes | `src/routes/restores.ts:30`, `src/db/migrations/007_restores.sql:8` |
| `restoredCount` | Field | Yes | `src/routes/restores.ts:52`, `src/db/migrations/007_restores.sql:9` |
| `errorCount` | Field | Yes | `src/routes/restores.ts:53`, `src/db/migrations/007_restores.sql:10` |
| `phaseDiagnostic` | Field | Yes | `src/routes/restores.ts:61`, `src/db/migrations/007_restores.sql:11` |
| `createdAt` | Field | Yes | `src/routes/restores.ts:54`, `src/db/migrations/007_restores.sql:12` |
| `connectionId` | Field | Yes | `src/routes/restores.ts`, `src/db/migrations/007_restores.sql:2` |
| `clientIdMasked` | Field | Yes | `src/routes/connections.ts:192` |
| `src/oauth/authorize.ts` | File | Yes | |
| `src/oauth/tokenExchange.ts` | File | Yes | |
| `src/http/JiraHttpClient.ts` | File | Yes | |

---

## Smoke Probe Execution Record

**Run date:** 2026-05-04 | **Server:** `npm run server` on port 3000

| Probe | Description | Exit code |
|---|---|---|
| Probe 1 | connect-jira-site (OAuth path) | **0** |
| Probe 2 | manual-connection | **0** |
| Probe 3 | stub-endpoints (inventory + policies) | **0** |

### Probe 1 — connect-jira-site transcript
```
==> [1/3] Create smoke connection (OAuth mode)
PASS: POST /api/connections returned status field
PASS: connection status is connected
==> [2/3] Verify connection appears in GET /api/connections
PASS: connection found in list
==> [3/3] Verify GET /api/connections returns valid JSON
PASS: valid JSON response

All smoke checks passed.
```

### Probe 2 — manual-connection transcript
```
==> [1/3] Create manual connection (mode=manual)
PASS: POST /api/connections (manual) returned status field
PASS: manual connection status is connected
==> [2/3] Verify clientIdMasked is present
PASS: clientIdMasked present in response
==> [3/3] Verify connection appears in GET /api/connections
PASS: manual connection found in list

All manual-connection smoke checks passed.
```

### Probe 3 — stub-endpoints transcript
```
==> [1/5] Create a connection to use for stub endpoint probes
PASS: connection created with id b1c614e8-26d6-4522-ad31-7dda7456bde4
==> [2/5] GET /api/inventory?connectionId=...
PASS: GET /api/inventory returned valid inventory response
==> [3/5] Verify inventory counts fields are numeric
PASS: all inventory count fields are integers
==> [4/5] POST /api/policies
PASS: POST /api/policies returned valid policy response
==> [5/5] Verify policy has updatedAt timestamp
PASS: policy response contains updatedAt

All stub-endpoint smoke checks passed.
```

---

## In-Sprint Fixes

| Doc | Section | Reference | Problem | Fix applied |
|---|---|---|---|---|
| ARCHITECTURE.md | Endpoint Map | `POST /api/restore` | Route path used singular `/api/restore`; actual server mounts at `/api/restores` | Renamed to `/api/restores` in Endpoint Map, section heading, and request/response docs |
| ARCHITECTURE.md | Endpoint Map | `GET /api/restore/:jobId` | Route path used singular and wrong param name; actual is `GET /api/restores/:id` | Renamed to `GET /api/restores/:id`; added missing `GET /api/restores/:id/events` entry |
| ARCHITECTURE.md | POST /api/policies | Success status `(200)` | Code returns HTTP 201, not 200 | Changed to `(201)` |
| ARCHITECTURE.md | POST /api/restores | Success status `(202)` | Code returns HTTP 201, not 202 | Changed to `(201)` |
| ARCHITECTURE.md | POST /api/restores | Response `{ jobId, status: "running", startedAt }` | Code returns `{ restoreId, status: "pending" }` (no `startedAt`) | Updated response shape to match implementation |
| ARCHITECTURE.md | GET /api/restores/:id | Response field `jobId` | Code returns `restoreId`; also added `connectionId`, `backupPointId`, `createdAt` fields present in actual response | Updated response shape; fixed error field `job_not_found` → `restore_not_found` |
| README.md | What is built | Sprint 3 only | Sprint 2 additions (inventory, policies, restores, manual connection, Caddyfile) were not listed | Added "Sprints 2–3" section with both sprint deliverables |

---

## Carry-forward to next sprint

_Zero items. All references grounded. All probes exit 0. All in-sprint defects resolved._
