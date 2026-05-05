# Phase 1 → Phase 2 Handoff Brief — Tihomir Sprint Kickoff
**Prepared by:** Software Architect Persona  
**Date:** 2026-05-05  
**Sprint:** Sprint 17 — MVP Closeout  
**Status:** Phase 1 complete. Sprint 18 is the first Phase 2 sprint.

---

## 1. Phase 1 Scope Shipped

Every deliverable below shipped in the commit range `e34cb41` (initial commit) through `1a7bc66` (Sprint 16 complete). The commit hash column identifies the sprint-complete commit that merged the work.

### Authentication & Connection (Sprints 3-S1, 3-S2 of Phase 1)

| Deliverable | Commit / File path |
|---|---|
| OAuth 2.0 (3LO) authorize redirect with full Phase 1 scope string (both `write:board-scope` variants) | `e34cb41` → `src/oauth/authorize.ts` |
| OAuth 3LO callback + token exchange + cloudId resolution | `e34cb41` → `src/oauth/tokenExchange.ts`, `src/routes/oauth.ts` |
| Canonical authenticated HTTP client with single-flight refresh mutex and atomic rotating-token DB write | `e34cb41` → `src/workload/http/JiraHttpClient.ts` |
| Four permission-validation probes (`/myself`, `/field`, `/board`, `/workflow/search`) with 403 remediation banners | `e34cb41` → `src/probes/permissionProbes.ts` |
| Manual Connection path (masked Client ID + Client Secret) | `4578b3a` → `src/routes/connections.ts` |
| Connections list UI with siteName, cloudId, status, 403 banner | `e34cb41` → `src/ui/pages/ConnectionsList.tsx` |
| cloudId mismatch detection (409 on re-auth) | `e34cb41` → `src/routes/connections.ts` |
| SQLite schema and migrations for connections, credentials, oauth_state, probe_results | `e34cb41` → `src/db/migrations/002_connections.sql` – `006_probe_results.sql` |
| POST /api/connections, GET /api/connections stub endpoints | `4578b3a` → `src/routes/connections.ts` |
| Platform Stub: POST /api/policies, GET /api/inventory, restore stub endpoints | `4578b3a` → `src/routes/policies.ts`, `src/routes/inventory.ts`, `src/routes/restores.ts` |
| Workload Card UI with Authorize button and minimum-requirements copy | `e34cb41` → `src/ui/components/WorkloadCard.tsx` |

**Operator flow delivered:** `connect-jira-site` → smoke probe: `scripts/smoke/probe-connect-jira-site.sh`

---

### Backup Engine — Discovery & Snapshot (Phase 2 Sprints 1–3 of 3)

| Deliverable | Commit / File path |
|---|---|
| Project discovery via paginated `GET /rest/api/3/project/search` with `projectScope` (all / selected) | `1a40054` → `src/workload/backup/discoverProjects.ts` |
| JSM project detection (`projectTypeKey === 'service_desk'`) → `PHASE_2_DEFERRED` manifest flag | `1a40054` → `src/workload/backup/discoverProjects.ts:partitionJsmProjects()` |
| Issue enumeration via `POST /rest/api/3/search/jql` (pagination: `issues.length === 0 \|\| < maxResults`); deprecated `GET /rest/api/3/search` never called | `ea021d8` → `src/workload/http/JiraHttpClient.ts:enumerateIssues()` |
| Custom field context discovery — `GET /rest/api/3/field/{id}/context` only for `custom: true` fields; `[field-context] skip` emitted for system fields | `ea021d8` → `src/workload/backup/discoverFieldContexts.ts` |
| CaptureOrchestrator enforcing dependency order: CustomField → Project → Issue | `ea021d8` → `src/workload/snapshot/CaptureOrchestrator.ts` |
| Issue payload assembler — all system + custom field values, ADF comments, issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs; `assertCoverageInvariant()` per issue | `ea021d8` → `src/workload/snapshot/assembleIssuePayload.ts` |
| Binary-faithful attachment download via `GET /rest/api/3/attachment/content/{id}`; SHA-256 `contentHash` verified post-write; sidecar written only after hash check | `827761e` → `src/workload/snapshot/downloadIssueAttachments.ts` |
| Attachment binary storage layout | `827761e` → `data/attachments/` |
| Backup manifest deletion-diff with `added / modified / deleted / unchanged` change badges | `827761e` → `src/workload/backup/computeManifestDiff.ts` |
| `POST /api/policies` with `rpoHours`, `retentionDays`, `projectScope`, optional `jqlFilter` validated via `POST /rest/api/3/jql/parse` | `827761e` → `src/routes/policies.ts` |
| Backup job progress heartbeat ≤10 s, stalled alert >20 s, `'Completed with N errors'` status semantics | `827761e` → `src/workload/snapshot/ProgressEmitter.ts` |
| SQLite migrations for backup manifests, backup jobs, policies, inventory items, attachments | `827761e` → `src/db/migrations/009_backup_manifests.sql` – `013_inventory_items_attachments.sql` |
| `JiraWorkload.discover()` and `JiraWorkload.snapshot()` wired into `PlatformWorkloadInterface` | `1a40054` / `ea021d8` → `src/workload/JiraWorkload.ts` |

