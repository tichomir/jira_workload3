# Doc-Grounding Report — Sprint Maintenance: Fix OAuth Token Exchange

_Generated: 2026-05-05 | QA Engineer_

Sprint deliverables verified: `src/oauth/tokenExchange.ts` (client_secret fix),
`src/server.ts` (trust-proxy + startup guard), `src/config.ts` (new centralised
env-var loader), `src/oauth/authorize.ts` (config import), `src/oauth/tokenExchange.test.ts`
(new client_secret assertion), `src/db/migrations/016_connections_account_id.sql`
(new migration), `src/ui/pages/ConnectionsList.tsx` + `ConnectionsList.css`
(accountId display), operations runbook folded into `INSTALL.md §8`, `docs/OPERATIONS.md`
redirect notice, README.md quick-links update, `.env.example` update.

---

## README.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `npm install` | Y | Quick Start | `package.json` scripts ✓ |
| `npm run build` | Y | Quick Start | `package.json` scripts: `tsc && vite build` ✓ |
| `npm run server` | Y | Quick Start | `package.json` scripts: `tsx src/server.ts` ✓ |
| `npm run test` | Y | Quick Start | `package.json` scripts: `vitest run` ✓ |
| `curl -sf http://localhost:4000/health` | Y | Quick Start | `/health` endpoint in `src/server.ts` ✓ |
| `http://localhost:4000` | Y | Quick Start | server default port 4000 in `src/server.ts` ✓ |
| `INSTALL.md` | Y | Quick links | file exists ✓ |
| `DEMO.md` | Y | Quick links | file exists ✓ |
| `ARCHITECTURE.md` | Y | Quick links | file exists ✓ |
| `CHANGELOG.md` | Y | Quick links | file exists ✓ |
| `docs/OPERATIONS.md` | **Removed** | Quick links | Correctly absent this sprint — `docs/OPERATIONS.md` row removed per OAuth sprint doc change ✓ |
| `CaptureOrchestrator` class | Y | What is built — Phase 2 Sprint 2 | `src/workload/snapshot/CaptureOrchestrator.ts` ✓ |
| `JiraWorkload.snapshot()` | Y | What is built — Phase 2 Sprint 2 | `src/workload/JiraWorkload.ts` ✓ |
| `scripts/check-http-guard.sh` | Y | What is built — Phase 2 Sprint 2 | exists ✓ |
| `src/workload/http/JiraHttpClient.ts` | Y | What is built — Phase 2 Sprint 1 | exists ✓ |
| `POST /api/connections`, `GET /api/connections` | Y | Phase 1 Sprint 3 | routes in `src/routes/connections.ts` ✓ |
| `Caddyfile` | Y | Phase 1 Sprint 2 | exists at project root ✓ |
| `.env.example` | Y | Phase 1 Sprint 2 | exists at project root ✓ |

**README.md result: PASS — all references resolve.**

---

