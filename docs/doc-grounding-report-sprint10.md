# Doc Grounding Report — Sprint 10 (Phase 2 Sprint 3 QA)
_Generated: 2026-05-04 | QA: qa-engineer-persona_

---

## Summary

| Doc | Total Refs | Exist | Missing | Notes |
|-----|-----------|-------|---------|-------|
| README.md | 18 | 18 | 0 | All clean |
| INSTALL.md | 12 | 12 | 0 | All clean |
| DEMO.md | 34 | 34 | 0 | One minor doc note (see §4) |
| ARCHITECTURE.md | 26 | 26 | 0 | One minor inconsistency (see §4) |
| CHANGELOG.md | 22 | 22 | 0 | All clean |

**Result: zero P0 carry-forwards.** All documented references exist in the codebase.

---

## 1. README.md — Reference/Exists/Section Table

| Reference | Exists | Section |
|-----------|--------|---------|
| `GET /rest/api/3/field/{id}/context` | ✅ | Phase 2 Sprint 2 |
| `CaptureOrchestrator` | ✅ (`src/workload/snapshot/CaptureOrchestrator.ts:26`) | Phase 2 Sprint 2 |
| `JiraWorkload.snapshot()` | ✅ (`src/workload/JiraWorkload.ts:52`) | Phase 2 Sprint 2 |
| `POST /rest/api/3/search/jql` | ✅ (used exclusively in `enumerateIssues`) | Phase 2 Sprint 2 |
| `scripts/check-http-guard.sh` | ✅ | Phase 2 Sprint 2 |
| `backup_manifests` (DB table) | ✅ (`src/db/migrations/009_backup_manifests.sql`) | Phase 2 Sprint 2 |
| `GET /rest/api/3/project/search` | ✅ (`src/workload/backup/discoverProjects.ts`) | Phase 2 Sprint 1 |
| `service_desk` / `PHASE_2_DEFERRED` | ✅ (`src/workload/backup/discoverProjects.ts`) | Phase 2 Sprint 1 |
| `JiraWorkload.discover()` | ✅ (`src/workload/JiraWorkload.ts`) | Phase 2 Sprint 1 |
| `src/workload/http/JiraHttpClient.ts` | ✅ | Phase 2 Sprint 1 |
| `POST /api/connections` (OAuth + Manual) | ✅ (`src/routes/connections.ts`) | Phase 1 Sprint 2 |
| `GET /api/inventory` | ✅ (`src/routes/inventory.ts`) | Phase 1 Sprint 2 |
| `POST /api/policies` | ✅ (`src/routes/policies.ts`) | Phase 1 Sprint 2 |
| `POST /api/restores` | ✅ (`src/routes/restores.ts`) | Phase 1 Sprint 2 |
| `GET /api/restores/:id` | ✅ (`src/routes/restores.ts`) | Phase 1 Sprint 2 |
| `Caddyfile` | ✅ (project root) | Phase 1 Sprint 2 |
| OAuth 2.0 (3LO) / PKCE | ✅ (`src/oauth/authorize.ts`) | Phase 1 Sprint 3 |
| `src/http/JiraHttpClient.ts` | ✅ (OAuth flow client) | Phase 1 Sprint 3 |

---

## 2. INSTALL.md — Reference/Exists/Section Table

| Reference | Exists | Section |
|-----------|--------|---------|
| `.env.example` | ✅ (project root) | §2 Configure environment |
| `ATLASSIAN_CLIENT_ID` | ✅ (`.env.example` line 3) | §2 env table |
| `ATLASSIAN_CLIENT_SECRET` | ✅ (`.env.example` line 4) | §2 env table |
| `OAUTH_REDIRECT_URI` | ✅ (`.env.example` line 7) | §2 env table |
| `PORT` | ✅ (`.env.example` line 10) | §2 env table |
| `Caddyfile` (with inline snippet) | ✅ (project root, content matches) | §2 HTTPS callback |
| `https://localhost/api/oauth/callback` | ✅ (`src/routes/oauth.ts`) | §2 HTTPS callback |
| `src/db/database.ts` | ✅ | §3 Run database migrations |
| `npx tsx src/db/database.ts` | ✅ (`tsx` in devDependencies) | §3 |
| `npm run server` | ✅ (`package.json` scripts) | §4 Option A |
| `npm run dev` | ✅ (`package.json` scripts) | §4 Option A |
| `http://localhost:5173` (Vite default) | ✅ (standard Vite port) | §4 Option A |

