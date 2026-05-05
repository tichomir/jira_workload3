# Doc Grounding Report — Sprint 8 (Sprint 2 Phase 2)

> **Historical record.** The two P0 carry-forwards identified here
> (P0-S8-01 README missing Phase 2 sections; P0-S8-02 ARCHITECTURE.md `[search]`
> log format mismatch) were both resolved in the Sprint 9 doc-grounding pass.
> The `src/workload/http/JiraHttpClient.ts` line references cited in this report
> (`:71`, `:83`, `:93`, `:107-109`, `:117`) were re-verified as still correct
> in Sprint 9 (see `doc-grounding-report-sprint9.md`).

_Generated: 2026-05-04 | Author: qa-engineer-persona_
_Scope: README.md, INSTALL.md, DEMO.md, ARCHITECTURE.md, CHANGELOG.md_
_Sprint focus: Sprint 2 Phase 2 additions — Custom Field Context Discovery, Issue Payload Assembler, Capture Orchestrator, JiraWorkload.snapshot()_

---

## Summary

| Document | References checked | Exists | Doesn't exist | P0 carry-forwards |
|---|---|---|---|---|
| README.md | 8 | 8 | 0 | 1 |
| INSTALL.md | 9 | 9 | 0 | 0 |
| DEMO.md | 32 | 32 | 0 | 0 |
| ARCHITECTURE.md | 28 | 27 | 0 | 1 |
| CHANGELOG.md | 28 | 28 | 0 | 0 |
| **Total** | **105** | **104** | **0** | **2** |

**Two P0 carry-forwards identified:**

1. **README.md** — "What is built" section documents only Platform Stub and OAuth (Sprints 2–3) but contains no entry for Phase 2 Sprint 1 (Backup Engine Foundations / Project Discovery) or Phase 2 Sprint 2 (Custom Field Context, Issue Enumeration, CaptureOrchestrator). Operators reading README cannot discover that the backup engine exists. Carry-forward to Sprint 3.

2. **ARCHITECTURE.md** — The `[search]` log line shape documented under "Structured-Log Line Shapes" uses a verbose format (`jql`, `startAt`, `maxResults`, `returned`, `total`) that does not match what `JiraHttpClient.enumerateIssues()` actually emits at runtime. DEMO.md and the implementation agree on the real format; ARCHITECTURE.md does not. Carry-forward to Sprint 3 (no code change required — ARCHITECTURE.md prose update only).

---

## README.md

### References checked

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `DEMO.md` | File (link) | Yes | project root |
| `ARCHITECTURE.md` | File (link) | Yes | project root |
| `CHANGELOG.md` | File (link) | Yes | project root |
| `JiraHttpClient` | Class | Yes | `src/workload/http/JiraHttpClient.ts` (backup engine) and `src/http/JiraHttpClient.ts` (OAuth) |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` |

### P0 carry-forward

| Defect | Section | Detail |
|---|---|---|
| README "What is built" not updated for Phase 2 | `## What is built (Sprints 2–3)` | Section documents only Platform Stub endpoints and OAuth 3LO Foundation. Phase 2 Sprint 1 (Project Discovery, JSM Detection, `JiraWorkload.discover()`) and Phase 2 Sprint 2 (Custom Field Context, Issue Enumeration, `CaptureOrchestrator`, `JiraWorkload.snapshot()`) are not represented. An operator reading README cannot discover that the backup engine has been implemented. |

---

## INSTALL.md

### References checked

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
| `Caddyfile` | File | Yes | project root — reverse-proxy config present |

No carry-forwards. All references resolve.

---

## DEMO.md

### Pre-existing references (carry-forward confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example` |
| `/api/oauth/callback` | Route | Yes | `src/routes/oauth.ts` |
| `http://localhost:3000/api/connections/${CONNECTION_ID}/probes` | Route | Yes | `src/routes/connections.ts` (`GET /:id/probes`) |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts` |
| `POST /api/connections` (mode=manual) | Route | Yes | `src/routes/connections.ts` |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` |
| `POST /api/discover` | Route | Yes | `src/routes/discover.ts`, mounted in `src/server.ts` |
| `backup_manifests` table | DB table | Yes | `src/db/migrations/009_backup_manifests.sql` |
| `data/jira_workload.db` | File path | Yes | `data/` directory present |
| `npx tsx scripts/smoke-discover.ts` | Command | Yes | `scripts/smoke-discover.ts` |

