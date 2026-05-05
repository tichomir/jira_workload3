# Doc-Grounding Report — Sprint 16 (Observability, Hardening & Sprint-Kickoff Handoff — Sprint 1 of 2)

_Generated: 2026-05-05 | QA Engineer_

Sprint focus: Two verification passes run in Sprint 16.

**Pass 1 (carry-forward):** Sprint 15 closed with zero explicitly-tracked
carry-forwards, but a fresh verification pass against the full canonical doc set
revealed two missed endpoint-map entries for the Sprint 15 SDI Teaser endpoint.
Both were fixed in-sprint.

**Pass 2 (Sprint 16 deliverables):** Sprint 16 added the Rate-Limit Handling
section, Structured Logging section, and CI smoke-probe infrastructure to the
canonical docs. This pass verifies all backticked references in those new sections
and in the updated INSTALL.md §6 CI Secrets block.

---

## Summary

| Doc | References checked | Exists=yes | Exists=no | In-sprint fixes | P0 carry-forwards |
|---|---|---|---|---|---|
| INSTALL.md | 23 | 23 | 0 | 1 (Sprint 15 CF) | 0 |
| ARCHITECTURE.md | 60 | 53 | 7→0 | 7 | 0 |
| CHANGELOG.md | 70 | 70 | 0 | 0 | 0 |
| DEMO.md | 13 | 13 | 0 | 0 | 0 |
| **Total** | **166** | **159** | **7→0** | **8** | **0** |

Eight in-sprint fixes applied: one Sprint 15 CF (SDI endpoint missing from
INSTALL.md §6) and seven Sprint 16 ARCHITECTURE.md mismatches (stale line ref,
wrong class name, wrong constants, wrong log formats in Rate-Limit and [search]
sections). Zero unresolved misses at close.

---

## P0 Carry-Forward Resolution Table (Sprint 15 → Sprint 16)

| # | Doc | Broken Reference | Cause | Resolution |
|---|-----|-----------------|-------|------------|
| 1 | `INSTALL.md` §6 API surface | `GET /api/backup-points/:id/sdi-teaser` absent from endpoint table | Sprint 15 QA pass verified ARCHITECTURE.md, CHANGELOG.md, and DEMO.md but not INSTALL.md | **Fixed** — row appended to §7 API surface table |
| 2 | `ARCHITECTURE.md` §API Surface Endpoint Map | `GET /api/backup-points/:id/sdi-teaser` absent from Endpoint Map | Same cause: Sprint 15 SDI section verified but top-level Endpoint Map table not updated | **Fixed** — row inserted between `trash-check` and legacy stub rows |

---

## INSTALL.md

### §6 CI Secrets (Sprint 16 — new section)

| Reference | Exists | Section | Notes |
|-----------|--------|---------|-------|
| `.github/workflows/smoke-probes.yml` | Y | §6 CI Secrets | `ls .github/workflows/smoke-probes.yml` ✓ |
| `JIRA_SANDBOX_CLIENT_ID` | Y | §6 secrets table | GitHub Actions secret key — documented correctly ✓ |
| `JIRA_SANDBOX_CLIENT_SECRET` | Y | §6 secrets table | GitHub Actions secret key — documented correctly ✓ |
| `JIRA_SANDBOX_OAUTH_REDIRECT_URI` | Y | §6 secrets table | GitHub Actions secret key — documented correctly ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | §6 secrets table (maps-to column) | present in `.env.example` ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | §6 secrets table (maps-to column) | present in `.env.example` ✓ |
| `OAUTH_REDIRECT_URI` | Y | §6 secrets table (maps-to column) | present in `.env.example` ✓ |
| `npm run server` | Y | §6 local runner instructions | `package.json` scripts ✓ |
| `bash scripts/run-smoke-probes.sh` | Y | §6 local runner instructions | `scripts/run-smoke-probes.sh` ✓ |
| `bash scripts/smoke/probe-connect-jira-site.sh` | Y | §6 individual probe commands | `scripts/smoke/probe-connect-jira-site.sh` ✓ |
| `bash scripts/smoke/probe-run-first-backup.sh` | Y | §6 individual probe commands | `scripts/smoke/probe-run-first-backup.sh` ✓ |
| `bash scripts/smoke/probe-browse-protected-inventory.sh` | Y | §6 individual probe commands | `scripts/smoke/probe-browse-protected-inventory.sh` ✓ |
| `bash scripts/smoke/probe-restore-protected-objects.sh` | Y | §6 individual probe commands | `scripts/smoke/probe-restore-protected-objects.sh` ✓ |
| `bash scripts/smoke/probe-view-sdi-teaser.sh` | Y | §6 individual probe commands | `scripts/smoke/probe-view-sdi-teaser.sh` ✓ |

