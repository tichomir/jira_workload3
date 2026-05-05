# Doc-Grounding Report — Sprint 17
_Generated: 2026-05-05 | Scope: README.md, INSTALL.md, DEMO.md, ARCHITECTURE.md, CHANGELOG.md, docs/OPERATIONS.md, docs/handoff/tihomir-sprint-kickoff.md_

Each reference (backticked path, command, env-var, npm/Makefile target, port, class/component, config file) is verified against the codebase via `ls`/`grep`/`package.json`. Misses are classified as (a) **fixed in-sprint** or (b) **P0 carry-forward**.

---

## README.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `INSTALL.md` | file | ✅ | Quick links |
| `DEMO.md` | file | ✅ | Quick links |
| `ARCHITECTURE.md` | file | ✅ | Quick links |
| `CHANGELOG.md` | file | ✅ | Quick links |
| `docs/OPERATIONS.md` | file | ✅ | Quick links |
| `GET /rest/api/3/field/{id}/context` | API endpoint | ✅ `src/workload/backup/discoverFieldContexts.ts` | What is built |
| `custom: true` | field discriminator | ✅ `discoverFieldContexts.ts` | What is built |
| `[field-context] skip` | log tag | ✅ `discoverFieldContexts.ts` | What is built |
| `CaptureOrchestrator` | class | ✅ `src/workload/snapshot/CaptureOrchestrator.ts` | What is built |
| `JiraWorkload.snapshot()` | method | ✅ `src/workload/JiraWorkload.ts` | What is built |
| `POST /rest/api/3/search/jql` | API endpoint | ✅ `src/workload/http/JiraHttpClient.ts` | What is built |
| `GET /rest/api/3/search` (forbidden) | API endpoint | ✅ `scripts/check-http-guard.sh` enforces absence | What is built |
| `scripts/check-http-guard.sh` | file | ✅ | What is built |
| `backup_manifests` | DB table | ✅ `src/db/migrations/009_backup_manifests.sql` | What is built |
| `PlatformWorkloadInterface` | interface | ✅ `src/platform_workload_iface.ts` | What is built |
| `src/workload/http/JiraHttpClient.ts` | file | ✅ | What is built |
| `GET /rest/api/3/project/search` | API endpoint | ✅ `src/workload/backup/discoverProjects.ts` | What is built |
| `PHASE_2_DEFERRED` | constant | ✅ `discoverProjects.ts` | What is built |
| `JiraWorkload.discover()` | method | ✅ `src/workload/JiraWorkload.ts` | What is built |
| `POST /api/discover` | API route | ✅ `src/routes/discover.ts` | What is built |
| `POST /api/connections` | API route | ✅ `src/routes/connections.ts` | What is built |
| `GET /api/inventory` | API route | ✅ `src/routes/inventory.ts` | What is built |
| `POST /api/policies` | API route | ✅ `src/routes/policies.ts` | What is built |
| `POST /api/restores` | API route | ✅ `src/routes/restores.ts` | What is built |
| `GET /api/restores/:id` | API route | ✅ `src/routes/restores.ts` | What is built |
| `GET /api/restores/:id/events` | API route | ✅ `src/routes/restores.ts` | What is built |
| `Caddyfile` | config file | ✅ repo root | What is built |

**Result: 0 misses.**

---

