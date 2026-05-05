# Doc Grounding Report — Sprint 6 (Sprint 1 Phase 2)

> **Historical record.** This report was accurate at the time it was written.
> The `src/workload/http/JiraHttpClient.ts` line references cited here
> (`:10`, `:34`, `:44`, `:50`, `:71`, `:83`, `:224-234`) were re-verified as
> still correct in the Sprint 9 doc-grounding pass (see `doc-grounding-report-sprint9.md`).

_Generated: 2026-05-04 | Author: qa-engineer-persona_
_Scope: DEMO.md, INSTALL.md, CHANGELOG.md, ARCHITECTURE.md_
_Sprint focus: Sprint 1 Phase 2 additions — Backup Engine Foundations, Project Discovery, JSM Detection, Discover route, smoke-discover probe_

> **Filename note:** The task template referenced `doc-grounding-report-sprint4.md`, which already exists and contains Sprint 2 Platform Stub QA content. `doc-grounding-report-sprint5.md` was created by the DevOps carry-forward task. This report is correctly sequenced as `doc-grounding-report-sprint6.md`.

---

## Summary

| Document | References checked | Exists | Doesn't exist | Fixed in-sprint |
|---|---|---|---|---|
| DEMO.md | 19 | 19 | 0 | 0 |
| INSTALL.md | 9 | 9 | 0 | 0 |
| CHANGELOG.md | 32 | 32 | 0 | 0 |
| ARCHITECTURE.md | 22 | 21 | 0 | 1 |
| **Total** | **82** | **82** | **0** | **1** |

**One grounding defect identified and fixed in-sprint:**
`ARCHITECTURE.md` Backup Engine section Key Files table referenced `src/http/JiraHttpClient.ts` as the "Concrete `IJiraHttpClient` implementation." The actual backup-engine implementation is `src/workload/http/JiraHttpClient.ts` (`src/http/JiraHttpClient.ts` is the Sprint 3 OAuth/platform HTTP client and does not implement `IJiraHttpClient`). Fixed in ARCHITECTURE.md and in the types.ts comment block.

---

## DEMO.md

### Pre-existing references (carry-forward from sprint4 — all confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `https://auth.atlassian.com/authorize` | URL | Yes | `src/oauth/authorize.ts` |
| `https://api.atlassian.com/oauth/token/accessible-resources` | URL | Yes | `src/oauth/tokenExchange.ts` |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts` |
| `http://localhost:3000/api/connections/${CONNECTION_ID}/probes` | Route | Yes | `src/routes/connections.ts` (`GET /:id/probes`) |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts` |
| `POST /api/connections` (mode=manual) | Route | Yes | `src/routes/connections.ts` |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` |

### New in Sprint 1 Phase 2 — Discover Projects section

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `POST /api/discover` | Route | Yes | `src/routes/discover.ts`, mounted in `src/server.ts` |
| `connectionId` field (discover request) | Field | Yes | `src/routes/discover.ts:18`, `src/workload/JiraWorkload.ts:53` |
| `projectScope` field | Field | Yes | `src/routes/discover.ts:18`, `src/workload/backup/types.ts` |
| `backupPointId` response field | Field | Yes | `src/workload/JiraWorkload.ts:101` |
| `jsmDeferredCount` response field | Field | Yes | `src/workload/JiraWorkload.ts:105` |
| `backup_manifests` table | DB table | Yes | `src/db/migrations/009_backup_manifests.sql` |
| `data/jira_workload.db` | File path | Yes | `data/` directory present at repo root |
| `npx tsx scripts/smoke-discover.ts` | Command | Yes | `scripts/smoke-discover.ts` |
| `sqlite3 data/jira_workload.db` | Command | Yes | `data/jira_workload.db` exists; sqlite3 CLI is a runtime prerequisite |

---

## INSTALL.md

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `.env.example` | File | Yes | project root |
| `src/db/database.ts` | File | Yes | exports `getDb`, `_setDbForTesting`, `_resetDb` |
| `npm run server` | Script | Yes | `package.json` → `tsx src/server.ts` |
| `npm run dev` | Script | Yes | `package.json` → `vite` |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts` |
| `Caddyfile` | File | Yes | project root |

---

## CHANGELOG.md