**Operator flow delivered:** `run-first-backup` → smoke probe: `scripts/smoke/probe-run-first-backup.sh`

---

### Protected Object Inventory & Browse Flow (Phase 3 Sprints 1–2 of 2)

| Deliverable | Commit / File path |
|---|---|
| `GET /api/inventory` — object-type counts + `lastBackupAt` per type | `518173f` → `src/routes/inventory.ts` |
| `GET /api/inventory/{type}` — paginated explorer with `connectionId`, `backupPointId`, `limit`, `offset` | `518173f` → `src/routes/inventory.ts` |
| Inventory sidebar UI with 4 object types (Issues default, Projects, Boards, Sprints) and per-type counts | `518173f` → `src/ui/components/InventorySidebar.tsx` |
| Object Explorer list view with pagination and `changeBadge` | `518173f` → `src/ui/components/ObjectExplorer.tsx` |
| Issue `displayName` rendered as `<PROJECT_KEY>-<N>` | `518173f` → `src/routes/inventory.ts` |
| Filter facets: status, issueType, assignee, sprint, board, label, priority, date-range on `updated` | `5b04f5a` → `src/routes/inventory.ts` |
| Exact-match Issue key search + tokenized case-insensitive summary search | `5b04f5a` → `src/routes/inventory.ts` |
| Tokenized attachment filename search | `5b04f5a` → `src/routes/inventory.ts` |
| Body-content search explicitly disabled (no full-text ADF scan) | `5b04f5a` → `src/routes/inventory.ts` |
| JSM project exclusion from sidebar counts and inventory results | `5b04f5a` → `src/routes/inventory.ts` |
| Single-click traceability from inventory item to backup-point ID + timestamp | `5b04f5a` → `src/ui/components/ObjectExplorer.tsx` |

**Operator flow delivered:** `browse-protected-inventory` → smoke probe: `scripts/smoke/probe-browse-protected-inventory.sh`

---

### Restore Wizard & Dependency-Ordered Restore (Phase 4 Sprints 1–3 of 3)

| Deliverable | Commit / File path |
|---|---|
| `POST /api/restore-jobs` Platform Stub endpoint | `599718a` → `src/routes/restore-jobs.ts` |
| `RestoreOrchestrator` — strict phase ordering: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink | `ddca167` → `src/workload/restore/RestoreOrchestrator.ts` |
| `RESTORE_PHASE_ORDER` const enforcing dependency chain | `ddca167` → `src/workload/restore/types.ts` |
| `GET /api/restore-jobs/:id/events` SSE stream with phase events in dependency order; `job_failed { error.code: 'dependency_phase_failed', phase: <name> }` on halt | `ddca167` → `src/routes/restore-jobs.ts`, `src/platform/restore/sseEvents.ts` |
| Pre-restore scope re-check for both `write:board-scope` variants before Board phase | `0effab9` → `src/workload/restore/boardScopeRecheck.ts` |
| Atlassian native trash detection — in-place restore blocked for projects in 30–60d trash; alternate-location forced | `0effab9` → `src/workload/restore/trashDetectionGuard.ts` |
| Post-issue-creation pass — comments, subtasks, issuelinks restored with counts in restore report | `0effab9` → `src/workload/restore/postIssueCreationPass.ts` |
| `HeartbeatEmitter` — ≤10 s heartbeat on restore job stream; >20 s stalled-alert detection | `ddca167` → `src/workload/restore/HeartbeatEmitter.ts` |
| Best-effort ADF media-link rewrite warning in restore report (full rewrite deferred Phase 2) | `0effab9` → `src/workload/restore/postIssueCreationPass.ts` |
| Restore Wizard UI — conflict modes (Override, Skip default, Ask per conflict); destination selector (Original, Alternate, Export/Browser Download); cross-site blocked | `599718a` / `0effab9` → `src/platform/ui/restore/RestoreWizard.tsx` |
| Restore Job Progress view consuming SSE phase events with heartbeat freshness and stalled banner | `ddca167` → `src/platform/ui/restore/RestoreJobProgress.tsx` |
| SQLite migration for restore_jobs | `599718a` → `src/db/migrations/014_restore_jobs.sql` |

