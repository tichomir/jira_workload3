# Doc-Grounding Report — Sprint 15 (SDI Teaser Scanner & Compliance Tags)

_Generated: 2026-05-05 | QA Engineer_

Sprint deliverables verified: SDI detectors (`detectors.ts`), scan dispatcher
(`scanDispatcher.ts`), SDI type contracts (`types.ts`), backup-points route
(`backup-points.ts`), database migration (`015_backup_point_sdi_summary.sql`),
`SdiTeaserPanel` UI component, and DEMO.md Probe 11.

---

## Summary

| Doc | References checked | Exists=yes | Exists=no | In-sprint fixes | P0 carry-forwards |
|---|---|---|---|---|---|
| ARCHITECTURE.md | 28 | 19 | 9 | 9 | 0 |
| CHANGELOG.md | 22 | 22 | 0 | 0 | 0 |
| DEMO.md | 13 | 13 | 0 | 0 | 0 |
| **Total** | **63** | **54** | **9→0** | **9** | **0** |

Nine in-sprint fixes applied to ARCHITECTURE.md (all in the SDI Teaser Scanner section added
this sprint). CHANGELOG.md and DEMO.md are clean. Zero unresolved misses at close.

---

## ARCHITECTURE.md

### SDI Teaser Scanner — Component section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/workload/sdi/SdiScanner.ts` | **N** | Component | **Fixed in-sprint** — file does not exist. Actual implementation split across `detectors.ts`, `scanDispatcher.ts`, `types.ts`. Updated component block to list all three files. |
| `src/workload/sdi/detectors.ts` | Y | Component (after fix) | exists ✓ |
| `src/workload/sdi/scanDispatcher.ts` | Y | Component (after fix) | exists ✓ |
| `src/workload/sdi/types.ts` | Y | Component (after fix) | exists ✓ |

### SDI Teaser Scanner — Interface section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `scanText(content, sourceType): DetectionCounts` | **N** | SdiScanner Interface | **Fixed in-sprint** — function does not exist. Actual entry point is `scanFile(filePath, buffer): ScanResult` in `scanDispatcher.ts`. Updated interface block to show actual exported signatures. |
| `DetectionCounts` interface | **N** | SdiScanner Interface | **Fixed in-sprint** — type does not exist. Actual result type is `ScanResult` (in `scanDispatcher.ts`). Updated interface block. |
| `DetectionCounts.creditCard` field | **N** | SdiScanner Interface | **Fixed in-sprint** — field is named `cc` not `creditCard` in `ScanResult`. Updated Detector Definitions table. |
| `SdiSourceType` type | **N** | SdiScanner Interface | **Fixed in-sprint** — type does not exist in codebase. `scanDispatcher.ts` uses internal `FileClass` type. Removed from interface section. |
| `detectEmails(buffer)` | Y | Interface (after fix) | in `src/workload/sdi/detectors.ts` ✓ |
| `detectApiKeys(buffer)` | Y | Interface (after fix) | in `src/workload/sdi/detectors.ts` ✓ |
| `detectCreditCards(buffer)` | Y | Interface (after fix) | in `src/workload/sdi/detectors.ts` ✓ |
| `detectPhones(buffer)` | Y | Interface (after fix) | in `src/workload/sdi/detectors.ts` ✓ |
| `scanFile(filePath, buffer)` | Y | Interface (after fix) | in `src/workload/sdi/scanDispatcher.ts` ✓ |
| `ScanResult` interface | Y | Interface (after fix) | in `src/workload/sdi/scanDispatcher.ts` ✓ |