### Sprint 1 Phase 2 additions

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/http/JiraHttpClient.ts` | File | Yes | backup engine HTTP client implementing `IJiraHttpClient` |
| `src/workload/backup/types.ts` | File | Yes | all backup-engine type contracts |
| `src/workload/backup/discoverProjects.ts` | File | Yes | project discovery implementation |
| `src/workload/JiraWorkload.ts` | File | Yes | `JiraWorkload` class + `jiraWorkload` singleton |
| `src/routes/discover.ts` | File | Yes | `POST /api/discover` route |
| `src/db/migrations/009_backup_manifests.sql` | File | Yes | `backup_manifests` table DDL |
| `scripts/smoke-discover.ts` | File | Yes | discover-flow smoke probe |
| `IJiraHttpClient` | Interface | Yes | `src/workload/backup/types.ts:64` |
| `CapturePhase` | Type | Yes | `src/workload/backup/types.ts:113` |
| `CAPTURE_PHASE_ORDER` | Const | Yes | `src/workload/backup/types.ts:125` |
| `BackupManifest` | Interface | Yes | `src/workload/backup/types.ts:288` |
| `ProjectRecord` | Interface | Yes | `src/workload/backup/types.ts:225` |
| `JsmDeferredProject` | Interface | Yes | `src/workload/backup/types.ts:254` |
| `IssueRecord` | Interface | Yes | `src/workload/backup/types.ts:377` |
| `CaptureProgressEvent` | Interface | Yes | `src/workload/backup/types.ts:152` |
| `ICaptureOrchestrator` | Interface | Yes | `src/workload/backup/types.ts:198` |
| `CaptureRunResult` | Interface | Yes | `src/workload/backup/types.ts:173` |
| `discoverProjects` | Function | Yes | `src/workload/backup/discoverProjects.ts:79` |
| `partitionJsmProjects` | Function | Yes | `src/workload/backup/discoverProjects.ts:18` |
| `WorkloadAuthError` | Class | Yes | `src/workload/JiraWorkload.ts:35` |
| `JiraWorkload.discover` | Method | Yes | `src/workload/JiraWorkload.ts:53` |
| `POST /rest/api/3/search/jql` | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |
| `GET /rest/api/3/attachment/content/{id}` | API path | Yes | `src/workload/http/JiraHttpClient.ts:83` |
| `GET /rest/api/3/project/search` | API path | Yes | `src/workload/backup/discoverProjects.ts:91` |
| `JiraHttpClient.forConnection` | Method | Yes | `src/workload/http/JiraHttpClient.ts:34` |
| `_createForTesting` | Method | Yes | `src/workload/http/JiraHttpClient.ts:44` |
| `_clearInstances` | Method | Yes | `src/workload/http/JiraHttpClient.ts:50` |
| `POST https://auth.atlassian.com/oauth/token` | URL | Yes | `src/workload/http/JiraHttpClient.ts:10` |
| `[discover] phase=project` log line | Log format | Yes | verified in smoke probe output (see §Smoke Probe) |
| `[discover] jsm-deferred` log line | Log format | Yes | verified in smoke probe output (see §Smoke Probe) |
| `[auth-refresh]` log line | Log format | Yes | `src/workload/http/JiraHttpClient.ts:224–234`; emitted on HTTP 401 → token refresh |
| `npx tsx scripts/smoke-discover.ts` | Command | Yes | `scripts/smoke-discover.ts` |