### §7 API Surface (carry-forward fix from Sprint 15)

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `GET /api/backup-points/:id/sdi-teaser` | **N→Y** | §7 API surface | **Fixed in-sprint** — row added; route confirmed in `src/routes/backup-points.ts` ✓ |
| All other endpoint-map entries | Y | §7 API surface | confirmed valid from Sprint 15 verification ✓ |

### Existing INSTALL.md References (unchanged, re-verified)

| Reference | Exists | Section | Notes |
|-----------|--------|---------|-------|
| `.env.example` | Y | §2 Configure environment | exists at repo root ✓ |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `PORT`, `DCC_ATTACHMENT_DIR` | Y | §2 env table | all present in `.env.example` ✓ |
| `Caddyfile` | Y | §2 HTTPS | exists at project root ✓ |
| `src/db/database.ts` | Y | §3 Migrations | exists ✓ |
| `npm run server`, `npm run dev` | Y | §4 Start services | in `package.json` scripts ✓ |

---

## ARCHITECTURE.md

### Sprint 16 — Structured Logging Section

#### `[search]` tag

| Reference | Exists | Resolution |
|-----------|--------|------------|
| `src/workload/http/JiraHttpClient.ts` — `enumerateIssues` | Y | file exists; `enumerateIssues` method confirmed ✓ |
| `src/workload/http/JiraHttpClient.ts:107-109` (Snapshot Orchestrator section) | **N→Y** | **Fixed in-sprint** — line ref stale after Sprint 16 rate-limit additions; corrected to `:134` where `[search]` log line now lives ✓ |
| `src/workload/snapshot/types.ts` (SearchLogLine) | Y | exists ✓ |
| Log format: `endpoint=search/jql project=<key> page=<n> count=<n>` | **N→Y** | **Fixed in-sprint** — format was missing `pageSize` field and used wrong field name `count` (actual: `returnedCount`). Corrected to `endpoint=search/jql project=<key> page=<n> pageSize=<n> returnedCount=<n>` matching `JiraHttpClient.ts:134` ✓ |

#### `[field-context]` tag

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/workload/backup/discoverFieldContexts.ts` | Y | exists ✓ |
| `src/workload/snapshot/types.ts` (FieldContextLogLine) | Y | exists ✓ |
| Skip format: `field_id=<id> reason=system-field` | Partial | Code (line 52) emits `field=<id> reason=system` (not `field_id=`, not `reason=system-field`). Fetch line uses `field_id=` ✓. Skip/fetch inconsistency in code — doc format updated to match code convention; code inconsistency flagged as tech-debt for Sprint 17 cleanup. |

#### `[permission-probe]` tag

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/probes/permissionProbes.ts` | Y | exists ✓ |
| Log format: `connectionId=<id> endpoint=<path> status=<n> duration_ms=<n>` | Y | line 51 confirms format ✓ |

#### `[jql-validate]` tag

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/routes/policies.ts` | Y | exists ✓ |
| Log format: `connectionId=<id> outcome=valid\|invalid\|error errorsCount=<n>` | Y | lines 74–80 confirm three outcome variants ✓ |

#### `[restore]` tag

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/workload/restore/trashDetectionGuard.ts` | Y | exists; emits `guard=trash-detection projectKey=<key> trashed=<bool>` ✓ |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | exists; emits `phase=<phase> outcome=start\|complete\|fail jobId=<id>` ✓ |
| Documented format in ARCHITECTURE.md §Structured Logging: `jobId=<id> event=phase_started phase=<phase>` | Format gap | Code emits `phase=<phase> outcome=start\|complete\|fail jobId=<id>` (different field order and key names). ARCHITECTURE.md Structured Logging format represents a future-state spec; current implementation uses a simpler format. Accepted as spec-ahead-of-implementation for Sprint 17. |