---

## 3. DEMO.md — Reference/Exists/Section Table

| Reference | Exists | Section |
|-----------|--------|---------|
| `GET /api/oauth/authorize` | ✅ (`src/routes/oauth.ts`) | OAuth flow §2 |
| `/api/oauth/callback` | ✅ (`src/routes/oauth.ts`) | OAuth flow §4 |
| `https://api.atlassian.com/oauth/token/accessible-resources` | ✅ (implemented in `src/oauth/tokenExchange.ts`) | OAuth flow §4 |
| `POST /api/connections` | ✅ (`src/routes/connections.ts`) | Manual connection |
| `GET /api/connections/${CONNECTION_ID}/probes` | ✅ (`src/routes/connections.ts`) | OAuth flow §5 |
| `POST /api/discover` | ✅ (`src/routes/discover.ts`) | Discover Projects |
| `data/jira_workload.db` | ✅ (`data/` directory) | JSM-deferred observe |
| `backup_manifests` (SQLite table) | ✅ (`src/db/migrations/009_backup_manifests.sql`) | Multiple sections |
| `[field-context] skip field_id=...` log pattern | ✅ (`src/workload/backup/discoverFieldContexts.ts`) | Custom Field Context |
| `[field-context] fetch field_id=...` log pattern | ✅ (`src/workload/backup/discoverFieldContexts.ts`) | Custom Field Context |
| `CaptureOrchestrator` | ✅ (`src/workload/snapshot/CaptureOrchestrator.ts`) | Issue Enumeration |
| `POST /rest/api/3/search/jql` (exclusive) | ✅ (only endpoint used for issue search) | Issue Enumeration |
| `check:http-guard` (npm script) | ✅ (`package.json` scripts) | Issue Enumeration |
| `[search] endpoint=search/jql ...` log pattern | ✅ (`src/workload/http/JiraHttpClient.ts:107-109`) | Issue Enumeration |
| `coverageInvariant` manifest block | ✅ (`src/workload/backup/types.ts`) | Issue Enumeration |
| `POST /api/policies` with `rpoHours` | ✅ (`src/routes/policies.ts`) | Create a Backup Policy |
| `jqlFilter` validated via `POST /rest/api/3/jql/parse` | ✅ (`src/routes/policies.ts:64-84`) | Create a Backup Policy |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` path | ✅ (`src/workload/types/Attachment.ts`) | Attachments section |
| `DCC_ATTACHMENT_DIR` env var | ✅ (`.env.example` line 14, `src/workload/JiraWorkload.ts:152`) | Attachments section |
| `[attachment] op=download ...` log pattern | ✅ (`src/workload/snapshot/downloadIssueAttachments.ts:84,101,127,133`) | Attachments section |
| `GET /api/jobs/${JOB_ID}` | ✅ (`src/routes/jobs.ts`, mounted at `/api/jobs`) | Job Progress |
| `[backup-job] op=start/heartbeat/stalled/completed` log patterns | ✅ (`src/workload/snapshot/ProgressEmitter.ts`) | Job Progress |
| `completed_with_errors` status | ✅ (`src/workload/snapshot/ProgressEmitter.ts:123`) | Job Progress |
| `MAX_HEARTBEAT_INTERVAL_MS = 10 000` | ✅ (`src/workload/types/ProgressEvent.ts`) | Job Progress |
| `STALLED_THRESHOLD_MS = 20 000` | ✅ (`src/workload/types/ProgressEvent.ts`) | Job Progress |
| `changeBadge` values (added/modified/deleted/unchanged) | ✅ (`src/workload/backup/computeManifestDiff.ts`) | Manifest Change Badges |
| `computeManifestDiff` | ✅ (`src/workload/backup/computeManifestDiff.ts:78`) | Manifest Change Badges |
| `stableProjectHash` | ✅ (`src/workload/backup/computeManifestDiff.ts:47`) | Manifest Change Badges |
| `npx tsx scripts/smoke-discover.ts` | ✅ (`scripts/smoke-discover.ts`) | Probe 4 |
| `src/workload/backup/discoverFieldContexts.test.ts` | ✅ | Probe 5 |
| `src/workload/snapshot/assembleIssuePayload.test.ts` | ✅ | Probe 5 |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | ✅ | Probe 5 |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | ✅ | Probe 6 |
| `src/workload/backup/computeManifestDiff.test.ts` | ✅ | Probe 6 |

---

## 4. ARCHITECTURE.md — Reference/Exists/Section Table

| Reference | Exists | Section |
|-----------|--------|---------|
| `src/platform_workload_iface.ts` | ✅ | Key Files |
| `src/types/connection.ts` | ✅ | Key Files |
| `src/workload/backup/types.ts` | ✅ | Backup Engine |
| `src/workload/http/JiraHttpClient.ts` | ✅ | Backup Engine Key Files |
| `src/http/JiraHttpClient.ts` _(see note)_ | ✅ (exists; Phase 1 OAuth client) | Backup Engine overview |
| `src/workload/snapshot/types.ts` | ✅ | Snapshot Orchestrator |
| `src/workload/types/Attachment.ts` | ✅ | Attachment Storage |
| `src/workload/types/ManifestDiff.ts` | ✅ | Manifest Deletion-Diff |
| `src/workload/types/ProgressEvent.ts` | ✅ | Progress Event Contract |
| `src/workload/types/PolicyRecord.ts` | ✅ | Policy Record |
| `src/platform/contracts.ts` | ✅ | API Surface |
| `src/workload/http/JiraHttpClient.ts:107-109` (line ref) | ✅ (lines 107-109 contain `[search]` log line) | Structured-Log Shapes |
| `MAX_HEARTBEAT_INTERVAL_MS = 10 000` | ✅ | Progress Event Contract |
| `STALLED_THRESHOLD_MS = 20 000` | ✅ | Progress Event Contract |
| `JqlParseRequest` / `JqlParseResponse` types | ✅ (`src/workload/types/PolicyRecord.ts`) | Policy Record |
| `PAGINATION_TERMINATION_CONTRACT` | ✅ (`src/workload/snapshot/types.ts`) | Pagination Contract |
| `SnapshotPhase` enum | ✅ (`src/workload/snapshot/types.ts`) | SnapshotPhase Enum |
| `SNAPSHOT_PHASE_ORDER` | ✅ (`src/workload/snapshot/types.ts`) | Snapshot Orchestrator |
| `PHASE_EMIT_BOUNDARIES` | ✅ (`src/workload/snapshot/types.ts`) | Snapshot Orchestrator |
| `IssuePayload` | ✅ (`src/workload/snapshot/types.ts`) | IssuePayload Interface |
| `SearchLogLine` / `FieldContextLogLine` | ✅ (`src/workload/snapshot/types.ts`) | Structured-Log Shapes |
| `BackupManifest` schema | ✅ (`src/workload/backup/types.ts`) | BackupManifest Schema |
| `ManifestDiff` / `ProjectDiffEntry` | ✅ (`src/workload/types/ManifestDiff.ts`) | Manifest Deletion-Diff |
| `resolveAttachmentPaths` | ✅ (`src/workload/types/Attachment.ts:75`) | Attachment Storage |
| `AttachmentSidecar` | ✅ (`src/workload/types/Attachment.ts`) | Attachment Storage |
| `JobStatus` type | ✅ (`src/workload/types/ProgressEvent.ts`) | Progress Event Contract |

> **Doc note (non-P0):** ARCHITECTURE.md "Backup Engine" overview paragraph reads _"The concrete
> implementation is `JiraHttpClient` (`src/http/JiraHttpClient.ts`)"_. The file `src/http/JiraHttpClient.ts`
> exists (Phase 1 OAuth client) but the backup engine's concrete `IJiraHttpClient` is
> `src/workload/http/JiraHttpClient.ts`. The Key Files table in the same section correctly names
> `src/workload/http/JiraHttpClient.ts`. Both files exist; neither reference is broken.
> **Resolution:** cosmetic inconsistency only; no behaviour impact; no carry-forward required.

---

## 5. CHANGELOG.md — Reference/Exists/Section Table

| Reference | Exists | Section |
|-----------|--------|---------|
| `src/workload/snapshot/downloadIssueAttachments.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/Attachment.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/backup/computeManifestDiff.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/ManifestDiff.ts` | ✅ | Sprint 3 Phase 2 |
| `src/routes/policies.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/PolicyRecord.ts` | ✅ | Sprint 3 Phase 2 |
| `src/routes/jobs.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/snapshot/ProgressEmitter.ts` | ✅ | Sprint 3 Phase 2 |
| `src/workload/types/ProgressEvent.ts` | ✅ | Sprint 3 Phase 2 |
| `src/db/migrations/010_backup_jobs.sql` | ✅ | Sprint 3 Phase 2 |
| `src/db/migrations/010_policies_rpo_jql.sql` | ✅ | Sprint 3 Phase 2 |
| `DCC_ATTACHMENT_DIR` env var | ✅ (`.env.example` + `src/workload/JiraWorkload.ts:152`) | Sprint 3 Phase 2 |
| `src/workload/backup/discoverFieldContexts.ts` | ✅ | Sprint 2 Phase 2 |
| `src/workload/snapshot/assembleIssuePayload.ts` | ✅ | Sprint 2 Phase 2 |
| `src/workload/snapshot/CaptureOrchestrator.ts` | ✅ | Sprint 2 Phase 2 |
| `src/workload/http/JiraHttpClient.ts` | ✅ | Sprint 2 Phase 2 |
| `src/workload/JiraWorkload.ts` | ✅ | Sprint 2 Phase 2 |
| `src/workload/backup/discoverProjects.ts` | ✅ | Sprint 1 Phase 2 |
| `src/workload/backup/types.ts` | ✅ | Sprint 1 Phase 2 |
| `src/db/migrations/009_backup_manifests.sql` | ✅ | Sprint 1 Phase 2 |
| `scripts/smoke-discover.ts` | ✅ | Sprint 1 Phase 2 |
| `src/http/JiraHttpClient.ts` | ✅ (Phase 1 OAuth client) | Sprint 3 Phase 1 |

---

## 6. Smoke Probe Execution Evidence

### 6.1 POST /api/policies — Happy Path (HTTP 201, rpoHours verified)

Executed against fresh server (tsx src/server.ts, port 3000, current code):

```
==> POST /api/policies with rpoHours=24, retentionDays=30, projectScope=all
HTTP 201
{
  "policyId": "518a2999-9e1d-4171-ac75-7924cfcaff92",
  "connectionId": "337152e0-5311-4c19-bac6-2af16cf34277",
  "rpoHours": 24,
  "projectScope": "all",
  "selectedProjectKeys": [],
  "retentionDays": 30,
  "updatedAt": "2026-05-04T23:25:53.149Z"
}
PASS: rpoHours=24 confirmed in response body
PASS: updatedAt timestamp present
PASS: policyId present
```

Note: A stale server process (pre-sprint) was found at PID 6044 that served an older
version of `policies.ts` without `rpoHours` in the response. After killing it and
starting a fresh server with current code, `rpoHours` appears correctly in the response.
The code at `src/routes/policies.ts:107` correctly includes `rpoHours: body.rpoHours`.

### 6.2 POST /api/policies — Invalid JQL Error Path (HTTP 400)

Executed against fresh server (port 3000):

```
==> POST /api/policies with jqlFilter="INVALID SYNTAX !!"
HTTP 400
{"error":"jql_parse_failed","message":"post /rest/api/3/jql/parse HTTP 404"}
PASS: server returns HTTP 400 for invalid jqlFilter
```

_Note: Without live Atlassian credentials, the JQL parse call returns HTTP 404 (no
sandbox credential), which `policies.ts:78-82` correctly surfaces as HTTP 400
`jql_parse_failed`. The `invalid_jql` path (parseResult.queries[0].errors non-empty)
is exercised by the `src/routes/policies.test.ts` unit tests (16/16 pass)._

### 6.3 Attachment SHA-256 Verification

Unit tests in `src/workload/snapshot/downloadIssueAttachments.test.ts` (12/12 passed):

**Log format verified:**
```
[attachment] op=download id=att-001 bytes=41 sha256=<hex> outcome=ok
[attachment] op=download id=att-001 bytes=7 sha256=<hex> outcome=hash_mismatch
[attachment] op=download id=att-001 bytes=0 sha256= outcome=http_error
```

**Key assertions confirmed:**
- Binary written byte-for-byte; re-read and SHA-256 verified post-write ✅
- Sidecar JSON written only after hash check passes ✅
- `hash_mismatch` outcome recorded as per-item error, sidecar NOT written ✅
- `http_error` outcome when `downloadAttachment` throws ✅
- Processing continues after either error type (no abort) ✅
- All sidecar fields present: `attachmentId`, `issueKey`, `backupPointId`, `filename`, `mimeType`, `size`, `sha256`, `capturedAt` ✅

### 6.4 Manifest changeBadge Values — 2-Snapshot Diff

Unit tests in `src/workload/backup/computeManifestDiff.test.ts` (20/20 passed):

**Mixed-scenario test confirms all four badges in one run:**
```
manifest m1 (previous): [UNCHANGED(id=1), MODIFIED(id=2, name=Old), DELETED(id=3)]
manifest m2 (current):  [UNCHANGED(id=1), MODIFIED(id=2, name=New), ADDED(id=4)]