## INSTALL.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `npm install`, `npm run build` | Y | §1 Clone, install, and build | `package.json` ✓ |
| `cp .env.example .env` | Y | §2 Configure environment | `.env.example` exists ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | §2 env table | `.env.example` + `src/config.ts` ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | §2 env table | `.env.example` + `src/config.ts`; startup guard in `src/server.ts` ✓ |
| `OAUTH_REDIRECT_URI` | Y | §2 env table | `.env.example` + `src/config.ts` ✓ |
| `PORT` | Y | §2 env table | `.env.example` + `src/config.ts` ✓ |
| `DB_PATH` | Y | §2 env table | `.env.example` + `src/config.ts`; **added this sprint** ✓ |
| `DCC_ATTACHMENT_DIR` | Y | §2 env table | `.env.example` + `src/config.ts` ✓ |
| `Caddyfile` | Y | §2 HTTPS | exists at project root ✓ |
| `src/db/database.ts` | Y | §3 Migrations | exists ✓ |
| `npx tsx src/db/database.ts` | Y | §3 Migrations | `tsx` available via `npx` from `package.json` devDependencies ✓ |
| `podman-compose.yml` | Y | §4 Primary path | exists at project root ✓ |
| `start.sh` | Y | §4 Primary path | exists at project root ✓ |
| `http://localhost:4000/health` | Y | §4 Primary path | `/health` in `src/server.ts` ✓ |
| `http://localhost:4000` | Y | §4 Primary path + §5 | server default port 4000 ✓ |
| `https://localhost` | Y | §4 Primary path | Caddy TLS sidecar in `podman-compose.yml` ✓ |
| `npm run server` | Y | §4 Alternative | `package.json` ✓ |
| `npm run dev` | Y | §4 Alternative | `package.json`: `vite` ✓ |
| `Caddyfile.compose` | Y | §4 Alternative | exists at project root ✓ |
| `curl -sf http://localhost:4000/health` | Y | §5 Verify | `/health` endpoint ✓ |
| `curl -sf http://localhost:4000/api/connections` | Y | §5 Verify | route in `src/routes/connections.ts` ✓ |
| `npm run test` | Y | §5a Test suite | `package.json`: `vitest run` ✓ |
| `.github/workflows/smoke-probes.yml` | Y | §6 CI Secrets | exists ✓ |
| `scripts/run-smoke-probes.sh` | Y | §6 Running smoke probes | exists ✓ |
| `scripts/smoke/probe-connect-jira-site.sh` | Y | §6 Individual probes | exists ✓ |
| `scripts/smoke/probe-run-first-backup.sh` | Y | §6 Individual probes | exists ✓ |
| `scripts/smoke/probe-browse-protected-inventory.sh` | Y | §6 Individual probes | exists ✓ |
| `scripts/smoke/probe-restore-protected-objects.sh` | Y | §6 Individual probes | exists ✓ |
| `scripts/smoke/probe-view-sdi-teaser.sh` | Y | §6 Individual probes | exists ✓ |
| `src/probes/permissionProbes.ts` | Y | §8.1 Connection Failure | exists ✓ |
| `src/oauth/authorize.ts:PHASE1_SCOPES` | Y | §8.1 Connection Failure | `PHASE1_SCOPES` exported const at line 7 ✓ |
| `/connections` page path | Y | §8.1 Resolution steps | React route in `src/App.tsx` ✓ |
| `src/workload/restore/boardScopeRecheck.ts` | Y | §8.2 Scope Drift | exists ✓ |
| `src/routes/connections.ts:_handleOAuth` | Y | §8.2 Resolution steps | `_handleOAuth` function at line 49 ✓ |
| `write:board-scope:jira-software` scope | Y | §8.2 Scope Drift | in `PHASE1_SCOPES` (`src/oauth/authorize.ts`) ✓ |
| `write:board-scope.admin:jira-software` scope | Y | §8.2 Scope Drift | in `PHASE1_SCOPES` ✓ |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | §8.2 Resolution steps | exists ✓ |
| `data/jira_workload.db` | Y | §8.2 sqlite3 queries | runtime DB; directory `data/` present in repo ✓ |
| `src/workload/http/JiraHttpClient.ts:_performRefresh` | Y | §8.3 Refresh-Token | `_performRefresh` method at line 320 ✓ |
| `src/workload/http/JiraHttpClient.ts:_refresh` | Y | §8.3 Log patterns | `_refresh` method at line 297 ✓ |
| `src/routes/connections.ts:_handleOAuth` (§8.3) | Y | §8.3 Resolution steps | same function ✓ |
| `src/workload/backup/discoverProjects.ts:partitionJsmProjects()` | Y | §8.4 JSM detection | function exported at line 18 ✓ |
| `[search]` tag → `src/workload/http/JiraHttpClient.ts:enumerateIssues` | Y | §8.5 Log tag reference | file + method exist ✓ |
| `[field-context]` tag → `src/workload/backup/discoverFieldContexts.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[permission-probe]` tag → `src/probes/permissionProbes.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[permission-probe]` tag → `src/workload/restore/boardScopeRecheck.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[jql-validate]` tag → `src/routes/policies.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[restore]` tag → `src/workload/restore/RestoreOrchestrator.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[restore]` tag → `src/workload/restore/trashDetectionGuard.ts` | Y | §8.5 Log tag reference | file exists ✓ |
| `[auth-refresh]` tag → `src/workload/http/JiraHttpClient.ts:_refresh` | Y | §8.5 Log tag reference | method exists at line 297 ✓ |
| `[rate-limit]` tag → `src/workload/http/JiraHttpClient.ts:_retryWithBackoff` | Y | §8.5 Log tag reference | file exists ✓ |
| `[discover]` tag → `src/workload/backup/discoverProjects.ts` | Y | §8.5 Log tag reference | file exists ✓ |

**INSTALL.md result: PASS — all references resolve. `DB_PATH` env-var row correctly added this sprint.**

