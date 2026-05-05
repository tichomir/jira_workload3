# Doc-Grounding Report — Phase 4 Sprint 2 (Sprint 14)

_Generated: 2026-05-05 | QA Engineer_

Sprint deliverables verified: board scope re-check guard (`boardScopeRecheck.ts`),
trash detection guard (`trashDetectionGuard.ts`), post-issue-creation pass
(`postIssueCreationPass.ts`), `RestoreOrchestrator` guard wiring, new type contracts
(`GuardResult`, `TrashStatus`, `PostIssuePassReport`, `PostIssueSubPhaseEvent`, etc.),
`GET /api/restore-jobs/trash-check` endpoint, `RestoreWizard` trash-detection UI, and
DEMO.md Probe 9.

---

## ARCHITECTURE.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/platform_workload_iface.ts` | Y | Key Files | — |
| `src/types/connection.ts` | Y | Key Files | — |
| `src/workload/backup/types.ts` | Y | Backup Engine Key Files | — |
| `src/workload/http/JiraHttpClient.ts` | Y | Backup Engine Key Files | — |
| `src/workload/snapshot/types.ts` | Y | Snapshot Orchestrator Key Files | — |
| `src/workload/types/Attachment.ts` | Y | Attachment Storage | — |
| `src/workload/types/ManifestDiff.ts` | Y | Manifest Deletion-Diff | — |
| `src/workload/types/ProgressEvent.ts` | Y | Progress Event Contract | — |
| `src/workload/types/PolicyRecord.ts` | Y | Policy Record | — |
| `src/routes/inventory.ts` | Y | Inventory Browse Flow | — |
| `src/platform/contracts.ts` | Y | Inventory Browse Flow Key Files | — |
| `src/workload/restore/types.ts` | Y | Restore Subsystem Key Files | — |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | Restore Subsystem Key Files | — |
| `src/workload/restore/eventBus.ts` | Y | Restore Subsystem Key Files | — |
| `src/routes/restore-jobs.ts` | Y | Restore Subsystem Key Files | — |
| `GuardResult` interface | Y | Restore Phase Chain — Shared Types | defined in `src/workload/restore/types.ts` ✓ |
| `TrashStatus` interface | Y | Restore Phase Chain — Shared Types | defined in `src/workload/restore/types.ts` ✓ |
| `PostIssuePassReport` interface | Y | Restore Phase Chain — Shared Types | defined in `src/workload/restore/types.ts` ✓ |
| `ConflictDecision` interface | Y | Restore Phase Chain — Shared Types | defined in `src/workload/restore/types.ts` ✓ |
| `ConflictPauseEvent` interface | Y | Restore Phase Chain — Conflict Modes | defined in `src/workload/restore/types.ts` ✓ |
| `ConflictResumedEvent` interface | Y | Restore Phase Chain — Conflict Modes | defined in `src/workload/restore/types.ts` ✓ |
| `PostIssueSubPhaseEvent` in `RestoreSseEvent` union | Y | SSE Event Types | **Fixed this sprint** — union was stale (missing `PostIssueSubPhaseEvent`, `ConflictPauseEvent`, `ConflictResumedEvent`). Updated to match `src/workload/restore/types.ts`. |
| `POST /api/restore-jobs` — `destination` field as nested object | **N** | POST /api/restore-jobs | **Fixed this sprint** — ARCHITECTURE.md showed `"destination": { "type": "original" }` but actual code (`src/routes/restore-jobs.ts`) accepts plain string `"original"\|"alternate"\|"export"` with a separate `alternateDestination` field. Corrected request body, field table, and destination variant examples. |
| `cross_site_not_supported` error code | **N** | POST /api/restore-jobs | **Fixed this sprint** — ARCHITECTURE.md showed `cross_site_not_supported` but code returns `cross_site_restore_not_supported`. Corrected at both locations (prose and error table). |
| `backup_point_not_found` 404 in POST /api/restore-jobs | **N** | POST /api/restore-jobs | **Fixed this sprint** — ARCHITECTURE.md listed a `404 backup_point_not_found` error but the route never validates `backupPointId` against the database. Removed from error table. |
| Board scope guard "calls `GET /rest/api/3/myself`" | **N** | Special Cases | **Fixed this sprint** — description and Guard Chain section both said the guard calls `GET /rest/api/3/myself`. Actual implementation (`src/workload/restore/boardScopeRecheck.ts:52-59`) reads from the `credentials` DB table — no HTTP request. Updated both the Special Cases prose and the Guard 2 "How it checks" description. |
| Sequence diagram Guard 2 `Guard->>API: GET /rest/api/3/myself` | **N** | Restore Phase Chain sequence diagram | **Fixed this sprint** — diagram showed an API call; corrected to `Guard->>DB: SELECT scopes FROM credentials WHERE connectionId = ?`. |
| `GET /api/restore-jobs/trash-check` (new Sprint 2 endpoint) | **N** | Restore Subsystem | **Fixed this sprint** — endpoint undocumented. Added full spec section (query params, response, stub behaviour, error responses) after the SSE events endpoint. |
| T0 §2 API endpoint map shows `POST /api/restores` / `GET /api/restores/:id` | **N** | API Surface (T0 §2) | **Fixed this sprint** — map was stale from Sprint 2 Phase 1. Updated to show all current endpoints including `POST/GET /api/restore-jobs/*`, `GET /api/restore-jobs/trash-check`, OAuth, discover, jobs, and inventory paginaton routes. Legacy stubs retained with "(Legacy stub — superseded)" label. |
| `MAX_HEARTBEAT_INTERVAL_MS = 10 000` | Y | Progress Heartbeat and Stalled Detection | defined in `src/workload/types/ProgressEvent.ts` ✓ |
| `STALLED_THRESHOLD_MS = 20 000` | Y | Progress Heartbeat and Stalled Detection | defined in `src/workload/types/ProgressEvent.ts` ✓ |

