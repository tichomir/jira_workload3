# Final Regression Report — G-01 through G-13 Observable Signals
**Sprint:** Sprint 17 — MVP Closeout  
**Test date:** 2026-05-05  
**Author:** QA Engineer Persona  
**Test suite run:** `npm test` — 1 failed, 532 passed (533 total)  
**Verdict:** 12 PASS · 1 FAIL (P0 carry-forward — see G-09)

---

## Regression Table

| Goal ID | Observable Signal | Pass/Fail | Evidence Reference |
|---------|------------------|-----------|-------------------|
| G-01 | OAuth 2.0 (3LO) auth: `GET /rest/api/3/myself` returns HTTP 200; credential store contains non-null `accessToken` + `refreshToken` after token exchange | **PASS** | `permissionProbes.ts:12–16` — `PROBE_PATHS` includes `/rest/api/3/myself`; `permissionProbes.ts:50–51` — `[permission-probe] … endpoint=/rest/api/3/myself status=200` log; token storage in `JiraHttpClient.ts:355–361` (`db.transaction()` writes both tokens) |
| G-02 | Project discovery: `discoveredCount` equals total API-returned projects (zero-omissions); `[discover] phase=project page=<n> count=<n>` log emitted per page | **PASS** | `discoverProjects.ts:133` — `return { projects, jsmDeferredProjects, discoveredCount: totalApiCount }` (invariant: every returned project counted); `discoverProjects.ts:97` — `console.log('[discover] phase=project page=${pageNum} count=${items.length}')` |
| G-03 | Issue coverage invariant: `assertCoverageInvariant()` called per issue; `customFieldValues` map has every custom field ID; payload includes comments (ADF + author + timestamps), issue links (both directions), subtasks, sprint membership, watchers, worklogs, and attachment refs | **PASS** | `assembleIssuePayload.ts:116–118` — every custom field ID populated (null when absent); `assembleIssuePayload.ts:167–178` — `assertCoverageInvariant()` throws on field count mismatch; `assembleIssuePayload.ts:66–108` — comments, issueLinks, subtaskKeys, watcherAccountIds, worklogs, attachments assembled; `CaptureOrchestrator.ts:155–156` — `assertCoverageInvariant(payload, allCustomFieldIds)` called per issue |
| G-04 | Attachments stored binary-faithful: `[attachment] op=download id=<id> bytes=<n> sha256=<hash> outcome=ok` log; SHA-256 contentHash re-verified post-write; sidecar written only after hash check passes | **PASS** | `downloadIssueAttachments.ts:109–125` — post-write SHA-256 re-read and re-hash; mismatch surfaced as `outcome=hash_mismatch`; `downloadIssueAttachments.ts:155–157` — `[attachment] op=download … outcome=ok` log; `JiraHttpClient.ts:158` — `contentHash = createHash('sha256').update(data).digest('hex')`; `JiraHttpClient.ts:149–159` — fetches via `GET /rest/api/3/attachment/content/${attachmentId}` |
| G-05 | Backup capture order enforced: CustomField phase before Project, Project before Issue; CaptureOrchestrator executes phases in dependency order with no phase skipped | **PASS** | `CaptureOrchestrator.ts:66` — CustomField phase runs first (discoverFieldContexts); `CaptureOrchestrator.ts:105–120` — Project phase second (from manifest); `CaptureOrchestrator.ts:134+` — Issue phase third (enumerateIssues per project); phase failure in CustomField halts execution and returns `phaseDiagnostic` (`CaptureOrchestrator.ts:82–100`) |
| G-06 | Restore write dependency order enforced: `RESTORE_PHASE_ORDER` = site-reference-data → project → workflow → custom-field → board → sprint → issue → comment-attachment-subtask-issuelink; `[restore] phase=<name> outcome=start` log per phase; `job_failed { error.code: 'dependency_phase_failed' }` emitted on halt | **PASS** | `types.ts:140–149` — `RESTORE_PHASE_ORDER` const; `RestoreOrchestrator.ts:193` — `for (const phase of RESTORE_PHASE_ORDER)` (strict iteration); `RestoreOrchestrator.ts:259` — `console.log('[restore] phase=${phase} outcome=start jobId=${jobId}')` log; `RestoreOrchestrator.ts:300–303` — `job_failed { error: { code: 'dependency_phase_failed' } }` emitted on throw |
| G-07 | Canonical HTTP client handles rotating refresh tokens atomically: `[auth-refresh] connectionId=<id> mutex=acquire` / `mutex=release` bracket atomic DB transaction; concurrent refresh requests queue behind single in-flight | **PASS** | `JiraHttpClient.ts:296–315` — `_refresh()` checks `refreshPromise !== null` (single-flight mutex); `JiraHttpClient.ts:301` — `[auth-refresh] … mutex=acquire` log; `JiraHttpClient.ts:311` — `[auth-refresh] … mutex=release` log in `finally`; `JiraHttpClient.ts:355–361` — `db.transaction()` writes `accessToken` + `refreshToken` atomically before mutex releases |
| G-08 | All Issue enumeration uses `POST /rest/api/3/search/jql`; `[search] endpoint=search/jql project=<key> page=<n>` log per page; deprecated `GET /rest/api/3/search` endpoint never called | **PASS** | `JiraHttpClient.ts:97` — `const url = \`${cloudBaseUrl}/rest/api/3/search/jql\``; `JiraHttpClient.ts:98–100` — `method: 'POST'`; `JiraHttpClient.ts:133–135` — `[search] endpoint=search/jql project=${projectKey} page=${page}` log; `backup/types.ts:65` + `snapshot/types.ts:269` — `forbiddenEndpoint: 'GET /rest/api/3/search'` guard documented; grep of `src/` finds no calls to deprecated endpoint |
| G-09 | Custom field context: `[field-context] skip` log emitted for every `custom: false` field; `GET /rest/api/3/field/{id}/context` called only for `custom: true` fields; `[field-context] fetch field_id=<id> contextCount=<n>` log for each custom field | **FAIL** | **Log format mismatch:** `discoverFieldContexts.ts:52` emits `[field-context] skip field_id=${field.id} reason=system-field` but `discoverFieldContexts.test.ts:105–106` asserts regex `/\[field-context\] skip field=status reason=system/` — key name is `field_id=` (code) vs `field=` (test); reason string is `system-field` (code) vs `system` (test). Test suite reports `1 failed`. Functional guard logic is correct (`if (!field.custom) { … continue; }` at `discoverFieldContexts.ts:51`), but structured log format diverges from test expectation. **P0 carry-forward.** |
| G-10 | SDI scanner detects email, API keys, credit cards, phones; `[sdi] scan path=<file> class=<type> email=N apiKey=N cc=N phone=N` log per scanned file; GDPR regulation activated on email/phone detection; PCI DSS activated on CC detection; HIPAA absent | **PASS** | `detectors.ts:50–81` — 4 detector functions (`detectEmails`, `detectApiKeys`, `detectCreditCards`, `detectPhones`); `scanDispatcher.ts:42–83` — `scanFile()` dispatches by extension class (tabular / dev-config / text-log / xml); `scanDispatcher.ts:78–80` — `[sdi] scan … class=${fileClass}` log; `CaptureOrchestrator.ts:283–288` — `gdpr: sdiTotalEmail + sdiTotalPhone > 0 ? 'active' : 'inactive'`; `pciDss: sdiTotalCreditCard > 0 ? 'active' : 'inactive'`; HIPAA field absent from `BackupPointSdiSummary` |
| G-11 | Protected Object Inventory sidebar renders 4 object types (Issues, Projects, Boards, Sprints) with Issues as default selection; per-type count shown from most recent backup point | **PASS** | `InventorySidebar.tsx:8` — `SIDEBAR_TYPES = ['Issue', 'Project', 'Board', 'Sprint']` (Issues first); `InventorySidebar.tsx:95` — iterates `SIDEBAR_TYPES` rendering each row; `InventorySidebar.tsx:97–98` — `count = entry?.count ?? 0` from API; `App.tsx:354` — `useState<SidebarObjectType>('Issue')` — Issues is default selection |
| G-12 | Restore wizard: 3 conflict modes (Skip default, Override, Ask per conflict); 3 destination options (Original location, Alternate location same Jira site, Export/Browser Download); cross-site restore blocked | **PASS** | `RestoreWizard.tsx:42–57` — `CONFLICT_OPTIONS` with all 3 modes; `RestoreWizard.tsx:865` — `useState<ConflictMode>('skip')` default; `RestoreWizard.tsx:60–76` — `DESTINATION_OPTIONS` with 3 options; `RestoreWizard.tsx:487–494` — cross-site notice: "Cross-site restore not supported in Phase 1"; `types.ts:23` — `ConflictMode` type; `types.ts:26` — `RestoreDestinationType` type |
| G-13 | Backup/restore jobs emit progress event every ≤10s; no-heartbeat for >20s surfaces "stalled" alert in UI and logs; backup with per-item errors shows "Completed with N errors" (not "Completed successfully") | **PASS** | `HeartbeatEmitter.ts:14` — `HEARTBEAT_INTERVAL_MS = 10_000`; `ProgressEmitter.ts:56–70` — stalled watchdog fires when `silentMs > STALLED_THRESHOLD_MS`; `ProgressEmitter.ts:124` — `errorsCount > 0 ? 'completed_with_errors' : 'completed'`; RestoreWizard.tsx:126 — `STALLED_MS = 20_000`; RestoreWizard.tsx:750 — "Completed with N errors" banner; fault-injection tests `test/fault-injection/heartbeat-stall-fault-injection.test.ts` — 9 tests all PASS including stalled detection (lines 276–487) and "Completed with N errors" (lines 506–730) |

