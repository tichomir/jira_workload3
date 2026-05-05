# Doc-Grounding Report — Sprint Maintenance (Restore podman-compose runtime)

_Generated: 2026-05-05 | QA Engineer Persona_

## Scope

Full verification of all six canonical docs against the on-disk codebase state after the Sprint Maintenance delivery. This report also confirms closure of all P0 carry-forwards from Sprint 18 and validates the new files introduced this sprint (`podman-compose.yml`, `Caddyfile.compose`, `start.sh`).

---

## P0 Carry-Forward Status from Sprint 18

Sprint 18 doc-grounding report stated: **"P0 Carry-Forwards: None."**

All previously tracked P0s (entities.xml, search/jql, probe-*.sh port numbers, InventoryRepository.ts refs, OPERATIONS.md src/* refs) were resolved in Sprint 18. This sprint introduces no regressions against those items.

✅ **All prior P0 carry-forwards confirmed closed.**

---

## New Files Introduced — Internal Reference Check

| New file | Internal references | All resolve? |
|---|---|---|
| `podman-compose.yml` | `Dockerfile`, `.env`, `./Caddyfile.compose`, `caddy:2-alpine` (external image) | ✅ All on-disk refs exist |
| `Caddyfile.compose` | `app:4000` (Docker service name — runtime) | ✅ Correct |
| `start.sh` | `.env.example`, `.env`, `http://localhost:4000/health` | ✅ All on-disk refs exist |

---

## README.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `npm install` | ✅ standard npm | Quick Start |
| `npm run build` | ✅ `package.json` scripts | Quick Start |
| `npm run server` | ✅ `package.json` scripts | Quick Start |
| `npm run test` | ✅ `package.json` scripts | Quick Start |
| `http://localhost:4000/health` | ✅ `GET /health` in `src/server.ts:29` | Quick Start |
| `INSTALL.md` | ✅ file exists | Quick links |
| `DEMO.md` | ✅ file exists | Quick links |
| `ARCHITECTURE.md` | ✅ file exists | Quick links |
| `CHANGELOG.md` | ✅ file exists | Quick links |
| `docs/OPERATIONS.md` | ✅ file exists | Quick links |
| `GET /rest/api/3/field/{id}/context` | ✅ Atlassian API called in `src/workload/backup/discoverFieldContexts.ts` | What is built |
| `[field-context] skip` | ✅ log format in `src/workload/backup/discoverFieldContexts.ts` | What is built |
| `CaptureOrchestrator` | ✅ `src/workload/snapshot/CaptureOrchestrator.ts` | What is built |
| `PlatformWorkloadInterface` | ✅ `src/platform_workload_iface.ts` | What is built |
| `BackupManifest` | ✅ `src/workload/backup/types.ts` | What is built |
| `backup_manifests` | ✅ SQLite table (migration `009_backup_manifests.sql`) | What is built |
| `src/workload/http/JiraHttpClient.ts` | ✅ file exists | What is built |
| `scripts/check-http-guard.sh` | ✅ file exists | What is built |
| `JiraWorkload.discover()` | ✅ `src/workload/JiraWorkload.ts` | What is built |
| `WorkloadCard` | ✅ `src/ui/components/WorkloadCard.tsx` | What is built |
| `ConnectionsList` | ✅ `src/ui/pages/ConnectionsList.tsx` | What is built |
| `Caddyfile` | ✅ file exists at project root | What is built |

---

## INSTALL.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `npm install` | ✅ standard npm | §1 |
| `npm run build` | ✅ `package.json` scripts | §1 |
| `.env.example` | ✅ file exists | §2 |
| `ATLASSIAN_CLIENT_ID` | ✅ `.env.example` key | §2 |
| `ATLASSIAN_CLIENT_SECRET` | ✅ `.env.example` key | §2 |
| `OAUTH_REDIRECT_URI` | ✅ `.env.example` key | §2 |
| `PORT` | ✅ `.env.example` key (default `4000`) | §2 |
| `DCC_ATTACHMENT_DIR` | ✅ `.env.example` key | §2 |
| `Caddyfile` | ✅ file exists, `localhost:4000` target correct | §2 HTTPS |
| `caddy run` | ✅ standard Caddy CLI command | §2 HTTPS |
| `OAUTH_REDIRECT_URI=https://localhost/api/oauth/callback` | ✅ `.env.example` documents this value | §2 HTTPS |
| `npx tsx src/db/database.ts` | ✅ `src/db/database.ts` exists; `tsx` in `devDependencies` | §3 |
| `podman-compose.yml` | ✅ file exists (added this sprint) | §4 |
| `./start.sh` | ✅ file exists (added this sprint) | §4 |
| `podman-compose up -d` | ✅ runtime command — called by `start.sh` | §4 |
| `http://localhost:4000/health` | ✅ `GET /health` endpoint in `src/server.ts:29` | §4 |
| `podman-compose logs -f app` | ✅ valid compose runtime command | §4 |
| `podman-compose down` | ✅ valid compose runtime command | §4 |
| `npm run server` | ✅ `package.json` scripts | §4 alternative |
| `npm run dev` | ✅ `package.json` scripts | §4 alternative |
| `https://localhost` | ✅ Caddy TLS endpoint (via compose or bare `caddy run`) | §4 |
| `http://localhost:5173` | ✅ Vite dev server default port | §4 alternative |
| `curl -sf http://localhost:4000/health` | ✅ `/health` endpoint live | §5 |
| `{"status":"ok"}` | ✅ confirmed return value in `src/server.ts:29` | §5 |
| `curl -sf http://localhost:4000/api/connections` | ✅ endpoint registered | §5 |
| `npm run test` | ✅ `package.json` scripts | §5a |
| `.github/workflows/smoke-probes.yml` | ✅ file exists | §6 |
| `JIRA_SANDBOX_CLIENT_ID` | ✅ CI secret (external, documented) | §6 |
| `JIRA_SANDBOX_CLIENT_SECRET` | ✅ CI secret (external, documented) | §6 |
| `JIRA_SANDBOX_OAUTH_REDIRECT_URI` | ✅ CI secret (external, documented) | §6 |
| `bash scripts/run-smoke-probes.sh` | ✅ file exists | §6 |
| `scripts/smoke/probe-connect-jira-site.sh` | ✅ file exists | §6 |
| `scripts/smoke/probe-run-first-backup.sh` | ✅ file exists | §6 |
| `scripts/smoke/probe-browse-protected-inventory.sh` | ✅ file exists | §6 |
| `scripts/smoke/probe-restore-protected-objects.sh` | ✅ file exists | §6 |
| `scripts/smoke/probe-view-sdi-teaser.sh` | ✅ file exists | §6 |
| `docs/OPERATIONS.md` | ✅ file exists | §8 |
| `PORT` default `4000` | ✅ `src/server.ts:14` and `.env.example` | §2, §4, §7 |

---

## DEMO.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `.env.example` | ✅ file exists | Prerequisites |
| `./start.sh` | ✅ file exists | Prerequisites |
| `http://localhost:4000/health` | ✅ `/health` endpoint in `src/server.ts:29` | Prerequisites |
| `INSTALL.md` | ✅ file exists | Prerequisites |
| `ATLASSIAN_CLIENT_ID` | ✅ `.env.example` key | Prerequisites |
| `ATLASSIAN_CLIENT_SECRET` | ✅ `.env.example` key | Prerequisites |
| `OAUTH_REDIRECT_URI` | ✅ `.env.example` key | Prerequisites |
| `PORT=${PORT:-4000}` | ✅ matches server default | All smoke probes |
| `http://localhost:4000` | ✅ server listens on 4000 | All smoke probes |
| `backup_manifests` table | ✅ SQLite migration `009_backup_manifests.sql` | Discover Projects |
| `podman-compose exec app sqlite3 /app/data/jira_workload.db` | ✅ `podman-compose.yml` defines `app` service with `/app/data` volume | Probes 7, 11 |
| `GET /rest/api/3/field/{id}/context` | ✅ Atlassian API — called in `src/workload/backup/discoverFieldContexts.ts` | Custom Field Context |
| `[field-context] skip … reason=system-field` | ✅ log format in `src/workload/backup/discoverFieldContexts.ts` | Custom Field Context |
| `[field-context] fetch … contextCount=N` | ✅ log format in `src/workload/backup/discoverFieldContexts.ts` | Custom Field Context |
| `CaptureOrchestrator` | ✅ `src/workload/snapshot/CaptureOrchestrator.ts` | Issue Enumeration |
| `POST /rest/api/3/search/jql` | ✅ called in `src/workload/http/JiraHttpClient.ts` | Issue Enumeration |
| `check:http-guard` | ✅ `package.json` script → `scripts/check-http-guard.sh` | Issue Enumeration |
| `[search] endpoint=search/jql …` | ✅ log format in `src/workload/http/JiraHttpClient.ts` | Issue Enumeration |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` | ✅ `src/workload/types/Attachment.ts` | Attachments |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json` | ✅ `src/workload/types/Attachment.ts` | Attachments |
| `[attachment] op=download …` | ✅ log format in `src/workload/snapshot/downloadIssueAttachments.ts` | Attachments |
| `DCC_ATTACHMENT_DIR` | ✅ `.env.example` key | Attachments |
| `GET /api/jobs/:id` | ✅ `src/routes/jobs.ts` | Job Progress |
| `[backup-job] op=start …` | ✅ `src/workload/snapshot/ProgressEmitter.ts` | Job Progress |
| `SdiTeaserPanel` | ✅ `src/ui/components/SdiTeaserPanel.tsx` | View SDI Teaser |
| `GET /api/backup-points/:id/sdi-teaser` | ✅ `src/routes/backup-points.ts` | View SDI Teaser |
| `backup_point_sdi_summary` table | ✅ migration `015_backup_point_sdi_summary.sql` | Probe 11 |
| `backup_point_items` table | ✅ migration `011_inventory_items.sql` | Probe 7 |
| `scripts/smoke-discover.ts` | ✅ file exists | Probe 4 |
| `npx tsx scripts/smoke-discover.ts` | ✅ `tsx` in `devDependencies` | Probe 4 |
| `src/workload/backup/discoverFieldContexts.test.ts` | ✅ file exists | Probe 5 |
| `src/workload/snapshot/assembleIssuePayload.test.ts` | ✅ file exists | Probe 5 |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | ✅ file exists | Probe 5 |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | ✅ file exists | Probe 6 |
| `src/workload/backup/computeManifestDiff.test.ts` | ✅ file exists | Probe 6 |
| `src/workload/restore/boardScopeRecheck.test.ts` | ✅ file exists | Probe 9 |
| `src/workload/restore/trashDetectionGuard.test.ts` | ✅ file exists | Probe 9 |
| `src/workload/restore/RestoreOrchestrator.test.ts` | ✅ file exists | Probe 9 |
| `src/workload/restore/HeartbeatEmitter.test.ts` | ✅ file exists | Probe 10 |
| `src/routes/restore-jobs-sse-http.test.ts` | ✅ file exists | Probe 10 |
| `tests/sdi/detectors.test.ts` | ✅ file exists | Probe 11 |
| `tests/sdi/scanDispatcher.test.ts` | ✅ file exists | Probe 11 |
| `data/jira_workload.db` | ✅ file exists at `data/jira_workload.db` | Probes 7, 11 |

---

## ARCHITECTURE.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `src/platform_workload_iface.ts` | ✅ file exists | Platform/Workload Boundary |
| `src/types/connection.ts` | ✅ file exists | Platform/Workload Boundary |
| `src/workload/backup/types.ts` | ✅ file exists | Backup Engine |
| `src/workload/http/JiraHttpClient.ts` | ✅ file exists | Backup Engine |
| `src/http/JiraHttpClient.ts` | ✅ file exists (distinct OAuth-layer client) | Backup Engine |
| `src/workload/snapshot/types.ts` | ✅ file exists | Snapshot Orchestrator |
| `src/workload/http/JiraHttpClient.ts:134` | ✅ `[search]` format string at line 134 (verified Sprint 18) | Snapshot Orchestrator |
| `src/workload/types/Attachment.ts` | ✅ file exists | Attachment Storage |
| `src/workload/snapshot/downloadIssueAttachments.ts` | ✅ file exists | Attachment Storage |
| `src/workload/types/ManifestDiff.ts` | ✅ file exists | Manifest Deletion-Diff |
| `src/workload/restore/boardScopeRecheck.ts` | ✅ file exists | Restore Engine |
| `src/workload/restore/RestoreOrchestrator.ts` | ✅ file exists | Restore Engine |
| `src/workload/restore/trashDetectionGuard.ts` | ✅ file exists | Restore Engine |
| `src/workload/restore/HeartbeatEmitter.ts` | ✅ file exists | Restore Engine |
| `src/workload/restore/eventBus.ts` | ✅ file exists | Restore Engine |
| `src/workload/restore/types.ts` | ✅ file exists | Restore Engine |
| `src/probes/permissionProbes.ts` | ✅ file exists | Log Tag Reference |
| `src/routes/policies.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/backup/discoverFieldContexts.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/backup/discoverProjects.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/sdi/detectors.ts` | ✅ file exists | SDI Scanner |
| `src/workload/sdi/scanDispatcher.ts` | ✅ file exists | SDI Scanner |
| `src/workload/sdi/types.ts` | ✅ file exists | SDI Scanner |
| `src/routes/inventory.ts` | ✅ file exists | Inventory |
| `src/workload/snapshot/CaptureOrchestrator.ts` | ✅ file exists | Snapshot |
| `src/workload/snapshot/ProgressEmitter.ts` | ✅ file exists | Backup Job |

---

## CHANGELOG.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `podman-compose.yml` | ✅ file exists (added this sprint) | Sprint Maintenance |
| `Dockerfile` | ✅ file exists | Sprint Maintenance |
| `Caddyfile.compose` | ✅ file exists (added this sprint) | Sprint Maintenance |
| `start.sh` | ✅ file exists (added this sprint) | Sprint Maintenance |
| `.env.example` | ✅ file exists | Sprint Maintenance |
| `INSTALL.md §4` | ✅ section exists in INSTALL.md | Sprint Maintenance |
| `PORT` default `4000` | ✅ `.env.example` and `src/server.ts` | Sprint Maintenance |
| `src/routes/restore-guards-e2e.test.ts` | ✅ file exists | Sprint 18 |
| `src/routes/restore-jobs-phase-order.test.ts` | ✅ file exists | Sprint 18 |
| `src/workload/http/JiraHttpClient.ts` | ✅ file exists | Sprint 18 |
| `src/workload/JiraWorkload.ts` | ✅ file exists | Sprint 18 |
| `src/workload/snapshot/ProgressEmitter.ts` | ✅ file exists | Sprint 18 |
| `src/workload/restore/boardScopeRecheck.test.ts` | ✅ file exists | Sprint 18 |
| `src/workload/restore/trashDetectionGuard.test.ts` | ✅ file exists | Sprint 18 |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | ✅ file exists | Sprint 18 |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | ✅ file exists | Sprint 18 |
| `src/server.ts` | ✅ file exists | Sprint 18 |
| `.env.example` | ✅ file exists | Sprint 18 |
| `Caddyfile` | ✅ file exists | Sprint 18 |
| `docs/OPERATIONS.md` | ✅ file exists | Sprint 17 |
| `docs/handoff/tihomir-sprint-kickoff.md` | ✅ file exists | Sprint 17 |
| `docs/qa/job-status-semantics-sprint17.md` | ✅ file exists | Sprint 17 |
| `docs/qa/final-regression-sprint17.md` | ✅ file exists | Sprint 17 |
| `src/platform/ui/restore/RestoreJobProgress.tsx` | ✅ file exists | Sprint 17 |
| `.github/workflows/smoke-probes.yml` | ✅ file exists | Sprint 16 |
| `scripts/run-smoke-probes.sh` | ✅ file exists | Sprint 16 |
| `src/workload/sdi/detectors.ts` | ✅ file exists | Sprint 15 |
| `src/workload/sdi/scanDispatcher.ts` | ✅ file exists | Sprint 15 |
| `src/workload/sdi/types.ts` | ✅ file exists | Sprint 15 |

---

## docs/OPERATIONS.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `src/probes/permissionProbes.ts` | ✅ file exists | §1 Connection Failure |
| `src/oauth/authorize.ts` | ✅ file exists | §1 Connection Failure |
| `http://localhost:4000/api/connections/…/probes` | ✅ endpoint registered in `src/routes/connections.ts` | §1, §3 |
| `data/jira_workload.db` | ✅ file exists (non-compose path); compose path is `/app/data/jira_workload.db` via named volume | §1, §2, §4 |
| `src/workload/restore/boardScopeRecheck.ts` | ✅ file exists | §2 Scope Drift |
| `src/routes/connections.ts` | ✅ file exists | §2, §3 |
| `src/routes/connections.ts:_handleOAuth` | ✅ method `_handleOAuth` exists in file | §2, §3 |
| `src/workload/http/JiraHttpClient.ts:_refresh` | ✅ method `_refresh` exists | §3 Refresh-Token Rotation |
| `src/workload/http/JiraHttpClient.ts:354` | ⚠️ Minor: `db.transaction()` at lines 357–363; line 354 is `const now = …` within the same `_performRefresh()` — prose is correct | §3 |
| `src/workload/restore/RestoreOrchestrator.ts` | ✅ file exists | §2 |
| `src/workload/backup/discoverProjects.ts:partitionJsmProjects()` | ✅ function exists in file | §4 JSM Detection |
| `src/workload/http/JiraHttpClient.ts:enumerateIssues` | ✅ method exists | Log Tag Reference |
| `src/workload/backup/discoverFieldContexts.ts` | ✅ file exists | Log Tag Reference |
| `src/routes/policies.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/restore/trashDetectionGuard.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/restore/RestoreOrchestrator.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/backup/discoverProjects.ts` | ✅ file exists | Log Tag Reference |

---

## P0 Carry-Forwards — This Sprint

None. All references in all six canonical docs resolve to on-disk artifacts or are correctly marked Phase 2 / runtime-only.

---

## Minor Imprecision (not a P0, carried from Sprint 18)

| Doc | Reference | Note |
|---|---|---|
| `docs/OPERATIONS.md` §3 | `src/workload/http/JiraHttpClient.ts:354` | `db.transaction()` starts at line 357; line 354 is `const now = …` in the same `_performRefresh()` method. Prose description is accurate. Off by 3 lines — not worth a doc change mid-sprint. |

---

## Phase 2 Items (correctly deferred in docs)

| Feature | Doc reference | Status |
|---|---|---|
| `POST /api/snapshot` HTTP endpoint | DEMO.md | ✅ Correctly marked Phase 2 |
| ADF media link rewriting | DEMO.md, ARCHITECTURE.md | ✅ Correctly marked Phase 2 |
| HIPAA regulation tag | DEMO.md | ✅ Correctly hidden |
| Cross-site restore | DEMO.md | ✅ Correctly blocked |
| Blob storage export | DEMO.md | ✅ Correctly blocked |
| JSM objects | DEMO.md, OPERATIONS.md | ✅ Correctly deferred |
| Attachment sidecar read commands | DEMO.md | ✅ Correctly marked Phase 2 |

---

## Notes on Compose Stack Path

`INSTALL.md §4` correctly notes that the Vite dev server is not included in the compose stack and instructs operators to run `npm run dev` separately for the UI hot-reload path. The `Caddyfile.compose` only reverse-proxies `/api/*` to the `app` container; the browser UI requires the host Vite dev server at `http://localhost:5173` or a pre-built static bundle. This is a known runtime limitation, not a doc grounding issue — all referenced files exist and all commands are valid.