**Operator flow delivered:** `restore-protected-objects` → smoke probe: `scripts/smoke/probe-restore-protected-objects.sh`

---

### SDI Teaser Scanner & Compliance Tags (Phase 5 Sprint 15)

| Deliverable | Commit / File path |
|---|---|
| SDI detectors — email (RFC-5322), API keys (well-known prefixes + Shannon entropy), credit cards (Luhn), phone numbers (E.164 + NANP) | `6c59257` → `src/workload/sdi/detectors.ts` |
| File-type scan dispatcher — xml, tabular (.csv/.tsv/.xlsx), dev-config (.env/.yaml/.yml/.json/.toml/.properties/.config), text-log (.txt/.log/.md) | `6c59257` → `src/workload/sdi/scanDispatcher.ts` |
| GDPR regulation tag activated on email or phone detection; PCI DSS on credit card; HIPAA absent from Phase 1 | `6c59257` → `src/workload/snapshot/CaptureOrchestrator.ts:283–288` |
| Aggregate `issueCount` / `projectCount` rollups per backup point; no per-item findings exposed | `6c59257` → `src/db/migrations/015_backup_point_sdi_summary.sql` |
| `GET /api/backup-points/:id/sdi-teaser` Platform Stub endpoint | `6c59257` → `src/routes/backup-points.ts` |
| SDI Teaser Panel UI — badge and regulation chips | `6c59257` → `src/ui/components/SdiTeaserPanel.tsx` |

**Operator flow delivered:** `view-sdi-teaser` → smoke probe: `scripts/smoke/probe-view-sdi-teaser.sh`

---

### Observability, Hardening & CI (Phase 5 Sprint 16)

| Deliverable | Commit / File path |
|---|---|
| Structured log lines for all 6 observable tags: `[search]`, `[field-context]`, `[permission-probe]`, `[jql-validate]`, `[restore]`, `[auth-refresh]` | `1a7bc66` → `src/workload/http/JiraHttpClient.ts`, `src/workload/backup/discoverFieldContexts.ts`, `src/probes/permissionProbes.ts`, `src/routes/policies.ts`, `src/workload/restore/RestoreOrchestrator.ts`, `src/workload/http/JiraHttpClient.ts` |
| Exponential backoff for Atlassian 429 responses — `RATE_LIMIT_MAX_RETRIES=4`, `RATE_LIMIT_BASE_MS=1000 ms`, `RATE_LIMIT_MAX_MS=8000 ms`; `Retry-After` header respected; `[rate-limit]` log per retry | `1a7bc66` → `src/workload/http/JiraHttpClient.ts:_retryWithBackoff()` |
| `RateLimitedError` typed error thrown after all retries exhausted | `1a7bc66` → `src/workload/http/JiraHttpClient.ts` |
| CI smoke-probe suite — GitHub Actions workflow triggering all 5 operator-flow probes on push/PR to `main`/`master` | `1a7bc66` → `.github/workflows/smoke-probes.yml` |
| Local smoke runner — `scripts/run-smoke-probes.sh` | `1a7bc66` → `scripts/run-smoke-probes.sh` |
| Engineer operations runbook | `1a7bc66` → `docs/OPERATIONS.md` |
| Fault-injection test suite validating heartbeat, stalled-alert, and job-status semantics | `1a7bc66` → `test/fault-injection/heartbeat-stall-fault-injection.test.ts` |

---

### Regression Results — G-01 through G-13 (Sprint 17)

Final regression report: `docs/qa/final-regression-sprint17.md`