---

## P0 Carry-Forward

### P0-REG-001 — G-09: `[field-context] skip` log format divergence

**Severity:** P0 (observable signal check fails; structured log guard broken)  
**Source:** `discoverFieldContexts.test.ts:105–106` vs `discoverFieldContexts.ts:52`

**Description:**  
The `[field-context] skip` log line format in `discoverFieldContexts.ts` was updated during Sprint 16 structured log hardening, but the test assertion was not updated to match. The code emits:

```
[field-context] skip field_id=status reason=system-field
```

The test asserts:

```
/\[field-context\] skip field=status reason=system/
```

**Impact:**  
- `npm test` reports 1 failed test (532 passed, 533 total)  
- The functional guard logic (`if (!field.custom) { continue; }`) is correct — system fields ARE skipped and the context endpoint is NOT called for them  
- The structured log line format, however, does not match what the ARCHITECTURE.md log schema specifies (`field=` vs `field_id=`; `reason=system` vs `reason=system-field`)

**Resolution options (choose one):**  
1. Update `discoverFieldContexts.ts:52` to emit `field=` and `reason=system` (match the test)  
2. Update `discoverFieldContexts.test.ts:105–106` to match the code's `field_id=` and `reason=system-field` format  
3. Align both with the canonical log schema in `ARCHITECTURE.md`