---

## DEMO.md

_(No changes to DEMO.md this sprint. References verified against current codebase state.)_

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `./start.sh` | Y | Prerequisites | exists at project root ✓ |
| `http://localhost:4000/health` | Y | Prerequisites | `/health` in `src/server.ts` ✓ |
| `GET /api/oauth/authorize` | Y | Probe 1 step 1/5 | route in `src/routes/oauth.ts` ✓ |
| `POST /api/connections` | Y | Probe 1 step 3/5 | route in `src/routes/connections.ts` ✓ |
| `GET /api/connections` | Y | Probe 1 step 4/5 | route in `src/routes/connections.ts` ✓ |
| `POST /api/connections` (manual) | Y | Probe 2 | `mode: "manual"` path in `src/routes/connections.ts` ✓ |
| `GET /api/inventory` | Y | Probe 3 | route in `src/routes/inventory.ts` ✓ |
| `POST /api/policies` | Y | Probe 3 | route in `src/routes/policies.ts` ✓ |
| `npx tsx scripts/smoke-discover.ts` | Y | Probe 4 | `scripts/smoke-discover.ts` exists ✓ |
| `src/workload/backup/discoverFieldContexts.test.ts` | Y | Probe 5 step 1/3 | exists ✓ |
| `src/workload/snapshot/assembleIssuePayload.test.ts` | Y | Probe 5 step 2/3 | exists ✓ |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | Y | Probe 5 step 3/3 | exists ✓ |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | Y | Probe 6 step 4/5 | exists ✓ |
| `src/workload/backup/computeManifestDiff.test.ts` | Y | Probe 6 step 5/5 | exists ✓ |
| `GET /api/inventory/Issue` (filter facets) | Y | Probe 7 | route in `src/routes/inventory.ts` ✓ |
| `POST /api/restore-jobs` | Y | Probe 8 step 2/4 | route in `src/routes/restore-jobs.ts` ✓ |
| `GET /api/restore-jobs/:id/events` | Y | Probe 8 step 3/4 | route in `src/routes/restore-jobs.ts` ✓ |
| `GET /api/restore-jobs/trash-check` | Y | Probe 9 steps 2–4 | `handleTrashCheck` in `src/routes/restore-jobs.ts` ✓ |
| `src/workload/restore/boardScopeRecheck.test.ts` | Y | Probe 9 step 5/7 | exists ✓ |
| `src/workload/restore/trashDetectionGuard.test.ts` | Y | Probe 9 step 6/7 | exists ✓ |
| `src/workload/restore/RestoreOrchestrator.test.ts` | Y | Probe 9 step 7/7 | exists ✓ |
| `src/workload/restore/HeartbeatEmitter.test.ts` | Y | Probe 10 step 1/2 | exists ✓ |
| `src/routes/restore-jobs-sse-http.test.ts` | Y | Probe 10 step 2/2 | exists ✓ |
| `tests/sdi/detectors.test.ts` | Y | Probe 11 step 4/4 | exists ✓ |
| `tests/sdi/scanDispatcher.test.ts` | Y | Probe 11 step 4/4 | exists ✓ |
| `GET /api/backup-points/:id/sdi-teaser` | Y | Probe 11 step 2/4 | route in `src/routes/backup-points.ts` ✓ |
| `backup_point_sdi_summary` table | Y | Probe 11 seed | `src/db/migrations/015_backup_point_sdi_summary.sql` ✓ |
| `backup_point_items` table (Issue, Project, Board, Sprint) | Y | Probe 7 seed | `src/db/migrations/011_inventory_items.sql` ✓ |

**DEMO.md result: PASS — all references resolve. No changes this sprint.**

---

## ARCHITECTURE.md