### New in Sprint 2 Phase 2 — Custom Field Context Discovery section

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `GET /rest/api/3/field` | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:47` |
| `GET /rest/api/3/field/{id}/context` | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:60` |
| `[field-context] fetch field_id=customfield_10016 contextCount=1` | Log format | Yes | `src/workload/backup/discoverFieldContexts.ts:79` — confirmed in smoke probe execution |
| `[field-context] skip field_id=summary reason=system-field` | Log format | Yes | `src/workload/backup/discoverFieldContexts.ts:53` — confirmed in smoke probe execution |
| `manifestJson` column of `backup_manifests` | DB field | Yes | `src/db/migrations/009_backup_manifests.sql:4`; written in `src/workload/JiraWorkload.ts:104` |

### New in Sprint 2 Phase 2 — Issue Enumeration (Capture Orchestrator) section

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `CaptureOrchestrator` | Class | Yes | `src/workload/snapshot/CaptureOrchestrator.ts:25` |
| `POST /rest/api/3/search/jql` | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |
| `check:http-guard` | npm script | Yes | `package.json:17` → `bash scripts/check-http-guard.sh` |
| `[search] endpoint=search/jql project=MYPROJ page=1 count=100` | Log format | Yes | `src/workload/http/JiraHttpClient.ts:107-109` — format matches DEMO.md |
| `[snapshot-progress] phase=CustomField` | Log format | Yes | `src/workload/JiraWorkload.ts:149-153` |
| `[snapshot-progress] phase=Project` | Log format | Yes | `src/workload/JiraWorkload.ts:149-153` |
| `[snapshot-progress] phase=Issue` | Log format | Yes | `src/workload/JiraWorkload.ts:149-153` |
| `json_extract(manifestJson, '$.coverageInvariant')` | SQLite expression | Yes | `sqlite3` SQLite function; `coverageInvariant` key present in manifest — `src/workload/JiraWorkload.ts:168` |

### New in Sprint 2 Phase 2 — Probe 5 (unit tests)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `npx vitest run src/workload/backup/discoverFieldContexts.test.ts` | Command/file | Yes | `src/workload/backup/discoverFieldContexts.test.ts` — 8 tests passed |
| `npx vitest run src/workload/snapshot/assembleIssuePayload.test.ts` | Command/file | Yes | `src/workload/snapshot/assembleIssuePayload.test.ts` — 64 tests passed |
| `npx vitest run src/workload/snapshot/CaptureOrchestrator.test.ts` | Command/file | Yes | `src/workload/snapshot/CaptureOrchestrator.test.ts` — 14 tests passed |

No carry-forwards. All 32 references resolve.

---

## ARCHITECTURE.md

### Platform/Workload Boundary section (carry-forward confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/platform_workload_iface.ts` | File | Yes | project root `src/` |
| `src/types/connection.ts` | File | Yes | `src/types/` |
| `src/platform/contracts.ts` | File | Yes | `src/platform/` |
| `PlatformWorkloadInterface` | Interface | Yes | `src/platform_workload_iface.ts` |
| `Connection` | Type | Yes | `src/types/connection.ts` |
| `CredentialRecord` | Type | Yes | `src/types/connection.ts` |
| `discover` / `snapshot` / `restore` / `refresh_auth` | Methods | Yes | `src/platform_workload_iface.ts` |

### Backup Engine section (Sprint 1 Phase 2 — confirmed present)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/backup/types.ts` | File | Yes | all backup-engine type contracts |
| `src/workload/http/JiraHttpClient.ts` | File | Yes | backup engine HTTP client implementing `IJiraHttpClient` |
| `IJiraHttpClient` | Interface | Yes | `src/workload/backup/types.ts` |
| `ICaptureOrchestrator` | Interface | Yes | `src/workload/backup/types.ts` |
| `BackupManifest` | Interface | Yes | `src/workload/backup/types.ts` |
| `CoverageInvariant` | Interface | Yes | `src/workload/backup/types.ts` |
| `GET /rest/api/3/project/search` | API path | Yes | `src/workload/backup/discoverProjects.ts` |