| Goal | Signal | Result |
|---|---|---|
| G-01 | OAuth credential round-trip | **PASS** |
| G-02 | Zero-omission project discovery | **PASS** |
| G-03 | Issue coverage invariant | **PASS** |
| G-04 | Binary-faithful attachments with SHA-256 | **PASS** |
| G-05 | Backup capture order enforced | **PASS** |
| G-06 | Restore dependency order enforced | **PASS** |
| G-07 | Atomic rotating-token refresh | **PASS** |
| G-08 | `POST /rest/api/3/search/jql` only | **PASS** |
| G-09 | `[field-context] skip` log format | **FAIL** (P0 carry-forward — see §4) |
| G-10 | SDI scanner + regulation tags | **PASS** |
| G-11 | Inventory sidebar 4 object types | **PASS** |
| G-12 | Restore wizard conflict modes + destinations | **PASS** |
| G-13 | Heartbeat ≤10 s, stalled >20 s, Completed with N errors | **PASS** |

Test suite as of Sprint 17: **1 failed, 532 passed (533 total)**. The one failure is the P0 carry-forward documented below.

---

## 2. Phase 2 Deferrals

These items are explicitly out of scope for Phase 1. They are tracked as Phase 2 backlog per the PRD §3. None were partially implemented — they were deliberately excluded.

| Deferred Item | PRD Reference | Notes |
|---|---|---|
| **Jira Service Management (JSM) objects** — JSMTicket, JSMQueue, JSMRequestType, JSMSLA | T1 §1, T2 §6 Constraint 11, T3 §3.2 | Sites with `service_desk` project type detected and flagged in manifest as `PHASE_2_DEFERRED`; JSM projects silently excluded from all backup phases and inventory counts. Onboarding wizard surfaces an out-of-scope notice on detection. |
| **Audit Log backup** — AuditLog node type | T1 §1, T3 §3.2, T6 §2 | Requires `read:audit-log:jira` or coverage under `manage:jira-configuration`; pending Engineering confirmation (T6 OQ-2). |
| **Cross-site restore** — backup from site A (cloudId A) to site B (cloudId B) | T2 OQ-3, T5 §5.2 | Atlassian `accountId`s and custom field IDs are site-scoped; remapping tables required. Cross-site option blocked in UI with an explicit message. |
| **Incremental backup** | T3 §4.3 | Phase 1 model is full-snapshot daily backup only. Incremental via `updated >= {lastBackupTimestamp}` is a Phase 2 performance optimization. |
| **Custom backup window** | T4 §3 | Backup timing is platform-managed. No per-workload schedule exposure in Phase 1. |
| **GFS (Grandfather-Father-Son) retention** | T4 §2 | Phase 1 uses flat RPO+Retention (Configuration A). GFS re-evaluation is gated on a named JSM-compliance customer requirement. |
| **Blob storage export destination** — S3 / Azure Blob / GCS | T5 §5.2 | Export destination in Phase 1 is Browser Download only. |
| **ADF media link rewriting post-attachment-restore** | T5 OQ-5, T5 §7 Constraint 10 | Restored attachments receive new `attachmentId` values; ADF media node refs in Issue descriptions and comments may break. A best-effort warning is emitted in the restore report; full rewrite pass is Phase 2. |
| **Merge conflict mode** | T5 §5.1 | No read-compare-write cycle in Phase 1. Deferred due to rate-limit constraints. |
| **Full JSM teaser SDI profile** | T7 OQ-3 | Separate T7 for JSM is Phase 2. HIPAA tag is also excluded from Phase 1 (`SdiTeaserPanel` renders only GDPR and PCI DSS). |
| **Restore from Atlassian native project trash** | T5 §4.2 | Projects in the 60-day Atlassian-managed trash window are blocked for in-place restore and must use alternate-location restore. Native trash API integration is not in scope. |
| **SMB GTM motion** | T1 §2 | Sub-50-seat customers are a Phase 2 target. |

---

## 3. Open-Question Log

All OQ-* references from the T-docs with current status as of Phase 1 closeout.