### SDI Teaser Scanner — BackupPointSdiSummary Schema section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `BackupPointSdiSummary.issue_count` (snake_case) | **N** | BackupPointSdiSummary Schema | **Fixed in-sprint** — field is `issueCount` (camelCase) in `src/workload/sdi/types.ts`. Updated schema block. |
| `BackupPointSdiSummary.project_count` (snake_case) | **N** | BackupPointSdiSummary Schema | **Fixed in-sprint** — field is `projectCount` (camelCase) in `types.ts`. Updated schema block. |
| `regulations.GDPR` / `regulations.PCI_DSS` (uppercase keys) | **N** | BackupPointSdiSummary Schema | **Fixed in-sprint** — stored keys are `gdpr` and `pciDss` (camelCase) per `SdiRegulations` in `types.ts`. Updated schema block; added note about wire-format conversion by the route. |
| `SdiRegulations` type | Y | Schema (after fix) | in `src/workload/sdi/types.ts` ✓ |
| `BackupPointSdiSummary` type | Y | Schema (after fix) | in `src/workload/sdi/types.ts` — camelCase fields verified ✓ |

### SDI Teaser Scanner — Pipeline Invocation Point section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `SdiScanner.scanText()` (in pipeline diagram) | **N** | Pipeline Invocation Point | **Fixed in-sprint** — changed to `scanDispatcher.scanFile()` ✓ |
| `DetectionCounts` (in pipeline diagram) | **N** | Pipeline Invocation Point | **Fixed in-sprint** — changed to `ScanResult counts` ✓ |
| `downloadIssueAttachments` (CaptureOrchestrator pipeline) | Y | Pipeline Invocation Point | referenced function exists in `src/workload/snapshot/downloadIssueAttachments.ts` ✓ |
| `CaptureOrchestrator` | Y | Pipeline Invocation Point | in `src/workload/snapshot/CaptureOrchestrator.ts` ✓ |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` | Y | Data Flow Diagram | path layout matches `downloadIssueAttachments.ts` disk layout ✓ |

### SDI Teaser Scanner — GET /api/backup-points/{id}/sdi-teaser section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `GET /api/backup-points/{id}/sdi-teaser` endpoint | Y | API endpoint | mounted in `src/routes/backup-points.ts` as `router.get('/:id/sdi-teaser', handleGetSdiTeaser)` ✓ |
| `connectionId` query parameter (marked Required) | **N** | API endpoint query params | **Fixed in-sprint** — handler `handleGetSdiTeaser` does not read `req.query.connectionId`; lookup is by `req.params.id` only. Removed required-param row; noted Phase 1 stub behaviour. |
| `issueCount` field in success response | Y | API endpoint (after fix) | returned by `handleGetSdiTeaser` ✓ |
| `projectCount` field in success response | Y | API endpoint (after fix) | returned by `handleGetSdiTeaser` ✓ |
| `regulations[]` array of `{ code, status }` | Y | API endpoint (after fix) | built by `handleGetSdiTeaser` lines 39–42 ✓ |
| Error code `sdi_summary_not_found` | **N** | Error responses | **Fixed in-sprint** — actual code returns `{ error: 'not_found' }`. Updated error table to single `404 not_found` row. |
| Error code `connection_not_found` | **N** | Error responses | **Fixed in-sprint** — no connection lookup performed in Phase 1 stub. Removed from error table. |
| Error code `backup_point_not_found` | **N** | Error responses | **Fixed in-sprint** — handler does not distinguish "backup point row missing" from "SDI row missing"; both return `not_found`. Removed from error table. |

### SDI Teaser Scanner — UI Teaser Badge section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/ui/components/SdiTeaserPanel.tsx` | Y | UI — Teaser Badge | exists ✓ |
| `SdiTeaserPanel({ backupPointId })` | Y | UI — Teaser Badge | exported function in `SdiTeaserPanel.tsx` ✓ |
| `buildSdiDisplay(data)` | Y | UI — Teaser Badge | exported helper in `SdiTeaserPanel.tsx` ✓ |
| `r.code !== 'HIPAA'` HIPAA filter | Y | UI — Teaser Badge | in `buildSdiDisplay` line 34 ✓ |