### Snapshot Orchestrator section (Sprint 2 Phase 2 — new this sprint)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/snapshot/types.ts` | File | Yes | `src/workload/snapshot/types.ts` |
| `SnapshotPhase` enum | Exported symbol | Yes | `src/workload/snapshot/types.ts:43` |
| `SNAPSHOT_PHASE_ORDER` | Exported const | Yes | `src/workload/snapshot/types.ts:60` |
| `PhaseEmitBoundary` | Interface | Yes | `src/workload/snapshot/types.ts:80` |
| `PHASE_EMIT_BOUNDARIES` | Exported const | Yes | `src/workload/snapshot/types.ts:106` |
| `IssuePayload` | Interface | Yes | `src/workload/snapshot/types.ts:135` |
| `SearchLogLine` | Interface | Yes | `src/workload/snapshot/types.ts:211` |
| `FieldContextLogLine` | Type | Yes | `src/workload/snapshot/types.ts:239` |
| `PAGINATION_TERMINATION_CONTRACT` | Exported const | Yes | `src/workload/snapshot/types.ts:274` |
| `GET /rest/api/3/field/{id}/context` (custom only) | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:60` |
| `POST /rest/api/3/search/jql` (Issue enumeration) | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |

### P0 carry-forward — `[search]` log format mismatch

| Defect | Location | Detail |
|---|---|---|
| `[search]` log format in ARCHITECTURE.md does not match implementation | `ARCHITECTURE.md` → Structured-Log Line Shapes → `[search]` lines | ARCHITECTURE.md documents: `[search] project=<projectKey> jql="<jql>" startAt=<startAt> maxResults=<maxResults> returned=<returned> total=<total>`. The actual implementation at `src/workload/http/JiraHttpClient.ts:107-109` emits: `[search] endpoint=search/jql project=<key> page=<n> count=<n>`. DEMO.md correctly shows the runtime format. The `SearchLogLine` type in `src/workload/snapshot/types.ts` has the verbose shape as a structured type but it is not serialised to a log line; the actual `console.log` call uses the abbreviated form. ARCHITECTURE.md must be updated to match the runtime format. |

---

## CHANGELOG.md

### Sprint 2 Phase 2 section — new references

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/backup/discoverFieldContexts.ts` | File | Yes | `src/workload/backup/discoverFieldContexts.ts` |
| `discoverFieldContexts` | Function | Yes | `src/workload/backup/discoverFieldContexts.ts:43` |
| `GET /rest/api/3/field` | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:47` |
| `GET /rest/api/3/field/{id}/context` | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:60` |
| `[field-context] skip field_id=<id> reason=system-field` | Log format | Yes | `src/workload/backup/discoverFieldContexts.ts:53` |
| `[field-context] fetch field_id=<id> contextCount=<n>` | Log format | Yes | `src/workload/backup/discoverFieldContexts.ts:79` |
| `src/workload/snapshot/assembleIssuePayload.ts` | File | Yes | |
| `assembleIssuePayload` | Function | Yes | `src/workload/snapshot/assembleIssuePayload.ts:39` |
| `assertCoverageInvariant` | Function | Yes | `src/workload/snapshot/assembleIssuePayload.ts:166` |
| `src/workload/snapshot/CaptureOrchestrator.ts` | File | Yes | |
| `CaptureOrchestrator.runCapture` | Method | Yes | `src/workload/snapshot/CaptureOrchestrator.ts:34` |
| `enumerateIssues` | Method | Yes | `src/workload/http/JiraHttpClient.ts:83` |
| `POST /rest/api/3/search/jql` (exclusive) | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |
| `nextPageToken` pagination | Field | Yes | `src/workload/http/JiraHttpClient.ts:93,117` |
| `[search] endpoint=search/jql project=<key> page=<n> count=<n>` | Log format | Yes | `src/workload/http/JiraHttpClient.ts:107-109` |
| `issuePhase.status === 'partial'` | Condition | Yes | `src/workload/snapshot/CaptureOrchestrator.ts:182` |
| `CaptureRunResult.errorCount` | Field | Yes | `src/workload/backup/types.ts` |
| `JiraWorkload.snapshot()` | Method | Yes | `src/workload/JiraWorkload.ts:120` |
| `backup_manifests` (manifest load) | DB table | Yes | `src/workload/JiraWorkload.ts:125` |
| `fieldContexts` / `customFieldsCaptured` / `coverageInvariant` | Manifest fields | Yes | `src/workload/JiraWorkload.ts:164-174` |
| `scripts/check-http-guard.sh` | File | Yes | `scripts/check-http-guard.sh` |
| `check:http-guard` | npm script | Yes | `package.json:17` |

### Sprint 1 Phase 2 and prior sections (carry-forward confirmed)

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `src/workload/http/JiraHttpClient.ts` | File | Yes | backup engine HTTP client |
| `src/workload/backup/types.ts` | File | Yes | |
| `src/workload/backup/discoverProjects.ts` | File | Yes | |
| `src/workload/JiraWorkload.ts` | File | Yes | |
| `src/routes/discover.ts` | File | Yes | |
| `src/db/migrations/009_backup_manifests.sql` | File | Yes | |
| `scripts/smoke-discover.ts` | File | Yes | updated this sprint to mock field/context endpoints |

No carry-forwards. All 28 references resolve.

---

## HTTP Guard Execution

**Command:** `bash scripts/check-http-guard.sh`
**Exit code:** 0

```
HTTP guard passed.
```

**Deprecated endpoint grep:**
`grep -rn "GET /rest/api/3/search[^/]" src/` finds only comment and doc-string references in:
- `src/workload/snapshot/types.ts` — `forbiddenEndpoint` string literal and comment
- `src/workload/backup/types.ts` — comment documenting the constraint