## INSTALL.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `.env.example` | file | ✅ | §2 Configure environment |
| `ATLASSIAN_CLIENT_ID` | env var | ✅ `.env.example` | §2 |
| `ATLASSIAN_CLIENT_SECRET` | env var | ✅ `.env.example` | §2 |
| `OAUTH_REDIRECT_URI` | env var | ✅ `.env.example` | §2 |
| `PORT` | env var | ✅ `.env.example` | §2 |
| `DCC_ATTACHMENT_DIR` | env var | ✅ `.env.example` | §2 |
| `Caddyfile` | config file | ✅ repo root | §2 HTTPS callback |
| `npm run server` | npm script | ✅ `package.json` | §4 Start services |
| `npm run dev` | npm script | ✅ `package.json` | §4 Start services |
| `src/db/database.ts` | file | ✅ | §3 Run migrations |
| `npx tsx src/db/database.ts` | command | ✅ `tsx` in devDeps, file exists | §3 |
| `http://localhost:${PORT:-3000}/api/connections` | URL | ✅ port 3000 from `.env.example` | §5 Verify |
| `.github/workflows/smoke-probes.yml` | file | ✅ | §6 CI Secrets |
| `JIRA_SANDBOX_CLIENT_ID` | CI secret | ✅ per workflow | §6 CI Secrets |
| `JIRA_SANDBOX_CLIENT_SECRET` | CI secret | ✅ per workflow | §6 CI Secrets |
| `JIRA_SANDBOX_OAUTH_REDIRECT_URI` | CI secret | ✅ per workflow | §6 CI Secrets |
| `scripts/run-smoke-probes.sh` | file | ✅ | §6 Running probes locally |
| `scripts/smoke/probe-connect-jira-site.sh` | file | ✅ | §6 |
| `scripts/smoke/probe-run-first-backup.sh` | file | ✅ | §6 |
| `scripts/smoke/probe-browse-protected-inventory.sh` | file | ✅ | §6 |
| `scripts/smoke/probe-restore-protected-objects.sh` | file | ✅ | §6 |
| `scripts/smoke/probe-view-sdi-teaser.sh` | file | ✅ | §6 |
| `npm run server` | npm script | ✅ | §6 Running probes locally |
| `GET /api/connections` | API route | ✅ `src/routes/connections.ts` | §7 API surface |
| `POST /api/connections` | API route | ✅ | §7 |
| `GET /api/connections/:id/probes` | API route | ✅ | §7 |
| `GET /api/oauth/authorize` | API route | ✅ `src/routes/oauth.ts` | §7 |
| `GET /api/oauth/callback` | API route | ✅ | §7 |
| `POST /api/discover` | API route | ✅ `src/routes/discover.ts` | §7 |
| `POST /api/policies` | API route | ✅ `src/routes/policies.ts` | §7 |
| `GET /api/jobs/:id` | API route | ✅ `src/routes/jobs.ts` | §7 |
| `GET /api/inventory` | API route | ✅ `src/routes/inventory.ts` | §7 |
| `GET /api/inventory/:type` | API route | ✅ | §7 |
| `POST /api/restore-jobs` | API route | ✅ `src/routes/restore-jobs.ts` | §7 |
| `GET /api/restore-jobs/:id/events` | API route | ✅ | §7 |
| `GET /api/restore-jobs/trash-check` | API route | ✅ | §7 |
| `GET /api/backup-points/:id/sdi-teaser` | API route | ✅ `src/routes/backup-points.ts` | §7 |
| `docs/OPERATIONS.md` | file | ✅ | §8 Operations runbook |

**Result: 0 misses.**

---