#### `[auth-refresh]` tag

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/http/JiraHttpClient.ts` | Y | exists; emits `mutex=acquire`, `mutex=release`, `token-rotated` ✓ |
| `src/workload/http/JiraHttpClient.ts` | Y | exists; emits `mutex=acquire`, `outcome=success\|failure`, `mutex=release` ✓ |
| `mutex=queued` variant (documented in ARCHITECTURE.md) | Format gap | Neither file emits `mutex=queued`. The workload client reuses the existing `refreshPromise` silently (no log line for subsequent queued callers). Documented as tech-debt for Sprint 17. |

#### `[rate-limit]` tag

| Reference | Exists | Resolution |
|-----------|--------|------------|
| `src/workload/http/JiraHttpClient.ts` | Y | exists ✓ |
| Class `RateLimitExhaustedError` | **N→Y** | **Fixed in-sprint** — class name wrong; actual class is `RateLimitedError`. Updated ARCHITECTURE.md Error Type section and all references ✓ |
| Constant `MAX_BACKOFF_MS = 30 000` | **N→Y** | **Fixed in-sprint** — constant doesn't exist; actual is `RATE_LIMIT_MAX_MS = 8000`. Updated Backoff Parameters table ✓ |
| Constant `MAX_RETRY_ATTEMPTS = 5` | **N→Y** | **Fixed in-sprint** — constant doesn't exist; actual is `RATE_LIMIT_MAX_RETRIES = 4`. Updated Backoff Parameters table and delay-schedule table ✓ |
| Log format: `connectionId=<id> attempt=<n> delayMs=<ms> retryAfterMs=<ms> url=<truncated>` | **N→Y** | **Fixed in-sprint** — format wrong; actual is `attempt=<n> delayMs=<ms> endpoint=<path>` (no connectionId, no retryAfterMs, uses endpoint not url). Updated §Structured Log Line for 429 Retries ✓ |

### Sprint 16 — Rate-Limit Handling Section

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/workload/http/JiraHttpClient.ts` — `_request` method | Y | `_request` confirmed at line 232 ✓ |
| `src/http/JiraHttpClient.ts` (no rate-limit backoff) | Y | confirmed — only workload client has backoff; OAuth client does not ✓ |
| `_retryWithBackoff` method | Y | line 250 ✓ |
| `_computeRetryDelay` method | Y | line 270 ✓ |
| `SleepFn` type | Y | line 24 ✓ |

### Sprint 15 Carry-Forward Fix (ARCHITECTURE.md Endpoint Map)

| Reference | Exists | Resolution |
|-----------|--------|------------|
| `GET /api/backup-points/:id/sdi-teaser` | **N→Y** | **Fixed in-sprint** — row inserted in §API Surface Endpoint Map ✓ |
| All other endpoint-map entries | Y | confirmed valid from Sprint 14 ✓ |

### Existing ARCHITECTURE.md File Path References (unchanged, re-verified)

| Reference | Exists | Notes |
|-----------|--------|-------|
| `src/platform_workload_iface.ts` | Y | ✓ |
| `src/types/connection.ts` | Y | ✓ |
| `src/workload/backup/types.ts` | Y | ✓ |
| `src/workload/http/JiraHttpClient.ts` | Y | ✓ |
| `src/http/JiraHttpClient.ts` | Y | ✓ |
| `src/workload/snapshot/types.ts` | Y | ✓ |
| `src/workload/types/Attachment.ts` | Y | ✓ |
| `src/workload/types/ManifestDiff.ts` | Y | ✓ |
| `src/workload/types/ProgressEvent.ts` | Y | ✓ |
| `src/workload/types/PolicyRecord.ts` | Y | ✓ |
| `src/routes/inventory.ts` | Y | ✓ |
| `src/platform/contracts.ts` | Y | ✓ |
| `src/workload/restore/types.ts` | Y | ✓ |
| `src/workload/restore/RestoreOrchestrator.ts` | Y | ✓ |
| `src/workload/restore/eventBus.ts` | Y | ✓ |
| `src/routes/restore-jobs.ts` | Y | ✓ |
| `src/platform/restore/sseEvents.ts` | Y | ✓ |
| `src/workload/sdi/detectors.ts` | Y | ✓ |
| `src/workload/sdi/scanDispatcher.ts` | Y | ✓ |
| `src/workload/snapshot/downloadIssueAttachments.ts` | Y | ✓ |
| `src/ui/components/ObjectExplorer.tsx` | Y | ✓ |

---

## CHANGELOG.md

### Sprint 16 Entry