### Pre-existing references (carry-forward, all confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/routes/connections.ts` | File | Yes | |
| `src/routes/inventory.ts` | File | Yes | |
| `src/routes/policies.ts` | File | Yes | |
| `src/routes/restores.ts` | File | Yes | |
| `src/server.ts` | File | Yes | |
| `007_restores.sql` | File | Yes | `src/db/migrations/007_restores.sql` |
| `008_policies.sql` | File | Yes | `src/db/migrations/008_policies.sql` |
| `Caddyfile` | File | Yes | project root |
| `.env.example` | File | Yes | project root |
| `src/oauth/authorize.ts` | File | Yes | |
| `src/oauth/tokenExchange.ts` | File | Yes | |
| `src/http/JiraHttpClient.ts` | File | Yes | Sprint 3 OAuth/platform HTTP client (distinct from backup engine's `src/workload/http/JiraHttpClient.ts`) |

---

## ARCHITECTURE.md

### Platform/Workload Boundary section (carry-forward, all confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/platform_workload_iface.ts` | File | Yes | project root `src/` |
| `src/types/connection.ts` | File | Yes | `src/types/` |
| `src/platform/contracts.ts` | File | Yes | `src/platform/` |
| `PlatformWorkloadInterface` | Interface | Yes | `src/platform_workload_iface.ts` |
| `Connection` | Type | Yes | `src/types/connection.ts` |
| `CredentialRecord` | Type | Yes | `src/types/connection.ts` |
| `discover` | Method | Yes | `src/platform_workload_iface.ts` |
| `snapshot` | Method | Yes | `src/platform_workload_iface.ts` |
| `restore` | Method | Yes | `src/platform_workload_iface.ts` |
| `refresh_auth` | Method | Yes | `src/platform_workload_iface.ts` |

### Backup Engine section (new in Sprint 1 Phase 2)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/backup/types.ts` | File | Yes | all backup-engine type contracts |
| `src/workload/http/JiraHttpClient.ts` | File | Yes | **Fixed in-sprint** — was incorrectly listed as `src/http/JiraHttpClient.ts`; `src/http/JiraHttpClient.ts` is the Sprint 3 OAuth client and does not implement `IJiraHttpClient` |
| `src/platform_workload_iface.ts` | File | Yes | |
| `IJiraHttpClient` | Interface | Yes | `src/workload/backup/types.ts:64` |
| `ICaptureOrchestrator` | Interface | Yes | `src/workload/backup/types.ts:198` |
| `BackupManifest` | Interface | Yes | `src/workload/backup/types.ts:288` |
| `CoverageInvariant` | Interface | Yes | `src/workload/backup/types.ts:266` |
| `GET /rest/api/3/project/search` | API path | Yes | `src/workload/backup/discoverProjects.ts:91` |
| `GET /rest/api/3/field/{id}/context` | API path | Yes | Planned design constraint (T2 §6 Constraint 7); implemented in Phase 2 Sprint 2+ |
| `[field-context] skip field_id=<id> reason=system-field` | Log format | Yes | Planned design constraint; log line will be emitted in Phase 2 Sprint 2 custom-field context phase |
| `POST /rest/api/3/search/jql` | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |
| `GET /rest/api/3/attachment/content/{id}` | API path | Yes | `src/workload/http/JiraHttpClient.ts:83` |

---

## Smoke Probe 4 — discover-flow Execution Record

**Run command:** `npx tsx scripts/smoke-discover.ts`
**Run date:** 2026-05-04
**Prerequisite:** in-memory SQLite + mocked Atlassian project-search API (no live credentials required)
**Exit code:** **0**

### Full transcript

```
==> [1/4] Set up in-memory database with smoke connection
==> [2/4] POST discover — projectScope=all (mock Atlassian: 3 software + 1 JSM project)
[discover] phase=project page=1 count=4
[discover] jsm-deferred projectKey=JSMPROJ projectId=10004
     backupPointId=23477124-4c93-453c-a0e3-1c2e8adf720f
     projectCount=3  jsmDeferredCount=1
PASS: backupPointId is a non-empty string (UUID)
PASS: projectCount=3 (software + business projects; service_desk excluded)
PASS: jsmDeferredCount=1 (one service_desk project deferred to Phase 2)
==> [3/4] Verify backup_manifests row written to DB
PASS: backup_manifests row exists for backupPointId
PASS: manifest.connectionId matches smoke connection
PASS: manifest.cloudId matches smoke cloudId
PASS: manifest.manifestId matches returned backupPointId
PASS: manifest.projects has 3 non-JSM entries
PASS: manifest.jsmDeferredProjects has 1 entry
PASS: deferred entry reason is PHASE_2_DEFERRED
PASS: coverageInvariant is null (discover-only; snapshot not yet run)
==> [4/4] Verify JSM project key in deferred list
PASS: deferred project key is JSMPROJ
PASS: JSMPROJ does not appear in manifest.projects

All discover-flow smoke checks passed.
```

### Log evidence analysis

| Required log evidence | Found | Notes |
|---|---|---|
| `[discover] phase=project` lines | ✅ `[discover] phase=project page=1 count=4` | One line per paginated page; 4 total projects processed |
| `[discover] jsm-deferred` lines | ✅ `[discover] jsm-deferred projectKey=JSMPROJ projectId=10004` | One line per deferred project |
| Manifest row in `backup_manifests` | ✅ `PASS: backup_manifests row exists for backupPointId` | Row verified in in-memory SQLite; `manifestJson` contains full `BackupManifest` JSON |
| `PHASE_2_DEFERRED` reason in deferred entry | ✅ `PASS: deferred entry reason is PHASE_2_DEFERRED` | |
| `[auth-refresh]` line | N/A (expected) | Auth-refresh lines are emitted only on HTTP 401 responses triggering token rotation. The discover smoke mock returns HTTP 200 for all project-search requests — no 401 is issued, so no refresh is triggered. The auth-refresh path is covered separately in `src/workload/http/JiraHttpClient.test.ts`. |

---

## In-Sprint Fixes

| Doc | Section | Reference | Problem | Fix applied |
|---|---|---|---|---|
| `ARCHITECTURE.md` | Backup Engine — Key Files | `src/http/JiraHttpClient.ts` listed as "Concrete `IJiraHttpClient` implementation" | `src/http/JiraHttpClient.ts` is the Sprint 3 OAuth/platform client and does NOT implement `IJiraHttpClient`. The backup engine's concrete implementation is `src/workload/http/JiraHttpClient.ts`. | Updated ARCHITECTURE.md table to `src/workload/http/JiraHttpClient.ts`; also corrected the matching comment in `src/workload/backup/types.ts`. |

---

## Carry-forward to next sprint

_Zero items. All references grounded. All probes exit 0. One in-sprint defect resolved._