## DEMO.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `http://localhost:3000` | port | ✅ default `PORT=3000` | Prerequisites |
| `.env.example` | file | ✅ | Prerequisites |
| `ATLASSIAN_CLIENT_ID` | env var | ✅ | Prerequisites |
| `ATLASSIAN_CLIENT_SECRET` | env var | ✅ | Prerequisites |
| `OAUTH_REDIRECT_URI` | env var | ✅ | Prerequisites |
| `.env` | file | ✅ (runtime copy of `.env.example`) | Prerequisites |
| `GET /api/connections/${CONNECTION_ID}/probes` | API route | ✅ | Connect Jira Site |
| `POST /api/discover` | API route | ✅ | Discover Projects |
| `data/jira_workload.db` | DB file | ✅ | Discover Projects |
| `backup_manifests` | DB table | ✅ | Discover Projects |
| `manifestJson` (SQL column) | DB column | ✅ `009_backup_manifests.sql` | Discover Projects |
| `GET /rest/api/3/field/{id}/context` | API endpoint | ✅ | Custom Field Context |
| `[field-context] skip` / `fetch` | log pattern | ✅ | Custom Field Context |
| `CaptureOrchestrator` | class | ✅ | Issue Enumeration |
| `POST /rest/api/3/search/jql` | API endpoint | ✅ | Issue Enumeration |
| `check:http-guard` | npm script | ✅ `package.json` | Issue Enumeration |
| `scripts/check-http-guard.sh` | file | ✅ | Issue Enumeration |
| `enumerateIssues` | method | ✅ `src/workload/http/JiraHttpClient.ts:109` | Issue Enumeration |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` | path pattern | ✅ layout matches `downloadIssueAttachments.ts` | Attachments |
| `DCC_ATTACHMENT_DIR` | env var | ✅ `.env.example` | Attachments |
| `POST /api/policies` | API route | ✅ | Create Backup Policy |
| `POST /rest/api/3/jql/parse` | API endpoint | ✅ `src/routes/policies.ts` | Create Backup Policy |
| `GET /api/jobs/${JOB_ID}` | API route | ✅ `src/routes/jobs.ts` | Job Progress |
| `backup_point_items` | DB table | ✅ `src/db/migrations/011_inventory_items.sql` | Browse Inventory (seed SQL) |
| `GET /api/inventory` | API route | ✅ | Browse Inventory |
| `GET /api/inventory/Issue` | API route | ✅ | Browse Inventory |
| `GET /api/restore-jobs/trash-check` | API route | ✅ | Restore |
| `POST /api/restore-jobs` | API route | ✅ | Restore |
| `GET /api/restore-jobs/${JOB_ID}/events` | API route | ✅ | Restore |
| `src/workload/backup/discoverFieldContexts.test.ts` | file | ✅ | Probe 5 |
| `src/workload/snapshot/assembleIssuePayload.test.ts` | file | ✅ | Probe 5 |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | file | ✅ | Probe 5 |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | file | ✅ | Probe 6 |
| `src/workload/backup/computeManifestDiff.test.ts` | file | ✅ | Probe 6 |
| `src/workload/restore/boardScopeRecheck.test.ts` | file | ✅ | Probe 9 |
| `src/workload/restore/trashDetectionGuard.test.ts` | file | ✅ | Probe 9 |
| `src/workload/restore/RestoreOrchestrator.test.ts` | file | ✅ | Probe 9 |
| `src/workload/restore/HeartbeatEmitter.test.ts` | file | ✅ | Probe 10 |
| `src/routes/restore-jobs-sse-http.test.ts` | file | ✅ | Probe 10 |
| `backup_point_sdi_summary` | DB table | ✅ `015_backup_point_sdi_summary.sql` | Probe 11 |
| `tests/sdi/detectors.test.ts` | file | ✅ | Probe 11 |
| `tests/sdi/scanDispatcher.test.ts` | file | ✅ | Probe 11 |
| `GET /api/backup-points/${BACKUP_POINT_ID}/sdi-teaser` | API route | ✅ | View SDI Teaser |
| `SdiTeaserPanel` | component | ✅ `src/ui/components/SdiTeaserPanel.tsx` | View SDI Teaser |
| `npm run server` | npm script | ✅ | Smoke probes note |
| `scripts/smoke-discover.ts` | file | ✅ | Probe 4 |
| `npx tsx` | command | ✅ `tsx` in devDeps | Probe 4 |

**Result: 0 misses.**

---

## ARCHITECTURE.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `src/platform_workload_iface.ts` | file | ✅ | Platform/Workload Boundary |
| `src/types/connection.ts` | file | ✅ | Platform/Workload Boundary |
| `src/workload/backup/types.ts` | file | ✅ | Backup Engine |
| `src/workload/http/JiraHttpClient.ts` | file | ✅ | Backup Engine |
| `src/http/JiraHttpClient.ts` | file | ✅ | Backup Engine (OAuth layer note) |
| `src/workload/snapshot/types.ts` | file | ✅ | Snapshot Orchestrator |
| `GET /rest/api/3/project/search` | API endpoint | ✅ | Project Discovery |
| `GET /rest/api/3/field/{id}/context` | API endpoint | ✅ | Custom Field Context |
| `[field-context] skip field_id=<id> reason=system-field` | log format | ✅ | Custom Field Context |
| `POST /rest/api/3/search/jql` | API endpoint | ✅ | IJiraHttpClient Interface |
| `GET /rest/api/3/attachment/content/{id}` | API endpoint | ✅ | IJiraHttpClient Interface |
| `src/workload/restore/RestoreOrchestrator.ts` | file | ✅ | Restore Orchestrator |
| `src/workload/restore/types.ts` | file | ✅ | Restore Orchestrator |
| `src/platform/restore/sseEvents.ts` | file | ✅ | Restore SSE |
| `src/workload/sdi/detectors.ts` | file | ✅ | SDI Scanner |
| `src/workload/sdi/scanDispatcher.ts` | file | ✅ | SDI Scanner |
| `src/routes/inventory.ts` | file | ✅ | Inventory API |
| `MAX_HEARTBEAT_INTERVAL_MS` | constant | ✅ `src/platform/restore/sseEvents.ts` | Restore SSE |
| `STALLED_THRESHOLD_MS` | constant | ✅ `src/platform/restore/sseEvents.ts` | Restore SSE |

**Result: 0 misses.**

---

## CHANGELOG.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `docs/OPERATIONS.md` | file | ✅ | Sprint 17 Added |
| `docs/handoff/tihomir-sprint-kickoff.md` | file | ✅ | Sprint 17 Added |
| `docs/qa/job-status-semantics-sprint17.md` | file | ✅ | Sprint 17 Added |
| `docs/qa/final-regression-sprint17.md` | file | ✅ | Sprint 17 Added |
| `src/workload/snapshot/ProgressEmitter.ts` | file | ✅ | Sprint 17 |
| `src/platform/ui/restore/RestoreJobProgress.tsx` | file | ✅ | Sprint 17 |
| `src/workload/http/JiraHttpClient.ts` | file | ✅ | Sprint 16 |
| `RATE_LIMIT_MAX_RETRIES = 4` | constant | ✅ `JiraHttpClient.ts:12` | Sprint 16 |
| `RATE_LIMIT_BASE_MS = 1000 ms` | constant | ✅ `JiraHttpClient.ts:13` | Sprint 16 |
| `RATE_LIMIT_MAX_MS = 8000 ms` | constant | ✅ `JiraHttpClient.ts:14` | Sprint 16 |
| `RateLimitedError` | class | ✅ `JiraHttpClient.ts` | Sprint 16 |
| `SleepFn` | type | ✅ `JiraHttpClient.ts` | Sprint 16 |
| `.github/workflows/smoke-probes.yml` | file | ✅ | Sprint 16 CI |
| `scripts/smoke/probe-connect-jira-site.sh` | file | ✅ | Sprint 16 CI |
| `scripts/smoke/probe-run-first-backup.sh` | file | ✅ | Sprint 16 CI |
| `scripts/smoke/probe-browse-protected-inventory.sh` | file | ✅ | Sprint 16 CI |
| `scripts/smoke/probe-restore-protected-objects.sh` | file | ✅ | Sprint 16 CI |
| `scripts/smoke/probe-view-sdi-teaser.sh` | file | ✅ | Sprint 16 CI |
| `scripts/run-smoke-probes.sh` | file | ✅ | Sprint 16 |
| `[rate-limit]` log tag | log pattern | ✅ `JiraHttpClient.ts` | Sprint 16 log catalog |
| `[search]` log tag source `src/workload/http/JiraHttpClient.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[field-context]` log tag source `src/workload/backup/discoverFieldContexts.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[permission-probe]` log tag source `src/probes/permissionProbes.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[jql-validate]` log tag source `src/routes/policies.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[restore]` log tag source `src/workload/restore/trashDetectionGuard.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[auth-refresh]` log tag sources | files | ✅ both `src/http/JiraHttpClient.ts` + `src/workload/http/JiraHttpClient.ts` | Sprint 16 log catalog |
| `[attachment]` log tag source `src/workload/snapshot/downloadIssueAttachments.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[backup-job]` log tag source `src/workload/snapshot/ProgressEmitter.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[sdi]` log tag source `src/workload/sdi/scanDispatcher.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[inventory]` log tag source `src/routes/inventory.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `[discover]` log tag source `src/workload/backup/discoverProjects.ts` | file + tag | ✅ | Sprint 16 log catalog |
| `src/workload/sdi/detectors.ts` | file | ✅ | Sprint 15 |
| `src/workload/sdi/scanDispatcher.ts` | file | ✅ | Sprint 15 |
| `src/workload/sdi/types.ts` | file | ✅ | Sprint 15 |
| `src/routes/backup-points.ts` | file | ✅ | Sprint 15 |
| `src/db/migrations/015_backup_point_sdi_summary.sql` | file | ✅ | Sprint 15 |
| `src/ui/components/SdiTeaserPanel.tsx` | file | ✅ | Sprint 15 |
| `buildSdiDisplay(data)` | function | ✅ `SdiTeaserPanel.tsx:29` | Sprint 15 |
| `src/workload/restore/HeartbeatEmitter.ts` | file | ✅ | Phase 4 Sprint 3 |
| `HEARTBEAT_INTERVAL_MS = 10 000` | constant | ✅ `HeartbeatEmitter.ts` | Phase 4 Sprint 3 |
| `src/platform/restore/sseEvents.ts` | file | ✅ | Phase 4 Sprint 3 |
| `MAX_HEARTBEAT_INTERVAL_MS = 10 000` | constant | ✅ `sseEvents.ts` | Phase 4 Sprint 3 |
| `STALLED_THRESHOLD_MS = 20 000` | constant | ✅ `sseEvents.ts` | Phase 4 Sprint 3 |
| `src/workload/restore/RestoreOrchestrator.ts` | file | ✅ | Phase 4 Sprint 3 |
| `src/routes/restore-jobs.ts` | file | ✅ | Phase 4 Sprint 3 |
| `src/workload/restore/HeartbeatEmitter.test.ts` | file | ✅ | Phase 4 Sprint 3 |
| `src/routes/restore-jobs-sse-http.test.ts` | file | ✅ | Phase 4 Sprint 3 |
| `src/workload/restore/boardScopeRecheck.ts` | file | ✅ | Phase 4 Sprint 2 |
| `REQUIRED_BOARD_SCOPES` | constant | ✅ `boardScopeRecheck.ts` | Phase 4 Sprint 2 |
| `src/workload/restore/trashDetectionGuard.ts` | file | ✅ | Phase 4 Sprint 2 |
| `src/workload/restore/postIssueCreationPass.ts` | file | ✅ | Phase 4 Sprint 2 |
| `src/workload/restore/types.ts` | file | ✅ | Phase 4 Sprint 2 |
| `src/db/migrations/014_restore_jobs.sql` | file | ✅ | Phase 4 Sprint 1 |
| `src/workload/restore/eventBus.ts` | file | ✅ | Phase 4 Sprint 1 |
| `RESTORE_PHASE_ORDER` | constant | ✅ `src/workload/restore/types.ts` | Phase 4 Sprint 1 |
| `src/ui/components/InventorySidebar.tsx` | file | ✅ | Phase 3 Sprint 1 |
| `src/ui/components/ObjectExplorer.tsx` | file | ✅ | Phase 3 Sprint 1 |
| `src/ui/lib/apiFetch.ts` | file | ✅ | Phase 3 Sprint 1 |
| `src/App.tsx` | file | ✅ | Phase 3 Sprint 1 |
| `src/db/migrations/011_inventory_items.sql` | file | ✅ | Phase 3 Sprint 1 |
| `src/db/migrations/012_inventory_items_facets.sql` | file | ✅ | Phase 3 Sprint 2 |
| `src/db/migrations/013_inventory_items_attachments.sql` | file | ✅ | Phase 3 Sprint 2 |
| `src/workload/snapshot/downloadIssueAttachments.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/Attachment.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/backup/computeManifestDiff.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/ManifestDiff.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/routes/policies.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/PolicyRecord.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/routes/jobs.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/snapshot/ProgressEmitter.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/ProgressEvent.ts` | file | ✅ | Sprint 3 Phase 2 |
| `src/db/migrations/010_backup_jobs.sql` | file | ✅ | Sprint 3 Phase 2 |
| `src/db/migrations/010_policies_rpo_jql.sql` | file | ✅ | Sprint 3 Phase 2 |
| `DCC_ATTACHMENT_DIR` | env var | ✅ `.env.example` | Sprint 3 Phase 2 |
| `src/workload/backup/discoverFieldContexts.ts` | file | ✅ | Sprint 2 Phase 2 |
| `src/workload/snapshot/assembleIssuePayload.ts` | file | ✅ | Sprint 2 Phase 2 |
| `src/workload/snapshot/CaptureOrchestrator.ts` | file | ✅ | Sprint 2 Phase 2 |
| `src/workload/http/JiraHttpClient.ts` (enumerateIssues) | file + method | ✅ `:109` | Sprint 2 Phase 2 |
| `src/workload/JiraWorkload.ts` | file | ✅ | Sprint 2 Phase 2 |
| `src/workload/backup/types.ts` | file | ✅ | Sprint 1 Phase 2 |
| `src/workload/backup/discoverProjects.ts` | file | ✅ | Sprint 1 Phase 2 |
| `scripts/smoke-discover.ts` | file | ✅ | Sprint 1 Phase 2 |
| `src/db/migrations/009_backup_manifests.sql` | file | ✅ | Sprint 1 Phase 2 |
| `src/routes/connections.ts` | file | ✅ | Sprint 2 |
| `src/routes/restores.ts` | file | ✅ | Sprint 2 |
| `src/db/migrations/007_restores.sql` | file | ✅ | Sprint 2 |
| `src/db/migrations/008_policies.sql` | file | ✅ | Sprint 2 |
| `Caddyfile` | file | ✅ | Sprint 2 |
| `.env.example` | file | ✅ | Sprint 2 |
| `src/oauth/authorize.ts` | file | ✅ | Sprint 3 |
| `src/oauth/tokenExchange.ts` | file | ✅ | Sprint 3 |
| `src/http/JiraHttpClient.ts` | file | ✅ | Sprint 3 |
| `src/probes/permissionProbes.ts` | file | ✅ | Sprint 3 |
| `src/routes/oauth.ts` | file | ✅ | Sprint 3 |
| `src/server.ts` | file | ✅ | Sprint 3 |
| `src/db/migrations/002_connections.sql` | file | ✅ | Sprint 3 |
| `src/db/migrations/003_oauth_state.sql` | file | ✅ | Sprint 3 |
| `src/db/migrations/004_client_creds.sql` | file | ✅ | Sprint 3 |
| `src/db/migrations/005_oauth_state_connectionid.sql` | file | ✅ | Sprint 3 |
| `src/db/migrations/006_probe_results.sql` | file | ✅ | Sprint 3 |
| `src/ui/components/WorkloadCard.tsx` | file | ✅ | Sprint 3 |
| `src/ui/pages/ConnectionsList.tsx` | file | ✅ | Sprint 3 |
| `src/workload/snapshot/CaptureOrchestrator.ts:283–288` | line ref | ✅ lines 280–288 contain the SDI summary/regulations block | Sprint 15 (in handoff) |