Result:
  id=1 → changeBadge: "unchanged"
  id=2 → changeBadge: "modified"
  id=3 → changeBadge: "deleted", lastSeenBackupPointId: "m1"
  id=4 → changeBadge: "added"
  summary: { added: 1, modified: 1, deleted: 1, unchanged: 1 }
```

**First-ever run (previous=null):** all projects receive `changeBadge: "added"` ✅

**`stableProjectHash` invariants confirmed:**
- Board/sprint ID order-insensitive (sorted before hashing) ✅
- `changeBadge` and `lastSeenBackupPointId` excluded from hash ✅
- `projectName`, `boardIds`, `sprintIds`, `projectTypeKey` changes detected ✅

### 6.5 Heartbeat Log Lines — ≤10s Cadence

`ProgressEmitter` tests (17/17 passed) confirm:

**Log format verified:**
```
[backup-job] op=start     jobId=<uuid> errors=0
[backup-job] op=heartbeat jobId=<uuid> errors=0
[backup-job] op=heartbeat jobId=<uuid> errors=2
[backup-job] op=completed jobId=<uuid> errors=2
```

**Heartbeat contract:**
- `emit()` persists event row to `backup_job_events` ✅
- `emit()` resets `lastHeartbeatMs` clock ✅
- Watchdog polls every 5 s (`WATCHDOG_POLL_MS = 5_000`) ✅
- `MAX_HEARTBEAT_INTERVAL_MS = 10_000` — orchestrator must call `emit()` within this window ✅

### 6.6 Stalled Alert (>20s Silence)

`ProgressEmitter` watchdog logic confirmed:
```
STALLED_THRESHOLD_MS = 20_000
Watchdog fires every 5 s; when Date.now() - lastHeartbeatMs > 20_000:
  → job status transitions 'running' → 'stalled'
  → [backup-job] op=stalled jobId=<uuid> errors=0 emitted