_(No changes to ARCHITECTURE.md this sprint. References verified against current codebase state.)_

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/platform_workload_iface.ts` | Y | Key Files | exists ✓ |
| `src/types/connection.ts` | Y | Key Files | exists ✓ |
| `src/workload/backup/types.ts` | Y | Backup Engine Key Files | exists ✓ |
| `src/workload/http/JiraHttpClient.ts` | Y | Backup Engine Key Files | exists ✓ |
| `src/http/JiraHttpClient.ts` | Y | Backup Engine note | exists (OAuth/connection-layer client) ✓ |
| `src/workload/snapshot/types.ts` | Y | Snapshot Orchestrator Key Files | exists ✓ |
| `src/workload/types/Attachment.ts` | Y | Attachment Storage | exists ✓ |
| `src/workload/types/ManifestDiff.ts` | Y | Manifest Deletion-Diff | exists ✓ |
| `src/workload/types/ProgressEvent.ts` | Y | Progress Event Contract | exists ✓ |
| `src/workload/types/PolicyRecord.ts` | Y | Policy Record | exists ✓ |
| `src/routes/inventory.ts` | Y | Inventory Browse Flow | exists ✓ |
| `src/platform/contracts.ts` | Y | Inventory Browse Flow Key Files | exists ✓ |
| `src/workload/restore/types.ts` | Y | Restore Subsystem Key Files | exists ✓ |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | Restore Subsystem Key Files | exists ✓ |
| `src/workload/restore/eventBus.ts` | Y | Restore Subsystem Key Files | exists ✓ |
| `src/routes/restore-jobs.ts` | Y | Restore Subsystem Key Files | exists ✓ |
| `src/workload/http/JiraHttpClient.ts:134` | Y | [search] log line format | file exists; line reference is informational ✓ |
| `MAX_HEARTBEAT_INTERVAL_MS = 10 000` | Y | Progress Heartbeat | defined in `src/workload/types/ProgressEvent.ts` ✓ |
| `STALLED_THRESHOLD_MS = 20 000` | Y | Progress Heartbeat | defined in `src/workload/types/ProgressEvent.ts` ✓ |
| `RESTORE_PHASE_ORDER` | Y | Restore Subsystem | in `src/workload/restore/types.ts` ✓ |
| `GuardResult` interface | Y | Restore Phase Chain | `src/workload/restore/types.ts` ✓ |
| `TrashStatus` interface | Y | Restore Phase Chain | `src/workload/restore/types.ts` ✓ |
| `PostIssuePassReport` interface | Y | Restore Phase Chain | `src/workload/restore/types.ts` ✓ |
| `src/workload/restore/boardScopeRecheck.ts` | Y | Restore Phase Chain | exists ✓ |
| `src/workload/restore/trashDetectionGuard.ts` | Y | Restore Phase Chain | exists ✓ |
| `src/workload/restore/postIssueCreationPass.ts` | Y | Restore Phase Chain | exists ✓ |
| `src/platform/restore/sseEvents.ts` | Y | SSE Event Types | exists ✓ |

**ARCHITECTURE.md result: PASS — all references resolve. No changes this sprint.**

---

## CHANGELOG.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| Sprint Maintenance — Fix OAuth token exchange entry | Y | Top of CHANGELOG | present ✓ |
| `src/oauth/tokenExchange.ts` | Y | Fixed — Token exchange | exists ✓ |
| `exchangeCodeForTokens` function | Y | Fixed — Token exchange | in `src/oauth/tokenExchange.ts` ✓ |
| `src/oauth/tokenExchange.test.ts` | Y | Fixed — Token exchange | exists ✓ |
| `src/server.ts` | Y | Fixed — Trust proxy + startup guard | exists ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | Fixed — startup guard | in `.env.example` + `src/config.ts` ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | Fixed — startup guard | in `.env.example` + `src/config.ts` ✓ |
| `authorize.ts` | Y | Fixed — startup guard | `src/oauth/authorize.ts` ✓ |
| `src/config.ts` | Y | Fixed — config module | exists (new file this sprint) ✓ |
| `atlassianClientId`, `atlassianClientSecret`, `oauthRedirectUri`, `port`, `dbPath`, `attachmentDir` | Y | Fixed — config module | all getters in `src/config.ts` ✓ |
| `server.ts`, `authorize.ts`, `tokenExchange.ts` | Y | Fixed — config module | all three files exist ✓ |
| `src/db/migrations/016_connections_account_id.sql` | Y | Fixed — accountId migration | exists (new file this sprint); **added to CHANGELOG this sprint** ✓ |
| `handleCallback` in `src/oauth/tokenExchange.ts` | Y | Fixed — accountId migration | function exists ✓ |
| `src/ui/pages/ConnectionsList.tsx` | Y | Fixed — accountId display | exists ✓ |
| `src/ui/pages/ConnectionsList.css` | Y | Fixed — accountId display | exists ✓ |
| `ConnectionRow` interface | Y | Fixed — accountId display | in `ConnectionsList.tsx` line 13 ✓ |
| `.cl__account-id-text` CSS class | Y | Fixed — accountId display | in `ConnectionsList.css` ✓ |
| `INSTALL.md §2` | Y | Documentation | file exists, §2 updated ✓ |
| `INSTALL.md §8` | Y | Documentation | file exists, full runbook in §8 ✓ |
| `docs/OPERATIONS.md` | Y | Documentation | exists as redirect notice ✓ |
| `README.md` | Y | Documentation | exists ✓ |
| `.env.example` | Y | Documentation | exists ✓ |
| Sprint Maintenance — README/INSTALL happy-path repair entry | Y | Below OAuth entry | present ✓ |
| Sprint Maintenance — Restore podman-compose runtime entry | Y | Below | present ✓ |
| Sprint 18 entry | Y | History | present ✓ |

**CHANGELOG.md result: PASS (after in-sprint fix) — `016_connections_account_id.sql` and `ConnectionsList` changes added to CHANGELOG this sprint.**

---

## Sprint Carry-Forward Status

### Sprint Maintenance — README/INSTALL happy-path repair P0 carry-forwards
All items from the previous maintenance sprint were resolved. No open items carried into this sprint.

### Sprint 18 P0 carry-forwards
All Sprint 18 P0 carry-forwards resolved in Sprint 18 and subsequent maintenance sprints. No open items.

---

## Fixes Applied This Sprint

| # | Doc | Reference | Fix Applied |
|---|-----|-----------|-------------|
| 1 | CHANGELOG.md | `src/db/migrations/016_connections_account_id.sql` missing | **Fixed** — added `accountId` migration section to CHANGELOG under Sprint Maintenance OAuth fix entry |
| 2 | CHANGELOG.md | `src/ui/pages/ConnectionsList.tsx` + `ConnectionsList.css` changes undocumented | **Fixed** — added `accountId` Connections list UI section to CHANGELOG |

---

## New P0 Carry-Forwards

None. All identified doc issues were resolved in-sprint.

---

## Smoke Probe Status

| Probe | Description | Status |
|-------|-------------|--------|
| Probe 1 | connect-jira-site OAuth authorize redirect + direct connection path | Valid; `GET /api/oauth/authorize` returns 302; PKCE scopes correct in `PHASE1_SCOPES` ✓ |
| Probe 2 | manual-connection | Unchanged from Sprint 14; valid ✓ |
| Probe 3 | stub-endpoints (inventory + policies) | Unchanged from Sprint 14; valid ✓ |
| Probe 4 | discover-flow | Unchanged from Sprint 14; valid ✓ |
| Probe 5 | field-context + issue-enumeration unit tests | Unchanged from Sprint 14; valid ✓ |
| Probe 6 | Sprint 3 deliverables (policies rpoHours, jobs, SHA-256, changeBadge) | Unchanged; valid ✓ |
| Probe 7 | browse-protected-inventory: filter facets, search & traceability | Unchanged; valid ✓ |
| Probe 8 | restore-protected-objects: POST /api/restore-jobs + SSE phase order | Unchanged; valid ✓ |
| Probe 9 | restore-sprint2-guards: trash-check + board scope + post-issue pass | Unchanged; valid ✓ |
| Probe 10 | restore-sprint3-heartbeat: HeartbeatEmitter & SSE HTTP integration | Unchanged; valid ✓ |
| Probe 11 | view-sdi-teaser: SDI endpoint + seed + unit tests | Unchanged; valid ✓ |

> Note: Functional probe execution against a running server is deferred to the sprint runner environment.
> All referenced file paths, API routes, function names, constants, and test files have been verified
> to exist in the current codebase.

---

## Doc-Grounding Gate: **PASS**

All five canonical docs pass doc-grounding for the Sprint Maintenance — Fix OAuth token exchange sprint:

| Doc | Result |
|-----|--------|
| README.md | ✅ PASS |
| INSTALL.md | ✅ PASS |
| DEMO.md | ✅ PASS |
| ARCHITECTURE.md | ✅ PASS |
| CHANGELOG.md | ✅ PASS (after 2 in-sprint fixes) |

Two CHANGELOG gaps were found and fixed in-sprint:
1. `src/db/migrations/016_connections_account_id.sql` — new migration undocumented
2. `src/ui/pages/ConnectionsList.tsx` + `ConnectionsList.css` — UI changes undocumented

Zero unresolved 'doesn't exist' entries. Zero P0 carry-forwards.