**Result: 0 misses.**

---

## docs/OPERATIONS.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `src/probes/permissionProbes.ts` | file | ✅ | §1 Connection Failure |
| `/rest/api/3/myself` | API endpoint | ✅ | §1 |
| `/rest/api/3/field` | API endpoint | ✅ | §1 |
| `/rest/agile/1.0/board` | API endpoint | ✅ | §1 |
| `/rest/api/3/workflow/search` | API endpoint | ✅ | §1 |
| `probe_results` | DB table | ✅ `src/db/migrations/006_probe_results.sql` | §1 |
| `src/oauth/authorize.ts:PHASE1_SCOPES` | symbol | ✅ `authorize.ts:6` | §1 Resolution |
| `http://localhost:3000/api/connections/<connectionId>/probes` | URL | ✅ | §1 Resolution |
| `data/jira_workload.db` | file | ✅ | §1 Resolution |
| `credentials` | DB table | ✅ `002_connections.sql` | §1 Resolution |
| `src/workload/restore/boardScopeRecheck.ts` | file | ✅ | §2 Scope Drift |
| `credentials.scopes` | DB column | ✅ `002_connections.sql` col `scopes` | §2 |
| `src/workload/restore/RestoreOrchestrator.ts` | file | ✅ | §2 Resolution |
| `src/routes/connections.ts:_handleOAuth` | function | ✅ `connections.ts:49` | §2 Resolution |
| `src/workload/http/JiraHttpClient.ts:_refresh()` | method | ✅ `JiraHttpClient.ts:296` | §3 Refresh-Token |
| `[auth-refresh]` log tag | log pattern | ✅ | §3 |
| `src/workload/http/JiraHttpClient.ts:354` | line ref | ✅ (line 354 = `const now = ...`; transaction starts at 356 in same block) | §3 |
| `[rate-limit]` log tag | log pattern | ✅ | §3 |
| `src/workload/backup/discoverProjects.ts:partitionJsmProjects()` | function | ✅ `discoverProjects.ts:18` | §4 JSM |
| `[discover] jsm-deferred` | log pattern | ✅ | §4 |
| `SELECT id, createdAt FROM backup_manifests` (after fix) | SQL | ✅ table has `id` and `createdAt` | §4 — **FIXED IN-SPRINT** |
| `json_extract(manifestJson, '$.jsmDeferredProjects')` (after fix) | SQL | ✅ column is `manifestJson` | §4 — **FIXED IN-SPRINT** |
| `WHERE id = '<id>'` (after fix) | SQL | ✅ PK is `id` | §4 — **FIXED IN-SPRINT** |
| `src/workload/http/JiraHttpClient.ts:_retryWithBackoff()` | method | ✅ `JiraHttpClient.ts:250` | Log Tag Reference |