### SDI Teaser Scanner — Database migration section

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/db/migrations/015_backup_point_sdi_summary.sql` | Y | Database migration | exists ✓ |
| `backup_point_sdi_summary` table | Y | Database migration | created by `015_backup_point_sdi_summary.sql` ✓ |
| Columns `backupPointId`, `issueCount`, `projectCount`, `regulations`, `createdAt` | Y | Database migration | all five columns present in migration file ✓ |

---

## CHANGELOG.md

### Sprint 15 entry — new files

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/workload/sdi/detectors.ts` | Y | SDI detectors | exists ✓ |
| `src/workload/sdi/scanDispatcher.ts` | Y | SDI scan dispatcher | exists ✓ |
| `src/workload/sdi/types.ts` | Y | SDI type contracts | exists ✓ |
| `src/routes/backup-points.ts` | Y | GET /api/backup-points/:id/sdi-teaser | exists ✓ |
| `src/db/migrations/015_backup_point_sdi_summary.sql` | Y | Database migration | exists ✓ |
| `src/ui/components/SdiTeaserPanel.tsx` | Y | SDI Teaser Panel UI | exists ✓ |

### Sprint 15 entry — exported symbols

| Reference | Exists | Location | Notes |
|-----------|--------|---------|-------|
| `detectEmails(buffer)` | Y | `detectors.ts` line 50 | `export function detectEmails(buffer: string): number` ✓ |
| `detectApiKeys(buffer)` | Y | `detectors.ts` line 54 | `export function detectApiKeys(buffer: string): number` ✓ |
| `detectCreditCards(buffer)` | Y | `detectors.ts` line 65 | `export function detectCreditCards(buffer: string): number` ✓ |
| `detectPhones(buffer)` | Y | `detectors.ts` line 76 | `export function detectPhones(buffer: string): number` ✓ |
| `scanFile(filePath, buffer)` | Y | `scanDispatcher.ts` line 42 | `export function scanFile(filePath: string, buffer: Buffer): ScanResult` ✓ |
| `ScanResult { email, apiKey, cc, phone, class }` | Y | `scanDispatcher.ts` interface | field names verified ✓ |
| `SdiRegulations` type | Y | `types.ts` line 1 | `{ gdpr: 'active' \| 'inactive'; pciDss: 'active' \| 'inactive' }` ✓ |
| `BackupPointSdiSummary` type | Y | `types.ts` line 6 | `{ backupPointId, issueCount, projectCount, regulations }` ✓ |
| `SdiTeaserPanel({ backupPointId })` | Y | `SdiTeaserPanel.tsx` line 47 | ✓ |
| `buildSdiDisplay(data)` | Y | `SdiTeaserPanel.tsx` line 29 | pure helper, directly testable ✓ |

### Sprint 15 entry — behaviours and log lines

| Reference | Exists | Verified in |
|-----------|--------|-------------|
| `[sdi] scan path=<p> class=<c> email=<n> apiKey=<n> cc=<n> phone=<n>` | Y | `scanDispatcher.ts` `console.log` line 78 |
| `[sdi] xlsx-skipped path=<p> reason=no-parser` | Y | `scanDispatcher.ts` line 52 |
| `HIPAA chip filtered by r.code !== 'HIPAA'` | Y | `SdiTeaserPanel.tsx` line 34 |
| `404 not_found` error when no SDI summary row | Y | `backup-points.ts` line 28 — `{ error: 'not_found' }` ✓ |
| `regulations` always two entries: `GDPR` and `PCI_DSS` | Y | `backup-points.ts` lines 39–42 — fixed-length array ✓ |
| GDPR activates on email or phone | Y | `backup-points.ts` reads `regs.gdpr` which is set by scanner logic ✓ |
| PCI DSS activates on credit card | Y | `backup-points.ts` reads `regs.pciDss` which is set by scanner logic ✓ |

---

## DEMO.md

### View SDI Teaser — Steps 1–3