---

## CHANGELOG.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| Phase 4 Sprint 2 entry | **N** | — | **Fixed this sprint** — no entry existed for Sprint 2 deliverables. Added full entry covering: `boardScopeRecheck.ts`, `trashDetectionGuard.ts`, `postIssueCreationPass.ts`, `RestoreOrchestrator` updates, `types.ts` new interfaces, `GET /api/restore-jobs/trash-check`, `RestoreWizard` trash-detection UI changes. |
| `src/workload/restore/boardScopeRecheck.ts` | Y | Phase 4 Sprint 2 (Added) | exists ✓ |
| `src/workload/restore/trashDetectionGuard.ts` | Y | Phase 4 Sprint 2 (Added) | exists ✓ |
| `src/workload/restore/postIssueCreationPass.ts` | Y | Phase 4 Sprint 2 (Added) | exists ✓ |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | Phase 4 Sprint 2 (Updated) | exists ✓ |
| `src/workload/restore/types.ts` | Y | Phase 4 Sprint 2 (Updated) | exists ✓ |
| `src/routes/restore-jobs.ts` | Y | Phase 4 Sprint 2 (Updated) | exists ✓ |
| `src/platform/ui/restore/RestoreWizard.tsx` | Y | Phase 4 Sprint 2 (Updated) | exists ✓ |
| `REQUIRED_BOARD_SCOPES` exported constant | Y | Phase 4 Sprint 2 | in `src/workload/restore/boardScopeRecheck.ts` ✓ |
| `checkBoardScopesFromString()` | Y | Phase 4 Sprint 2 | in `src/workload/restore/boardScopeRecheck.ts` ✓ |
| `checkBoardScopes(connectionId)` | Y | Phase 4 Sprint 2 | in `src/workload/restore/boardScopeRecheck.ts` ✓ |
| `runTrashDetection()` | Y | Phase 4 Sprint 2 | in `src/workload/restore/trashDetectionGuard.ts` ✓ |
| `extractProjectKeys()` | Y | Phase 4 Sprint 2 | in `src/workload/restore/trashDetectionGuard.ts` ✓ |
| `runPostIssueCreationPass()` | Y | Phase 4 Sprint 2 | in `src/workload/restore/postIssueCreationPass.ts` ✓ |
| `post_issue_sub_phase` SSE event | Y | Phase 4 Sprint 2 | `PostIssueSubPhaseEvent` in `src/workload/restore/types.ts` ✓ |
| `[permission-probe] scope=... outcome=ok|missing` log | Y | Phase 4 Sprint 2 | emitted by `checkBoardScopesFromString` ✓ |
| `[restore] guard=trash-detection projectKey=... trashed=...` log | Y | Phase 4 Sprint 2 | emitted by `runTrashDetection` ✓ |
| Phase 4 Sprint 1 entry (unchanged from Sprint 13) | Y | Phase 4 Sprint 1 | confirmed valid; no regressions ✓ |

---