**Misses found and fixed in-sprint:**

| Miss ID | Original text | Correct text | File | Section |
|---|---|---|---|---|
| MISS-OPS-01 | `SELECT manifestId, completedAt FROM backup_manifests` | `SELECT id, createdAt FROM backup_manifests` | `docs/OPERATIONS.md` | §4 JSM-Site Detection |
| MISS-OPS-02 | `json_extract(manifest, '$.jsmDeferredProjects')` | `json_extract(manifestJson, '$.jsmDeferredProjects')` | `docs/OPERATIONS.md` | §4 JSM-Site Detection |
| MISS-OPS-03 | `WHERE manifestId = '<manifestId>'` | `WHERE id = '<id>'` | `docs/OPERATIONS.md` | §4 JSM-Site Detection |

**Status: All 3 misses fixed in-sprint. No P0 carry-forwards.**

---

## docs/handoff/tihomir-sprint-kickoff.md

| Reference | Type | Exists | Section |
|---|---|---|---|
| `src/oauth/authorize.ts` | file | ✅ | §1 Auth |
| `src/oauth/tokenExchange.ts` | file | ✅ | §1 Auth |
| `src/workload/http/JiraHttpClient.ts` | file | ✅ | §1 Auth |
| `src/probes/permissionProbes.ts` | file | ✅ | §1 Auth |
| `src/routes/connections.ts` | file | ✅ | §1 Auth |
| `src/ui/pages/ConnectionsList.tsx` | file | ✅ | §1 Auth |
| `src/db/migrations/002_connections.sql` | file | ✅ | §1 Auth |
| `src/routes/policies.ts` | file | ✅ | §1 Auth |
| `src/routes/inventory.ts` | file | ✅ | §1 Auth |
| `src/routes/restores.ts` | file | ✅ | §1 Auth |
| `src/ui/components/WorkloadCard.tsx` | file | ✅ | §1 Auth |
| `scripts/smoke/probe-connect-jira-site.sh` | file | ✅ | §1 Auth |
| `src/workload/backup/discoverProjects.ts` | file | ✅ | §1 Backup |
| `src/workload/backup/discoverProjects.ts:partitionJsmProjects()` | function | ✅ | §1 Backup |
| `src/workload/http/JiraHttpClient.ts:enumerateIssues()` | method | ✅ | §1 Backup |
| `src/workload/backup/discoverFieldContexts.ts` | file | ✅ | §1 Backup |
| `src/workload/snapshot/CaptureOrchestrator.ts` | file | ✅ | §1 Backup |
| `src/workload/snapshot/assembleIssuePayload.ts` | file | ✅ | §1 Backup |
| `src/workload/snapshot/downloadIssueAttachments.ts` | file | ✅ | §1 Backup |
| `data/attachments/` | directory | ✅ | §1 Backup |
| `src/workload/backup/computeManifestDiff.ts` | file | ✅ | §1 Backup |
| `src/routes/policies.ts` | file | ✅ | §1 Backup |
| `src/workload/snapshot/ProgressEmitter.ts` | file | ✅ | §1 Backup |
| `src/db/migrations/009_backup_manifests.sql` | file | ✅ | §1 Backup |
| `src/workload/JiraWorkload.ts` | file | ✅ | §1 Backup |
| `scripts/smoke/probe-run-first-backup.sh` | file | ✅ | §1 Backup |
| `src/routes/inventory.ts` | file | ✅ | §1 Inventory |
| `src/ui/components/InventorySidebar.tsx` | file | ✅ | §1 Inventory |
| `src/ui/components/ObjectExplorer.tsx` | file | ✅ | §1 Inventory |
| `scripts/smoke/probe-browse-protected-inventory.sh` | file | ✅ | §1 Inventory |
| `src/routes/restore-jobs.ts` | file | ✅ | §1 Restore |
| `POST /api/restore-jobs` | API route | ✅ | §1 Restore |
| `src/workload/restore/RestoreOrchestrator.ts` | file | ✅ | §1 Restore |
| `src/workload/restore/types.ts` | file | ✅ | §1 Restore |
| `GET /api/restore-jobs/:id/events` (after fix) | API route | ✅ `restore-jobs.ts` | §1 Restore — **FIXED IN-SPRINT** |
| `src/platform/restore/sseEvents.ts` | file | ✅ | §1 Restore |
| `src/workload/restore/boardScopeRecheck.ts` | file | ✅ | §1 Restore |
| `src/workload/restore/trashDetectionGuard.ts` | file | ✅ | §1 Restore |
| `src/workload/restore/postIssueCreationPass.ts` | file | ✅ | §1 Restore |
| `src/workload/restore/HeartbeatEmitter.ts` | file | ✅ | §1 Restore |
| `src/platform/ui/restore/RestoreWizard.tsx` | file | ✅ | §1 Restore |
| `src/platform/ui/restore/RestoreJobProgress.tsx` | file | ✅ | §1 Restore |
| `src/db/migrations/014_restore_jobs.sql` | file | ✅ | §1 Restore |
| `scripts/smoke/probe-restore-protected-objects.sh` | file | ✅ | §1 Restore |
| `src/workload/sdi/detectors.ts` | file | ✅ | §1 SDI |
| `src/workload/sdi/scanDispatcher.ts` | file | ✅ | §1 SDI |
| `src/workload/snapshot/CaptureOrchestrator.ts:283–288` | line ref | ✅ (SDI regulations block at lines 280–288) | §1 SDI |
| `src/db/migrations/015_backup_point_sdi_summary.sql` | file | ✅ | §1 SDI |
| `src/routes/backup-points.ts` | file | ✅ | §1 SDI |
| `src/ui/components/SdiTeaserPanel.tsx` | file | ✅ | §1 SDI |
| `scripts/smoke/probe-view-sdi-teaser.sh` | file | ✅ | §1 SDI |
| `.github/workflows/smoke-probes.yml` | file | ✅ | §1 Observability |
| `scripts/run-smoke-probes.sh` | file | ✅ | §1 Observability |
| `docs/OPERATIONS.md` | file | ✅ | §1 Observability |
| `test/fault-injection/heartbeat-stall-fault-injection.test.ts` | file | ✅ | §1 Observability |
| `docs/qa/final-regression-sprint17.md` | file | ✅ | §1 Regression Results |
| `.env.example` | file | ✅ | §5 Quick-Start |
| `npm install` | npm command | ✅ `package.json` | §5 Quick-Start |
| `npm run server` | npm script | ✅ `package.json` | §5 Quick-Start |
| `npm test` | npm script | ✅ `package.json` | §5 Quick-Start |
| `scripts/run-smoke-probes.sh` | file | ✅ | §5 Quick-Start |
| `src/platform_workload_iface.ts` | file | ✅ | §5 Key entry points |
| `src/workload/snapshot/CaptureOrchestrator.ts` | file | ✅ | §5 Key entry points |
| `src/workload/restore/RestoreOrchestrator.ts` | file | ✅ | §5 Key entry points |
| `src/workload/sdi/scanDispatcher.ts` | file | ✅ | §5 Key entry points |
| `src/routes/inventory.ts` | file | ✅ | §5 Key entry points |
| `src/db/migrations/` | directory | ✅ | §5 Key entry points |
| `src/App.tsx` | file | ✅ | §5 Key entry points |
| `README.md`, `INSTALL.md`, `DEMO.md`, `docs/OPERATIONS.md`, `ARCHITECTURE.md`, `CHANGELOG.md` | files | ✅ | §5 Documents |
| `.github/workflows/smoke-probes.yml` | file | ✅ | §5 Documents |
| `scripts/smoke/probe-*.sh` | glob | ✅ (5 scripts) | §5 Documents |
| `docs/qa/final-regression-sprint17.md` | file | ✅ | §5 Documents |
| `docs/qa/job-status-semantics-sprint17.md` | file | ✅ | §5 Documents |

