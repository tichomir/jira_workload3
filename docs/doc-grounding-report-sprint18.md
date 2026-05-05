# Doc-Grounding Report — Sprint 18

_Generated: 2026-05-05 | QA Engineer Persona_

## DoD Verification

| Check | Status | Evidence |
|---|---|---|
| `npm run build` exits 0 | ✅ PASS | `tsc && vite build` — 49 modules, no errors |
| `npm run server` starts on port 4000 | ✅ PASS | `src/server.ts` defaults to `'4000'`, `GET /health → {"status":"ok"}` |
| `GET http://localhost:4000/health` returns 2xx | ✅ PASS | `curl -s http://localhost:4000/health` → `{"status":"ok"}` |
| Server alive ≥30 s | ✅ PASS | Two probes at t=3s and t=33s both return 200 |
| `npm run test` exits 0 | ✅ PASS | 32 test files, 533 tests — all pass |
| README.md states build/start/test commands | ✅ PASS | Quick Start block documents all three |
| INSTALL.md states build/start/test commands | ✅ PASS | §1 build, §4 start, §5a test |
| All port refs updated to 4000 | ✅ PASS | DEMO.md, OPERATIONS.md, smoke scripts updated this sprint |

---

## Fixes Applied This Verification Pass

The following doc-grounding gaps were repaired before this report was finalized:

| File | Gap | Fix Applied |
|---|---|---|
| `DEMO.md` | 13× `localhost:3000` references | Replaced with `localhost:4000` |
| `DEMO.md` | 8× `PORT=${PORT:-3000}` in inline smoke probes | Replaced with `PORT=${PORT:-4000}` |
| `docs/OPERATIONS.md` | 2× `localhost:3000` references | Replaced with `localhost:4000` |
| `scripts/smoke/probe-connect-jira-site.sh` | `PORT=${PORT:-3000}` | Replaced with `PORT=${PORT:-4000}` |
| `scripts/smoke/probe-run-first-backup.sh` | `PORT=${PORT:-3000}` | Replaced with `PORT=${PORT:-4000}` |
| `scripts/smoke/probe-browse-protected-inventory.sh` | `PORT=${PORT:-3000}` | Replaced with `PORT=${PORT:-4000}` |
| `scripts/smoke/probe-restore-protected-objects.sh` | `PORT=${PORT:-3000}` | Replaced with `PORT=${PORT:-4000}` |
| `scripts/smoke/probe-view-sdi-teaser.sh` | `PORT=${PORT:-3000}` | Replaced with `PORT=${PORT:-4000}` |

---

## README.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `npm install` | ✅ standard npm | Quick Start |
| `npm run build` | ✅ package.json scripts | Quick Start |
| `npm run server` | ✅ package.json scripts | Quick Start |
| `npm run test` | ✅ package.json scripts | Quick Start |
| `http://localhost:4000/health` | ✅ `GET /health` in `src/server.ts:29` | Quick Start |
| `INSTALL.md` | ✅ file exists | Quick links |
| `DEMO.md` | ✅ file exists | Quick links |
| `ARCHITECTURE.md` | ✅ file exists | Quick links |
| `CHANGELOG.md` | ✅ file exists | Quick links |
| `docs/OPERATIONS.md` | ✅ file exists | Quick links |
| `GET /rest/api/3/field/{id}/context` | ✅ Atlassian API — called in `discoverFieldContexts.ts` | What is built |
| `[field-context] skip` | ✅ log format in `src/workload/backup/discoverFieldContexts.ts` | What is built |
| `CaptureOrchestrator` | ✅ `src/workload/snapshot/CaptureOrchestrator.ts` | What is built |
| `PlatformWorkloadInterface` | ✅ `src/platform_workload_iface.ts` | What is built |
| `BackupManifest` | ✅ `src/workload/backup/types.ts` | What is built |
| `backup_manifests` | ✅ SQLite table (migrations) | What is built |
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
| `npm run build` | ✅ package.json scripts | §1 |
| `.env.example` | ✅ file exists | §2 |
| `ATLASSIAN_CLIENT_ID` | ✅ `.env.example` key | §2 |
| `ATLASSIAN_CLIENT_SECRET` | ✅ `.env.example` key | §2 |
| `OAUTH_REDIRECT_URI` | ✅ `.env.example` key | §2 |
| `PORT` | ✅ `.env.example` key (default 4000) | §2 |
| `DCC_ATTACHMENT_DIR` | ✅ `.env.example` key | §2 |
| `Caddyfile` (localhost:4000) | ✅ matches actual Caddyfile | §2 HTTPS |
| `npx tsx src/db/database.ts` | ✅ `src/db/database.ts` exists | §3 |
| `npm run server` | ✅ package.json scripts | §4 |
| `npm run dev` | ✅ package.json scripts | §4 |
| `curl -sf http://localhost:4000/health` | ✅ `/health` endpoint live | §5 |
| `{"status":"ok"}` response | ✅ confirmed by probe | §5 |
| `npm run test` | ✅ package.json scripts | §5a |
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