**Assignee:** Backend Developer  
**Sprint:** Sprint 18 (earliest carry-forward slot)

---

## Coverage Notes

### P0-Coverage Goals (G-02..G-07) — all verified

| Goal | P0-Coverage Target | Status |
|------|--------------------|--------|
| G-02 | Zero silent omissions in project discovery | PASS |
| G-03 | Issue coverage invariant (`customFieldValues` completeness) | PASS |
| G-04 | Binary-faithful attachment with SHA-256 | PASS |
| G-05 | Capture order: CustomField before Project, Project before Issue | PASS |
| G-06 | Restore dependency order enforced; `job_failed` on phase halt | PASS |
| G-07 | Atomic rotating-token refresh with single-flight mutex | PASS |

### Test Suite Summary

```
Test Files  1 failed | 31 passed (32)
     Tests  1 failed | 532 passed (533)
  Start at  04:32:54
  Duration  3.61s
```

Failing test: `discoverFieldContexts — mixed custom/system fixture > emits [field-context] skip log for every system field`  
File: `src/workload/backup/discoverFieldContexts.test.ts:105`

All other test suites pass, including:
- Fault-injection suite (`test/fault-injection/heartbeat-stall-fault-injection.test.ts`) — all 9 tests PASS (G-13)
- Restore e2e suite (`test/restore/restore-e2e.test.ts`) — PASS (G-06)
- SDI detectors and scan dispatcher — PASS (G-10)
- RestoreOrchestrator phase ordering — PASS (G-06)
- ProgressEmitter stalled/completion semantics — PASS (G-13)
- CaptureOrchestrator unit tests — PASS (G-05)
- discoverProjects — PASS (G-02)
- assembleIssuePayload — PASS (G-03)
- downloadIssueAttachments — PASS (G-04)
- JiraHttpClient rotating-token + rate-limit — PASS (G-07, G-08)