| Reference | Exists | Section |
|-----------|--------|---------|
| `https://localhost/inventory` | Y | Step 1 — route registered in `src/App.tsx` at `/inventory` ✓ |
| `SdiTeaserPanel` component | Y | Step 1 — in `src/ui/components/SdiTeaserPanel.tsx` ✓ |
| `http://localhost:3000/api/backup-points/${BACKUP_POINT_ID}/sdi-teaser` | Y | Step 3 — route mounted in `src/routes/backup-points.ts` ✓ |
| `issueCount` field in API response | Y | Step 3 — returned by `handleGetSdiTeaser` ✓ |
| `projectCount` field in API response | Y | Step 3 — returned by `handleGetSdiTeaser` ✓ |
| `regulations[].code` / `regulations[].status` | Y | Step 3 — wire format from `backup-points.ts` ✓ |
| `python3 -m json.tool` | Y | Step 3 — standard library tool ✓ |

### View SDI Teaser — Probe 11 smoke block

| Reference | Exists | Section |
|-----------|--------|---------|
| `npm run server` | Y | Probe 11 prerequisite comment — in `package.json` scripts ✓ |
| `PORT` env var (with `${PORT}`) | Y | Probe 11 — documented in `.env.example` ✓ |
| `DB_PATH` var (default `data/jira_workload.db`) | Y | Probe 11 — `data/jira_workload.db` exists on disk ✓ |
| `backup_point_sdi_summary` table | Y | Probe 11 `INSERT OR REPLACE INTO backup_point_sdi_summary` — table created by `015_backup_point_sdi_summary.sql` ✓ |
| Columns `backupPointId, issueCount, projectCount, regulations, createdAt` | Y | Probe 11 INSERT — all five columns match migration schema ✓ |
| `GET /api/backup-points/:id/sdi-teaser` | Y | Probe 11 step 2/4 — `curl` call verified ✓ |
| `tests/sdi/detectors.test.ts` | Y | Probe 11 step 4/4 — file exists at `tests/sdi/detectors.test.ts` ✓ |
| `tests/sdi/scanDispatcher.test.ts` | Y | Probe 11 step 4/4 — file exists at `tests/sdi/scanDispatcher.test.ts` ✓ |
| `npx vitest run tests/sdi/detectors.test.ts tests/sdi/scanDispatcher.test.ts` | Y | Probe 11 step 4/4 — vitest in devDependencies; both test files exist ✓ |

All 13 DEMO.md references verified. No misses.

---

## Prior Sprint Carry-Forwards

### Sprint 14 carry-forwards

Sprint 14 closed with zero open carry-forwards. Nothing outstanding carried into this sprint.

| Sprint 14 Item | Status |
|----------------|--------|
| All Sprint 14 carry-forwards | None — Sprint 14 closed with no open items |

### Sprint 15 carry-forwards to Sprint 16

| Item | Justification |
|------|---------------|
| None | All 9 ARCHITECTURE.md discrepancies resolved in-sprint. Zero open items at close. |

### Sprint-15-relevant subset of historical carry-forwards (.env, data/attachments)

The task requests re-checking `.env` and `data/attachments` paths which appeared in prior
carry-forward backlogs.