| OQ Reference | Question | Owner | Current Status |
|---|---|---|---|
| **T2 OQ-3** | Cross-site restore: Atlassian `accountId`s and custom field IDs are site-scoped. Can they be remapped across a site boundary? | Engineering (Phase 2) | **Deferred.** Phase 1 explicitly blocks cross-site restore in the UI. Phase 2 resolution requires a remapping-table design for `accountId`, custom field IDs, and project keys across `cloudId` boundaries. No investigation started. |
| **T5 OQ-5** | ADF media link rewriting: restored attachments receive new `attachmentId` values. Should ADF `media` nodes in Issue descriptions and comments be rewritten to point at new IDs post-restore? | Engineering (Phase 2) | **Deferred.** Phase 1 emits a best-effort warning in the restore report when attachments are restored (see `src/workload/restore/postIssueCreationPass.ts`). A full rewrite pass requires iterating every ADF document, resolving old→new attachment ID mappings, and re-submitting Issue description/comment updates via the Jira API. Not started. |
| **T6 OQ-2** | Audit Log backup: does the Atlassian scope `read:audit-log:jira` cover the audit log endpoint, or does it require `manage:jira-configuration`? | Engineering / Atlassian API confirmation | **Open.** Audit log backup is a Phase 2 deliverable. The scope ambiguity has not been resolved — Engineering confirmation from Atlassian partner docs is required before implementation can begin. Suggested next step: test `GET /rest/api/3/auditing/record` with the Phase 1 scope set on a sandbox site. |
| **T7 OQ-3** | Full JSM SDI teaser profile: should JSM objects (JSMTicket, queue metadata) be included in SDI scanning? | Engineering (Phase 2) | **Deferred.** Phase 1 SDI scanner covers entities.xml, tabular exports, dev-config attachments, and text/log attachments for non-JSM objects only. A separate T7 for JSM is a Phase 2 item. The HIPAA regulation tag (relevant to JSM medical-data scenarios) is also excluded from Phase 1 by design. |

---

## 4. Known Risks and Carry-Forward Backlog

### P0 Carry-Forward — Sprint 18

| ID | Description | Severity | Assigned To | File |
|---|---|---|---|---|
| **P0-REG-001** | `[field-context] skip` log format mismatch between code and test. Code emits `field_id=<id> reason=system-field`; test asserts `field=<id> reason=system`. One test failing (`discoverFieldContexts.test.ts:105`). Functional guard logic correct — system fields are skipped and context endpoint is not called. | P0 (structured log guard broken; 1 failing test) | Backend Developer | `src/workload/backup/discoverFieldContexts.ts:52` vs `src/workload/backup/discoverFieldContexts.test.ts:105–106` |

**Resolution options (one required in Sprint 18):**
1. Update `discoverFieldContexts.ts:52` to emit `field=` and `reason=system` (match the test, simpler change).
2. Update `discoverFieldContexts.test.ts:105–106` to match the code's `field_id=` and `reason=system-field` format.
3. Align both with the canonical log schema documented in `ARCHITECTURE.md` (authoritative choice — aligns observable log, code, and tests).

### Known Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Atlassian token rotation race** | Low (mutex implemented) | High (stale credential breaking all jobs for a connection) | Single-flight refresh mutex in `src/workload/http/JiraHttpClient.ts:_refresh()`. Atomic DB write in SQLite transaction. Monitor `[auth-refresh] outcome=failure` in production logs. |
| **Rate-limit exhaustion on large sites** | Medium | Medium (job fails with `RateLimitedError` after 4 retries) | Exponential backoff with `Retry-After` header support. `RATE_LIMIT_MAX_RETRIES=4` is a compile-time constant — Phase 2 should expose this as a config knob for large sites. |
| **Attachment hash mismatch on disk** | Very Low | Low (sidecar not written; error counted; `completed_with_errors`) | SHA-256 post-write verify in `downloadIssueAttachments.ts`. Mismatch surfaces as `outcome=hash_mismatch` log line and increments `errorCount`. |
| **JSM project scope growing post-backup** | Low | Low (new JSM projects skipped silently) | Every backup run re-runs `discoverProjects.ts:partitionJsmProjects()`. New JSM projects are added to the `jsmDeferredProjects` manifest array on the next backup. No data loss. |
| **Scope drift on Atlassian app permission change** | Low | High (Board restore phase fails) | Board-scope re-check guard fires before every Board phase (`boardScopeRecheck.ts`). Ops runbook §2 covers resolution. |
| **ADF media link breakage post-restore** | High (expected) | Low (cosmetic only; issue content intact) | Best-effort warning in restore report. Full resolution is a Phase 2 deliverable (T5 OQ-5). |