## DEMO.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `GET /api/restore-jobs/trash-check?connectionId=...&projectKeys=...` | Y | Probe 9 | `handleTrashCheck` mounted in `src/routes/restore-jobs.ts` ✓ |
| `trashedProjectKeys` response field | Y | Probe 9 | returned by `handleTrashCheck` ✓ |
| `TRASH`-prefixed key → `in-trash` response | Y | Probe 9 | stub logic: `k.toUpperCase().startsWith('TRASH')` ✓ |
| missing `connectionId` returns 400 | Y | Probe 9 | `handleTrashCheck` returns 400 when `connectionId` absent ✓ |
| `npx vitest run src/workload/restore/boardScopeRecheck.test.ts` | Y | Probe 9 step 5/7 | `src/workload/restore/boardScopeRecheck.test.ts` exists ✓ |
| `npx vitest run src/workload/restore/trashDetectionGuard.test.ts` | Y | Probe 9 step 6/7 | `src/workload/restore/trashDetectionGuard.test.ts` exists ✓ |
| `npx vitest run src/workload/restore/RestoreOrchestrator.test.ts` | Y | Probe 9 step 7/7 | `src/workload/restore/RestoreOrchestrator.test.ts` exists ✓ |
| Probe 9 asserts `trashedProjectKeys=[]` for live projects | Y | Probe 9 step 2/7 | code returns `[]` for non-TRASH keys ✓ |
| Probe 9 asserts `TRASHPROJ` in `trashedProjectKeys` | Y | Probe 9 step 3/7 | code returns `['TRASHPROJ']` for TRASH-prefixed keys ✓ |
| Probe 9 PASS/FAIL assertions via `python3 -c` | Y | Probe 9 | all JSON assertions match actual API response shape ✓ |
| Probe 9 `npm run server` prerequisite | Y | Probe 9 comment | in `package.json` scripts ✓ |
| DEMO.md Probe 8 restore-protected-objects (unchanged) | Y | Probe 8 | confirmed valid from Sprint 13; no regressions ✓ |
| Step 3 — trash detection wizard flow | Y | Restore protected objects, Step 3 | matches `RestoreWizard.tsx` trash-check logic and `GET /api/restore-jobs/trash-check` ✓ |
| Pre-phase guards log lines (board scope, trash detection) | Y | Restore protected objects, Step 5 | log patterns match `boardScopeRecheck.ts` and `trashDetectionGuard.ts` ✓ |
| `post_issue_sub_phase` events — `subPhase: comment, subtask, issuelink` | Y | Restore protected objects, Step 5 | matches `PostIssueSubPhaseEvent` in types.ts and `runPostIssueCreationPass` ✓ |
| `adfMediaLinkWarning` in restore report | Y | Restore protected objects, Step 6 | `PostIssuePassReport.adfMediaLinkWarning` ✓ |
| All Probe 1–7 references (unchanged from Sprint 13) | Y | Probes 1–7 | confirmed valid in Sprint 13 report; no regressions ✓ |

---

## INSTALL.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `GET /api/restore-jobs/trash-check` | **N** | §6 API surface | **Fixed this sprint** — endpoint missing from API surface table. Added row. |
| `POST /api/restore-jobs` | Y | §6 API surface | exists ✓ (added in Sprint 13) |
| `GET /api/restore-jobs/:id/events` | Y | §6 API surface | exists ✓ (added in Sprint 13) |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `PORT`, `DCC_ATTACHMENT_DIR` | Y | §2 Configure environment | all present in `.env.example` ✓ |
| `Caddyfile` | Y | §2 HTTPS | exists at project root ✓ |
| `src/db/database.ts` | Y | §3 Migrations | exists ✓ |
| `npm run server`, `npm run dev` | Y | §4 Start services | in `package.json` scripts ✓ |
| `.env.example` | Y | §2 Configure environment | exists ✓ |
| `data/jira_workload.db` | Y | Various | exists ✓ |
| All other INSTALL.md references | Y | Various | confirmed valid in Sprint 13 report; no regressions ✓ |

---

## README.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `INSTALL.md` | Y | Quick links | file exists ✓ |
| `DEMO.md` | Y | Quick links | file exists ✓ |
| `ARCHITECTURE.md` | Y | Quick links | file exists ✓ |
| `CHANGELOG.md` | Y | Quick links | file exists ✓ |
| `CaptureOrchestrator` class reference | Y | What is built — Phase 2 Sprint 2 | in `src/workload/snapshot/CaptureOrchestrator.ts` ✓ |
| `JiraWorkload.snapshot()` | Y | What is built — Phase 2 Sprint 2 | in `src/workload/JiraWorkload.ts` ✓ |
| `scripts/check-http-guard.sh` | Y | What is built — Phase 2 Sprint 2 | exists ✓ |
| `src/workload/http/JiraHttpClient.ts` | Y | What is built — Phase 2 Sprint 1 | exists ✓ |
| All other README.md references | Y | Various | confirmed valid in Sprint 13 report; no regressions ✓ |

---

## Sprint 13 Carry-Forward Status

All Sprint 13 P0 carry-forwards were resolved in Sprint 13. No open items carried
into this sprint.

| Sprint 13 Item | Status |
|----------------|--------|
| `src/routes/restores.ts` wrong file in Key Files | Resolved in Sprint 13 ✓ |
| `POST /api/restore-jobs` `"status": "pending"` | Resolved in Sprint 13 ✓ |
| `src/http/JiraHttpClient.ts` wrong client ref | Resolved in Sprint 13 ✓ |
| GET /api/inventory stale `counts` shape | Resolved in Sprint 13 ✓ |