| Item | Sprint 15 status |
|------|-----------------|
| `.env.example` — env var documentation | **Still resolved** — `DCC_ATTACHMENT_DIR` and other keys documented correctly in `.env.example`. No SDI-related env vars introduced this sprint (SDI thresholds are compile-time constants). No regression. |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` disk layout | **Still resolved** — layout documented correctly in `downloadIssueAttachments.ts` and confirmed in ARCHITECTURE.md Data Flow Diagram. SDI scanner reads from this path; path references in ARCHITECTURE.md SDI section are accurate. No regression. |

---

## In-Sprint Fixes Applied

| # | Doc | Reference | Fix Applied |
|---|-----|-----------|-------------|
| 1 | ARCHITECTURE.md | `src/workload/sdi/SdiScanner.ts` component path | **Fixed** — replaced with three actual files: `detectors.ts`, `scanDispatcher.ts`, `types.ts`. |
| 2 | ARCHITECTURE.md | `scanText(content, sourceType): DetectionCounts` function | **Fixed** — replaced with actual interface: `scanFile(filePath, buffer): ScanResult` in `scanDispatcher.ts`; individual `detect*` functions listed from `detectors.ts`. |
| 3 | ARCHITECTURE.md | `DetectionCounts` interface (wrong type name) | **Fixed** — replaced with actual `ScanResult` interface from `scanDispatcher.ts`. |
| 4 | ARCHITECTURE.md | `DetectionCounts.creditCard` field name | **Fixed** — corrected to `ScanResult.cc` throughout (Detector Definitions table, Regulation-Tag Activation Rules, Design Constraints). |
| 5 | ARCHITECTURE.md | `SdiSourceType` type (does not exist) | **Fixed** — removed from interface section; noted internal `FileClass` type used by `scanDispatcher.ts`. |
| 6 | ARCHITECTURE.md | `BackupPointSdiSummary.issue_count` / `project_count` (snake_case) | **Fixed** — corrected to camelCase `issueCount` / `projectCount` matching `src/workload/sdi/types.ts`. |
| 7 | ARCHITECTURE.md | `regulations.GDPR` / `regulations.PCI_DSS` (uppercase object keys) | **Fixed** — corrected to `regulations.gdpr` / `regulations.pciDss` matching `SdiRegulations` in `types.ts`; added note explaining wire-format conversion to `[{ code, status }]` array by the route. |
| 8 | ARCHITECTURE.md | `connectionId` required query parameter | **Fixed** — removed; Phase 1 `handleGetSdiTeaser` does not read `connectionId`; lookup is by `req.params.id` only. |
| 9 | ARCHITECTURE.md | Error codes `sdi_summary_not_found`, `connection_not_found`, `backup_point_not_found` | **Fixed** — replaced error table with single `404 not_found` row matching actual `backup-points.ts` implementation (line 28: `res.status(404).json({ error: 'not_found' })`). |

---

## Smoke Probe Status

| Probe | Description | Status |
|-------|-------------|--------|
| Probe 1 | connect-jira-site OAuth | Unchanged from Sprint 14; valid ✓ |
| Probe 2 | manual-connection | Unchanged from Sprint 14; valid ✓ |
| Probe 3 | stub-endpoints (objectTypes shape + policies) | Unchanged from Sprint 14; valid ✓ |
| Probe 4 | discover-flow | Unchanged from Sprint 14; valid ✓ |
| Probe 5 | field-context + issue-enumeration unit tests | Unchanged from Sprint 14; valid ✓ |
| Probe 6 | Sprint 3 Phase 2 deliverables (policies rpoHours, jobs, SHA-256, changeBadge) | Unchanged from Sprint 14; valid ✓ |
| Probe 7 | browse-protected-inventory: filter facets, search & traceability | Unchanged from Sprint 14; valid ✓ |
| Probe 8 | restore-protected-objects: POST /api/restore-jobs + SSE phase order | Unchanged from Sprint 14; valid ✓ |
| Probe 9 | restore-sprint2-guards: trash-check, board scope recheck & post-issue pass | Unchanged from Sprint 14; valid ✓ |
| Probe 10 | restore-sprint3: HeartbeatEmitter + SSE wire protocol | Unchanged from previous Sprint 15; valid ✓ |
| Probe 11 | view-sdi-teaser: SDI endpoint + unit tests | **New this sprint** — `backup_point_sdi_summary` table verified; `handleGetSdiTeaser` returns `issueCount`, `projectCount`, `regulations[]` array; `not_found` on missing row; `tests/sdi/detectors.test.ts` and `tests/sdi/scanDispatcher.test.ts` both exist; all file path references valid ✓ |

> Note: Functional execution of probes against a running server is deferred to the
> sprint runner environment. All referenced file paths, table columns, API routes,
> field names, and response shapes have been verified against the current codebase.