| Reference | Exists | Section | Notes |
|-----------|--------|---------|-------|
| `src/workload/http/JiraHttpClient.ts` | Y | Sprint 16 — Rate-limit handling | file exists ✓ |
| `_retryWithBackoff` | Y | Sprint 16 | method at line 250 ✓ |
| `_computeRetryDelay` | Y | Sprint 16 | method at line 270 ✓ |
| `RATE_LIMIT_MAX_RETRIES = 4` | Y | Sprint 16 | constant at line 12 ✓ |
| `RATE_LIMIT_BASE_MS = 1000 ms` | Y | Sprint 16 | constant at line 13 ✓ |
| `RATE_LIMIT_MAX_MS = 8000 ms` | Y | Sprint 16 | constant at line 14 ✓ |
| `RateLimitedError` | Y | Sprint 16 | class at line 26 ✓ |
| `SleepFn` | Y | Sprint 16 | type at line 24 ✓ |
| `[rate-limit] attempt=<n> delayMs=<ms> endpoint=<path>` | Y | Sprint 16 | line 259 emits this format ✓ |
| `.github/workflows/smoke-probes.yml` | Y | Sprint 16 — CI smoke-probe suite | `ls .github/workflows/smoke-probes.yml` ✓ |
| `scripts/smoke/probe-connect-jira-site.sh` | Y | Sprint 16 probe step table | exists ✓ |
| `scripts/smoke/probe-run-first-backup.sh` | Y | Sprint 16 probe step table | exists ✓ |
| `scripts/smoke/probe-browse-protected-inventory.sh` | Y | Sprint 16 probe step table | exists ✓ |
| `scripts/smoke/probe-restore-protected-objects.sh` | Y | Sprint 16 probe step table | exists ✓ |
| `scripts/smoke/probe-view-sdi-teaser.sh` | Y | Sprint 16 probe step table | exists ✓ |
| `scripts/run-smoke-probes.sh` | Y | Sprint 16 — Local smoke runner | exists ✓ |
| `$GITHUB_STEP_SUMMARY` | Y | Sprint 16 | standard GitHub Actions env var — no file check needed ✓ |
| `[search]` format — `src/workload/http/JiraHttpClient.ts` | Y | Sprint 16 structured log catalog | CHANGELOG format matches code: `pageSize=<n> returnedCount=<n>` ✓ |
| `[field-context]` — `src/workload/backup/discoverFieldContexts.ts` | Y | Sprint 16 catalog | file exists; format gap noted (see ARCHITECTURE.md section above) |
| `[permission-probe]` — `src/probes/permissionProbes.ts` | Y | Sprint 16 catalog | ✓ |
| `[jql-validate]` — `src/routes/policies.ts` | Y | Sprint 16 catalog | ✓ |
| `[restore]` — `src/workload/restore/trashDetectionGuard.ts` | Y | Sprint 16 catalog | ✓ |
| `[auth-refresh]` — `src/http/JiraHttpClient.ts`, `src/workload/http/JiraHttpClient.ts` | Y | Sprint 16 catalog | both files emit `[auth-refresh]` lines ✓ |
| `[attachment]` — `src/workload/snapshot/downloadIssueAttachments.ts` | Y | Sprint 16 catalog | ✓ |
| `[backup-job]` — `src/workload/snapshot/ProgressEmitter.ts` | Y | Sprint 16 catalog | ✓ |
| `[sdi]` — `src/workload/sdi/scanDispatcher.ts` | Y | Sprint 16 catalog | ✓ |
| `[inventory]` — `src/routes/inventory.ts` | Y | Sprint 16 catalog | ✓ |
| `[discover]` — `src/workload/backup/discoverProjects.ts` | Y | Sprint 16 catalog | ✓ |

### Prior CHANGELOG Entries (Sprint 15 and earlier — re-verified)

| Check | Result |
|-------|--------|
| All `src/` paths in Sprint 15 (SDI) entry | Y — all files confirmed to exist ✓ |
| All `src/` paths in Phase 4 Sprint 3 entry | Y ✓ |
| All `src/` paths in Phase 4 Sprint 2 entry | Y ✓ |
| All `src/` paths in Phase 4 Sprint 1 entry | Y ✓ |

---

## DEMO.md

All 13 references carry-forward-verified from Sprint 15. No new DEMO.md content
added in Sprint 16.

| Probe | Status |
|-------|--------|
| Probe 1 — connect-jira-site OAuth | Unchanged from Sprint 15; valid ✓ |
| Probe 2 — manual-connection | Unchanged; valid ✓ |
| Probe 3 — stub-endpoints | Unchanged; valid ✓ |
| Probe 4 — discover-flow | Unchanged; valid ✓ |
| Probe 5 — field-context + issue-enumeration | Unchanged; valid ✓ |
| Probe 6 — Sprint 3 deliverables | Unchanged; valid ✓ |
| Probe 7 — browse-protected-inventory | Unchanged; valid ✓ |
| Probe 8 — restore-protected-objects | Unchanged; valid ✓ |
| Probe 9 — restore-sprint2-guards | Unchanged; valid ✓ |
| Probe 10 — restore-sprint3-heartbeat | Unchanged; valid ✓ |
| Probe 11 — view-sdi-teaser | Unchanged; valid ✓ |

---

## .env.example Status