### Carry-Forward Backlog Snapshot (post-Sprint 17)

Items explicitly flagged in earlier sprints as not yet resolved:

| Item | Source | Priority |
|---|---|---|
| P0-REG-001: `[field-context]` log format alignment | `docs/qa/final-regression-sprint17.md` | P0 — Sprint 18 |
| T6 OQ-2: Audit log scope clarification with Atlassian | Sprint history | P1 — Phase 2 kickoff |
| T2 OQ-3: Cross-site restore remapping-table design | Sprint history | P1 — Phase 2 Sprint 1 |
| T5 OQ-5: ADF media-link rewrite pass post-restore | Sprint history | P2 — Phase 2 Sprint 2 |
| Rate-limit retry count exposed as config knob (large sites) | Risk table above | P2 — Phase 2 |
| `.xlsx` scan support in SDI (currently skipped with a log line) | `src/workload/sdi/scanDispatcher.ts` | P3 — Phase 2 |

---

## 5. Quick-Start Pointers

All documentation is in the project root or `docs/` directory.

| Document | Path | Purpose |
|---|---|---|
| **README** | `README.md` | Top-level orientation: what is built, quick-links table |
| **Install guide** | `INSTALL.md` | Prerequisites, environment setup (`.env.example`), start instructions, CI secrets configuration |
| **Demo walkthrough** | `DEMO.md` | Step-by-step operator flows with machine-readable smoke probes for each flow |
| **Operations runbook** | `docs/OPERATIONS.md` | Engineer runbook for the 4 most common failure modes: connection failure, scope drift, refresh-token rotation, JSM-site detection |
| **Architecture reference** | `ARCHITECTURE.md` | Platform/workload boundary, `PlatformWorkloadInterface` contract, backup engine internals, restore orchestrator, SDI scanner, structured log schema |
| **Changelog** | `CHANGELOG.md` | Sprint-by-sprint release notes with file-level detail per deliverable |
| **CI workflow** | `.github/workflows/smoke-probes.yml` | GitHub Actions smoke-probe suite — runs all 5 operator-flow probes on every push/PR |
| **Smoke probes** | `scripts/smoke/probe-*.sh` | Individual operator-flow probes: `connect-jira-site`, `run-first-backup`, `browse-protected-inventory`, `restore-protected-objects`, `view-sdi-teaser` |
| **Local smoke runner** | `scripts/run-smoke-probes.sh` | Runs all probes locally against a live server instance |
| **Final regression report** | `docs/qa/final-regression-sprint17.md` | G-01 through G-13 signal verification with file/line evidence |
| **Job-status semantics QA** | `docs/qa/job-status-semantics-sprint17.md` | Five-case validation of "Completed with N errors" vs "Completed successfully" vs "Failed" |

### Environment setup (30-second version)

```bash
# 1. Copy and fill in credentials
cp .env.example .env
# Edit ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, OAUTH_REDIRECT_URI

# 2. Install dependencies
npm install

# 3. Start the API server (port 3000 by default)
npm run server

# 4. Run the test suite
npm test

# 5. Run smoke probes against a live server
bash scripts/run-smoke-probes.sh
```

### Key source entry points

| Concern | Entry point |
|---|---|
| Platform/workload boundary | `src/platform_workload_iface.ts` |
| HTTP client (backup/restore) | `src/workload/http/JiraHttpClient.ts` |
| HTTP client (OAuth/connection layer) | `src/http/JiraHttpClient.ts` |
| Backup discover + snapshot | `src/workload/JiraWorkload.ts` |
| Capture orchestrator | `src/workload/snapshot/CaptureOrchestrator.ts` |
| Restore orchestrator | `src/workload/restore/RestoreOrchestrator.ts` |
| SDI scanner | `src/workload/sdi/scanDispatcher.ts` |
| Inventory API routes | `src/routes/inventory.ts` |
| Restore job routes + SSE | `src/routes/restore-jobs.ts` |
| SQLite migrations | `src/db/migrations/` |
| UI app shell | `src/App.tsx` |

---

*Prepared for Tihomir's Phase 2 sprint kickoff. Phase 1 is feature-complete with one P0 carry-forward (P0-REG-001) targeting Sprint 18. All operator flows smoke-probe clean. CI gate is live on `main`/`master`.*