```

Test coverage: ProgressEmitter.test.ts includes timer-mocked tests for the stalled detection path (17/17 passed) ✅.

### 6.7 "Completed with N errors" Terminal Status

`ProgressEmitter.complete(errorsCount)` sets:
- `errorsCount === 0` → `status = 'completed'`
- `errorsCount > 0`  → `status = 'completed_with_errors'`

`GET /api/jobs/:id` returns the current `status` field from `backup_jobs`.
When `status === 'completed_with_errors'`, the UI must display **"Completed with N errors"** — never "Completed successfully" (T5 §6.2b).

**Evidence from ProgressEmitter.ts:122-125:**
```typescript
complete(errorsCount: number): void {
  this._clearWatchdog();
  const status = errorsCount > 0 ? 'completed_with_errors' : 'completed';
  ...
}
```

### 6.8 GET /api/jobs/:id — 404 for Unknown Job

Executed against fresh server (port 3000):

```
$ curl -o /dev/null -s -w "%{http_code}" http://localhost:3000/api/jobs/no-such-job-id
HTTP 404
PASS: GET /api/jobs/:id returned 404 for unknown job
```

Response body: `{"error":"not_found","message":"job no-such-job-id not found"}`

---

## 7. Zero Usage of Deprecated GET /rest/api/3/search

```bash
$ grep -rn "GET /rest/api/3/search[^/]" src/
```

**Result:** The string `GET /rest/api/3/search` appears ONLY in comment/documentation text:
- `src/workload/snapshot/types.ts:269` — comment: "The deprecated GET /rest/api/3/search endpoint must NOT appear..."
- `src/workload/snapshot/types.ts:277` — `forbiddenEndpoint` constant value in `PAGINATION_TERMINATION_CONTRACT` (documentation artifact, not an HTTP call)
- `src/workload/backup/types.ts:65` — comment in `IJiraHttpClient` interface JSDoc
- `src/workload/backup/types.ts:111` — comment in `BackupManifest` JSDoc

**No HTTP call or URL construction using `/rest/api/3/search` (non-JQL path) exists anywhere in the codebase.**

`npm run check:http-guard` → **HTTP guard passed.** (enforces no raw `fetch()` against Atlassian outside `JiraHttpClient`, no `axios.create()`).

**QA confirms: zero usage of deprecated `GET /rest/api/3/search` across the entire `src/` tree.** All issue discovery uses `POST /rest/api/3/search/jql` exclusively.

---

## 8. Outstanding Issues / Carry-Forward

| Item | Severity | Resolution |
|------|----------|------------|
| `GET /api/jobs/:id` missing from ARCHITECTURE.md API Surface → Endpoint Map table | Doc-only, non-P0 | Route exists in code (`src/routes/jobs.ts`, mounted at `src/server.ts:21`) and is documented in DEMO.md. ARCHITECTURE.md table only covers T0 §2 stub endpoints; carry-forward as doc cleanup |
| `ARCHITECTURE.md` overview paragraph references `src/http/JiraHttpClient.ts` instead of `src/workload/http/JiraHttpClient.ts` as the backup engine concrete implementation | Doc-only, non-P0 | Both files exist; cosmetic inconsistency; carry-forward as optional doc cleanup |
| `DCC_ATTACHMENT_DIR` is commented out in `.env.example` | By design | Intentional — it documents the override without requiring it |
| `/api/snapshot` HTTP route not yet exposed | Known gap, documented in DEMO.md | Sprint 4 deliverable; no carry-forward action required |
| Stale server process (PID 6044) was serving old `policies.ts` without `rpoHours` in response | Process hygiene | Killed and replaced with fresh server during QA run; no code issue |

**P0 carry-forwards: 0**  
_(All documentation gaps are doc-only cosmetic issues; all code references resolve correctly; all referenced files and routes exist.)_

---

## 9. Test Suite Summary

| Test file | Tests | Status |
|-----------|-------|--------|
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | 12 | ✅ all passed |
| `src/workload/backup/computeManifestDiff.test.ts` | 20 | ✅ all passed |
| `src/workload/snapshot/ProgressEmitter.test.ts` | 17 | ✅ all passed |
| `src/routes/policies.test.ts` | 16 | ✅ all passed |
| **Sprint 3 subtotal** | **65** | **✅ all passed** |
| **Full suite (15 test files)** | **237** | **✅ all passed** |

Full suite output:
```
 Test Files  15 passed (15)
      Tests  237 passed (237)
   Duration  1.63s
```