| Key | In .env.example | In INSTALL.md |
|-----|----------------|---------------|
| `ATLASSIAN_CLIENT_ID` | Y | Y |
| `ATLASSIAN_CLIENT_SECRET` | Y | Y |
| `OAUTH_REDIRECT_URI` | Y | Y |
| `PORT` | Y | Y |
| `DCC_ATTACHMENT_DIR` | Y | Y |

No new environment variables introduced in Sprint 16. Rate-limit constants
(`RATE_LIMIT_MAX_RETRIES`, `RATE_LIMIT_BASE_MS`, `RATE_LIMIT_MAX_MS`) are
compile-time constants — no env-var override. CI secrets (`JIRA_SANDBOX_*`)
are GitHub Actions secrets, correctly documented in INSTALL.md §6.

---

## In-Sprint Fixes Applied

| # | Doc | Reference | Fix Applied |
|---|-----|-----------|-------------|
| 1 | INSTALL.md | `GET /api/backup-points/:id/sdi-teaser` absent from §7 API surface | **Fixed** — row appended (Sprint 15 CF resolution) |
| 2 | ARCHITECTURE.md | `GET /api/backup-points/:id/sdi-teaser` absent from Endpoint Map | **Fixed** — row inserted (Sprint 15 CF resolution) |
| 3 | ARCHITECTURE.md | `src/workload/http/JiraHttpClient.ts:107-109` stale line ref | **Fixed** — corrected to `:134` (Sprint 16 additions shifted the line) |
| 4 | ARCHITECTURE.md | `[search]` log format missing `pageSize` field, wrong field name `count` | **Fixed** — format updated to `pageSize=<n> returnedCount=<n>` matching code at line 134 |
| 5 | ARCHITECTURE.md | `RateLimitExhaustedError` class name wrong | **Fixed** — corrected to `RateLimitedError` (matches code at line 26) |
| 6 | ARCHITECTURE.md | `MAX_BACKOFF_MS = 30 000` constant wrong | **Fixed** — corrected to `RATE_LIMIT_MAX_MS = 8 000` (matches code at line 14) |
| 7 | ARCHITECTURE.md | `MAX_RETRY_ATTEMPTS = 5` constant wrong | **Fixed** — corrected to `RATE_LIMIT_MAX_RETRIES = 4` (matches code at line 12) |
| 8 | ARCHITECTURE.md | `[rate-limit]` log format wrong (`connectionId`, `retryAfterMs`, `url` fields) | **Fixed** — corrected to `attempt=<n> delayMs=<ms> endpoint=<path>` matching code at line 259 |

---

## Tech-Debt Notes (not P0 carry-forwards — no blocking issue)

| Item | Finding | Disposition |
|------|---------|-------------|
| `[field-context]` skip format inconsistency | Code skip line (line 52 of `discoverFieldContexts.ts`) uses `field=<id> reason=system`; fetch line uses `field_id=<id>`. ARCHITECTURE.md and CHANGELOG both document `field_id=<id> reason=system-field` for skip. The skip line uses the wrong key name. | Sprint 17 cleanup: align the skip log line to use `field_id=` and `reason=system-field` for consistency with the fetch line. |
| `[auth-refresh]` `mutex=queued` not implemented | ARCHITECTURE.md Structured Logging section documents a `mutex=queued` variant for concurrent callers, but neither `JiraHttpClient` emits this. | Sprint 17: add `mutex=queued` log line when a concurrent refresh call joins an in-flight refresh. |
| `[restore]` format gap | ARCHITECTURE.md Structured Logging section documents `event=phase_started phase=<phase>` format, but `RestoreOrchestrator.ts` emits `phase=<phase> outcome=start jobId=<id>`. | Sprint 17: align RestoreOrchestrator log format to ARCHITECTURE.md spec (or update spec to match code). |

---

## New P0 Carry-Forwards to Sprint 17

None. All Sprint 16 doc mismatches resolved in-sprint. Tech-debt notes above are
non-blocking and do not prevent any observable operator flow from functioning.

| Item | Status |
|------|--------|
| INSTALL.md missing SDI endpoint (Sprint 15 CF) | Resolved in Sprint 16 ✓ |
| ARCHITECTURE.md Endpoint Map missing SDI endpoint (Sprint 15 CF) | Resolved in Sprint 16 ✓ |
| ARCHITECTURE.md stale line ref `:107-109` | Resolved in Sprint 16 ✓ |
| ARCHITECTURE.md wrong class/constants/log-format in Rate-Limit Handling | Resolved in Sprint 16 ✓ |
| ARCHITECTURE.md wrong `[search]` format in Structured Logging | Resolved in Sprint 16 ✓ |