---

## DEMO.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `http://localhost:4000` (post-fix) | ✅ server listens on 4000 | Prerequisites |
| `PORT=${PORT:-4000}` (post-fix) | ✅ matches server default | All smoke probes |
| `ATLASSIAN_CLIENT_ID` | ✅ `.env.example` key | Prerequisites |
| `ATLASSIAN_CLIENT_SECRET` | ✅ `.env.example` key | Prerequisites |
| `OAUTH_REDIRECT_URI` | ✅ `.env.example` key | Prerequisites |
| `backup_manifests` table | ✅ SQLite table (migrations) | Discover Projects |
| `GET /rest/api/3/field/{id}/context` | ✅ Atlassian API | Custom Field Context |
| `[field-context] skip …` log format | ✅ `src/workload/backup/discoverFieldContexts.ts` | Custom Field Context |
| `[field-context] fetch …` log format | ✅ `src/workload/backup/discoverFieldContexts.ts` | Custom Field Context |
| `CaptureOrchestrator` | ✅ `src/workload/snapshot/CaptureOrchestrator.ts` | Issue Enumeration |
| `POST /rest/api/3/search/jql` | ✅ called in `JiraHttpClient.searchJql` | Issue Enumeration |
| `[search] endpoint=search/jql …` log format | ✅ `src/workload/http/JiraHttpClient.ts:134` | Issue Enumeration |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` | ✅ `src/workload/types/Attachment.ts` | Attachments |
| `[attachment] op=download …` log format | ✅ `src/workload/snapshot/downloadIssueAttachments.ts` | Attachments |
| `DCC_ATTACHMENT_DIR` | ✅ `.env.example` key | Attachments |
| `[backup-job] op=start …` log format | ✅ `src/workload/snapshot/ProgressEmitter.ts` | Job Progress |
| `GET /api/jobs/:id` | ✅ `src/routes/jobs.ts` | Job Progress |
| `SdiTeaserPanel` | ✅ `src/ui/components/SdiTeaserPanel.tsx` | View SDI Teaser |
| `GET /api/backup-points/:id/sdi-teaser` | ✅ `src/routes/backup-points.ts` | View SDI Teaser |
| `scripts/smoke-discover.ts` | ✅ file exists | Probe 4 |
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
| `data/jira_workload.db` | ✅ file exists | Probes 7, 11 |

---

## ARCHITECTURE.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
| `src/platform_workload_iface.ts` | ✅ file exists | Platform/Workload Boundary |
| `src/types/connection.ts` | ✅ file exists | Platform/Workload Boundary |
| `src/workload/backup/types.ts` | ✅ file exists | Backup Engine |
| `src/workload/http/JiraHttpClient.ts` | ✅ file exists | Backup Engine |
| `src/http/JiraHttpClient.ts` | ✅ file exists | Backup Engine |
| `src/workload/snapshot/types.ts` | ✅ file exists | Snapshot Orchestrator |
| `src/workload/http/JiraHttpClient.ts:134` | ✅ line 134 = `[search]` format string | Snapshot Orchestrator |
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
| `src/workload/sdi/detectors.ts` | ✅ file exists | SDI |
| `src/workload/sdi/scanDispatcher.ts` | ✅ file exists | SDI |
| `src/workload/sdi/types.ts` | ✅ file exists | SDI |
| `src/routes/inventory.ts` | ✅ file exists | Inventory |
| `src/workload/snapshot/CaptureOrchestrator.ts` | ✅ file exists | Snapshot |
| `src/workload/snapshot/ProgressEmitter.ts` | ✅ file exists | Backup Job |

---

## CHANGELOG.md — Reference / Exists / Section

| Reference | Exists | Section |
|---|---|---|
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
| `http://localhost:4000/api/connections/…/probes` (post-fix) | ✅ endpoint registered | §1, §3 |
| `data/jira_workload.db` | ✅ file exists | §1, §2, §4 |
| `src/workload/restore/boardScopeRecheck.ts` | ✅ file exists | §2 Scope Drift |
| `src/routes/connections.ts` | ✅ file exists | §2, §3 |
| `src/workload/http/JiraHttpClient.ts:_refresh` | ✅ method exists | §3 Refresh-Token Rotation |
| `src/workload/http/JiraHttpClient.ts:354` | ⚠️ Minor: transaction at line 357–363 (not 354); prose reference is in the correct function | §3 |
| `src/workload/restore/RestoreOrchestrator.ts` | ✅ file exists | §2 |
| `src/workload/backup/discoverProjects.ts:partitionJsmProjects` | ✅ function exists | §4 JSM Detection |
| `src/workload/http/JiraHttpClient.ts:enumerateIssues` | ✅ method exists | Log Tag Reference |
| `src/workload/backup/discoverFieldContexts.ts` | ✅ file exists | Log Tag Reference |
| `src/routes/policies.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/restore/trashDetectionGuard.ts` | ✅ file exists | Log Tag Reference |
| `src/http/JiraHttpClient.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/snapshot/downloadIssueAttachments.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/snapshot/ProgressEmitter.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/sdi/scanDispatcher.ts` | ✅ file exists | Log Tag Reference |
| `src/routes/inventory.ts` | ✅ file exists | Log Tag Reference |
| `src/workload/backup/discoverProjects.ts` | ✅ file exists | Log Tag Reference |

---

## P0 Carry-Forwards

None. All doc references are either confirmed-real or the minor line-number imprecision noted below.

---

## Minor Imprecision (not a P0)

| Doc | Reference | Note |
|---|---|---|
| `docs/OPERATIONS.md` §3 | `src/workload/http/JiraHttpClient.ts:354` | The `db.transaction()` call is at line 357. Line 354 is `const now = new Date().toISOString()` — within the same `_performRefresh()` method. The reference is correct in spirit but off by 3 lines. Not a Phase 2 item; documents the right function and the prose is accurate. |

---

## Phase 2 Items (from canonical Non-Goals)

All Phase 2 references in the docs are correctly marked as deferred. None were flagged as confirmed-absent in Phase 1.

| Feature | Doc reference | Status |
|---|---|---|
| `POST /api/snapshot` HTTP endpoint | DEMO.md | Correctly marked Phase 2 |
| ADF media link rewriting | DEMO.md, ARCHITECTURE.md | Correctly marked Phase 2 |
| HIPAA regulation tag | DEMO.md | Correctly hidden |
| Cross-site restore | DEMO.md | Correctly blocked |
| Blob storage export | DEMO.md | Correctly blocked |
| JSM objects | DEMO.md, OPERATIONS.md | Correctly deferred |