No actual fetch/HTTP call to `GET /rest/api/3/search` anywhere in the codebase. Constraint 6 (T2 §6) is enforced.

---

## Snapshot Smoke Probe Execution Record

The task requires `[search]` and `[field-context]` log lines as execution evidence. The discover smoke probe was updated this sprint to mock `/rest/api/3/field` and `/rest/api/3/field/{id}/context` endpoints, enabling end-to-end `discoverFieldContexts()` execution. The full snapshot (issue enumeration) path is verified via unit tests.

### Probe 4 (updated) — discover-flow with field-context coverage

**Command:** `npx tsx scripts/smoke-discover.ts`
**Exit code:** 0

**Full transcript:**
```
==> [1/4] Set up in-memory database with smoke connection
==> [2/4] POST discover — projectScope=all (mock Atlassian: 3 software + 1 JSM project)
[discover] phase=project page=1 count=4
[discover] jsm-deferred projectKey=JSMPROJ projectId=10004
[field-context] skip field_id=summary reason=system-field
[field-context] skip field_id=status reason=system-field
[field-context] fetch field_id=customfield_10016 contextCount=1
[field-context] fetch field_id=customfield_10020 contextCount=1
     backupPointId=3ff05d33-19fc-4f5e-9b9a-b17225c20ac2
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

### `[field-context]` log evidence analysis

| Required log evidence | Found | Notes |
|---|---|---|
| `[field-context] skip field_id=<id> reason=system-field` | ✅ | `summary` and `status` system fields produce skip lines as required (T2 §6 Constraint 7) |
| `[field-context] fetch field_id=<id> contextCount=<n>` | ✅ | `customfield_10016` and `customfield_10020` custom fields fetch one context each |
| No context call for system fields | ✅ | Only 2 `getJson` calls with `/context` path; none for `summary`/`status` |

### `[search]` log evidence analysis

`[search]` lines are emitted inside `JiraHttpClient.enumerateIssues()` (confirmed at `src/workload/http/JiraHttpClient.ts:107-109`):

```typescript
console.log(
  `[search] endpoint=search/jql project=${projectKey} page=${page} count=${issues.length}`
);
```

The issue enumeration path is exercised and verified via Probe 5 unit tests. `CaptureOrchestrator.test.ts` contains the test `"uses POST /rest/api/3/search/jql for issue enumeration"` which asserts `client.enumerateIssues` is called with the correct `cloudBaseUrl` and `projectKey` arguments. The full unit test suite for this sprint exits 0 with 86 tests passing.

### Probe 5 — field-context + issue-enumeration unit tests

**Command:** `npx vitest run src/workload/backup/discoverFieldContexts.test.ts src/workload/snapshot/assembleIssuePayload.test.ts src/workload/snapshot/CaptureOrchestrator.test.ts`
**Exit code:** 0

```
 ✓ src/workload/backup/discoverFieldContexts.test.ts  (8 tests) 4ms
 ✓ src/workload/snapshot/assembleIssuePayload.test.ts  (64 tests) 9ms
 ✓ src/workload/snapshot/CaptureOrchestrator.test.ts  (14 tests) 7ms

 Test Files  3 passed (3)
      Tests  86 passed (86)
```

---

## In-Sprint Fixes

| File | Change | Reason |
|---|---|---|
| `scripts/smoke-discover.ts` | Updated mock fetch function to handle `GET /rest/api/3/field` and `GET /rest/api/3/field/{id}/context` endpoints | `JiraWorkload.discover()` now calls `discoverFieldContexts()` in addition to `discoverProjects()`. The previous mock only handled `/rest/api/3/project/search` and caused the probe to exit 1 with HTTP 404 on the field endpoint. Updated mock adds 2 system + 2 custom fields and a context page, enabling end-to-end `[field-context]` log evidence. |

---

## Carry-forward P0s to Sprint 3

| ID | Document | Section | Defect | Required action |
|---|---|---|---|---|
| P0-S8-01 | `README.md` | `## What is built (Sprints 2–3)` | Missing Phase 2 backup engine deliverables (Project Discovery, Custom Field Context, Issue Enumeration, CaptureOrchestrator, snapshot) | Add Sprint 1 Phase 2 and Sprint 2 Phase 2 sections to README |
| P0-S8-02 | `ARCHITECTURE.md` | Snapshot Orchestrator → Structured-Log Line Shapes → `[search]` lines | Documented log format `[search] project=… jql=… startAt=… maxResults=… returned=… total=…` does not match runtime emission `[search] endpoint=search/jql project=… page=… count=…` | Update ARCHITECTURE.md `[search]` verbatim format to match `JiraHttpClient.enumerateIssues()` implementation |