---

## Fixes Applied This Sprint

| # | Doc | Reference | Fix Applied |
|---|-----|-----------|-------------|
| 1 | ARCHITECTURE.md | `RestoreSseEvent` union missing `PostIssueSubPhaseEvent`, `ConflictPauseEvent`, `ConflictResumedEvent` | **Fixed** — updated union to include all three new types added in Sprint 2 `types.ts`. |
| 2 | ARCHITECTURE.md | POST /api/restore-jobs request body shows `destination` as nested object | **Fixed** — changed to plain string `"original"\|"alternate"\|"export"` with separate `alternateDestination` field, matching actual code in `src/routes/restore-jobs.ts`. |
| 3 | ARCHITECTURE.md | Error code `cross_site_not_supported` (two locations) | **Fixed** — corrected to `cross_site_restore_not_supported` to match code at lines 94 and 103 of `src/routes/restore-jobs.ts`. |
| 4 | ARCHITECTURE.md | `backup_point_not_found` 404 in POST /api/restore-jobs error table | **Fixed** — removed; the route never validates `backupPointId` against the DB. |
| 5 | ARCHITECTURE.md | Board scope guard Special Cases: "calls `GET /rest/api/3/myself`" | **Fixed** — corrected to read from `credentials` DB table; no HTTP request required. |
| 6 | ARCHITECTURE.md | Guard 2 "How it checks" description repeats API call error | **Fixed** — updated to describe DB read from `credentials.scopes` column. |
| 7 | ARCHITECTURE.md | Sequence diagram Guard 2: `Guard->>API: GET /rest/api/3/myself` | **Fixed** — corrected to `Guard->>DB: SELECT scopes FROM credentials WHERE connectionId = ?`. |
| 8 | ARCHITECTURE.md | T0 §2 endpoint map stale (shows `POST /api/restores` not `POST /api/restore-jobs`) | **Fixed** — updated to show all current routes including `/api/restore-jobs`, `/api/restore-jobs/trash-check`, OAuth, discover, jobs, and inventory. Legacy stubs retained with "(Legacy stub — superseded)" label. |
| 9 | ARCHITECTURE.md | `GET /api/restore-jobs/trash-check` undocumented | **Fixed** — added full endpoint spec after the SSE events endpoint (query params, response shape, stub behaviour, error responses). |
| 10 | INSTALL.md | `GET /api/restore-jobs/trash-check` missing from §6 API surface | **Fixed** — added row to the API surface table. |
| 11 | CHANGELOG.md | No Phase 4 Sprint 2 entry | **Fixed** — added complete entry for all Sprint 2 deliverables: `boardScopeRecheck.ts`, `trashDetectionGuard.ts`, `postIssueCreationPass.ts`, `RestoreOrchestrator` guard wiring, `types.ts` new interfaces, `restore-jobs.ts` trash-check, `RestoreWizard` UI changes. |

---

## New P0 Carry-Forwards

None. All Sprint 14 doc issues were resolved in-sprint.

---

## Smoke Probe Status

| Probe | Description | Status |
|-------|-------------|--------|
| Probe 1 | connect-jira-site OAuth | Unchanged from Sprint 13; valid ✓ |
| Probe 2 | manual-connection | Unchanged from Sprint 13; valid ✓ |
| Probe 3 | stub-endpoints (objectTypes shape + policies) | Unchanged from Sprint 13; valid ✓ |
| Probe 4 | discover-flow | Unchanged from Sprint 13; valid ✓ |
| Probe 5 | field-context + issue-enumeration unit tests | Unchanged from Sprint 13; valid ✓ |
| Probe 6 | Sprint 3 deliverables (policies rpoHours, jobs, SHA-256, changeBadge) | Unchanged from Sprint 13; valid ✓ |
| Probe 7 | browse-protected-inventory: filter facets, search & traceability | Unchanged from Sprint 13; valid ✓ |
| Probe 8 | restore-protected-objects: POST /api/restore-jobs + SSE phase order | Unchanged from Sprint 13; valid ✓ |
| Probe 9 | restore-sprint2-guards: trash-check endpoint, board scope recheck & post-issue pass | **New this sprint** — trash-check stub logic correct; `boardScopeRecheck.test.ts`, `trashDetectionGuard.test.ts`, `RestoreOrchestrator.test.ts` all exist; all file path references valid; HTTP assertions match `handleTrashCheck` implementation ✓ |

> Note: Functional execution of probes against a running server is deferred to the
> sprint runner environment. All referenced file paths, table columns, API routes,
> field names, and SSE event types have been verified to exist in the current codebase.