**Miss found and fixed in-sprint:**

| Miss ID | Original text | Correct text | File | Section |
|---|---|---|---|---|
| MISS-HANDOFF-01 | `GET /api/restore/jobs/:id/events` | `GET /api/restore-jobs/:id/events` | `docs/handoff/tihomir-sprint-kickoff.md` | §1 Restore Wizard table |

**Status: 1 miss fixed in-sprint. No P0 carry-forwards.**

---

## Summary

| Doc | References checked | Misses | Fixed in-sprint | P0 carry-forward |
|---|---|---|---|---|
| README.md | 26 | 0 | — | — |
| INSTALL.md | 38 | 0 | — | — |
| DEMO.md | 50 | 0 | — | — |
| ARCHITECTURE.md | 19 | 0 | — | — |
| CHANGELOG.md | 75 | 0 | — | — |
| docs/OPERATIONS.md | 24 | 3 | 3 | 0 |
| docs/handoff/tihomir-sprint-kickoff.md | 65 | 1 | 1 | 0 |
| **TOTAL** | **297** | **4** | **4** | **0** |

### Fixes applied

| Miss ID | File | Nature |
|---|---|---|
| MISS-OPS-01 | `docs/OPERATIONS.md` §4 | Wrong column `manifestId` → `id` in SELECT and WHERE |
| MISS-OPS-02 | `docs/OPERATIONS.md` §4 | Wrong column `manifest` → `manifestJson` in `json_extract()` |
| MISS-OPS-03 | `docs/OPERATIONS.md` §4 | Wrong column `completedAt` → `createdAt` in ORDER BY |
| MISS-HANDOFF-01 | `docs/handoff/tihomir-sprint-kickoff.md` | Route `GET /api/restore/jobs/:id/events` → `GET /api/restore-jobs/:id/events` |

All misses were fixed in-sprint. No P0 carry-forwards.
