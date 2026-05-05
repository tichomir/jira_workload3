# Changelog

All notable changes are documented here by sprint.

---

## [Sprint Maintenance] — 2026-05-05 — Fix OAuth token exchange

Resolves the P0 OAuth failure where the authorization flow returned
`{"error":"token_exchange_failed"}` for every user attempting to connect a Jira site.

### Fixed

#### Token exchange missing `client_secret` — `src/oauth/tokenExchange.ts`
- Root cause: `exchangeCodeForTokens` never included `client_secret` in the
  `POST https://auth.atlassian.com/oauth/token` request body. Atlassian treats
  registered-secret apps as confidential clients and rejects token requests that
  omit the secret, even when PKCE is used.
- Fix: `exchangeCodeForTokens` now accepts a `clientSecret: string` parameter and
  includes `client_secret` in the JSON body alongside `client_id`.
- `handleCallback` reads `config.atlassianClientSecret` (from `ATLASSIAN_CLIENT_SECRET`
  env var) and passes it to `exchangeCodeForTokens`. Returns HTTP 500 with
  `{ error: 'server_misconfigured' }` when the env var is absent, matching the
  existing guard for `ATLASSIAN_CLIENT_ID` in `authorize.ts`.
- Tests in `tokenExchange.test.ts` updated: `beforeEach` sets
  `process.env['ATLASSIAN_CLIENT_SECRET']`; new test `'sends client_secret in the
  token exchange request body'` asserts the field appears in the captured fetch body.

#### Trust proxy for HTTPS fallback URI — `src/server.ts`
- `app.set('trust proxy', true)` added after `const app = express()`. Without this,
  `req.protocol` returned `'http'` when behind the Caddy TLS terminator, making the
  fallback redirect URI (`${req.protocol}://${req.get('host')}/api/oauth/callback`)
  use HTTP — which Atlassian rejects.
- **Recommended:** always set `OAUTH_REDIRECT_URI` explicitly in `.env` to guarantee
  HTTPS. The trust-proxy fix is a safety net for deployments where the env var is absent.

#### `ATLASSIAN_CLIENT_SECRET` startup guard — `src/server.ts`
- Server now exits with a FATAL error at startup if `ATLASSIAN_CLIENT_SECRET` is
  not set, rather than silently starting and failing every OAuth callback. Mirrors
  the precedent established by the `ATLASSIAN_CLIENT_ID` startup check.

#### `src/config.ts` — centralised env-var loader
- New module that loads `.env` from the project root at startup (only sets variables
  not already in the environment so runtime / container overrides are not clobbered).
- Exposes typed getters: `atlassianClientId`, `atlassianClientSecret`, `oauthRedirectUri`,
  `port`, `dbPath`, `attachmentDir`.
- `server.ts`, `authorize.ts`, and `tokenExchange.ts` all read credentials through
  `config` rather than raw `process.env` strings.

#### `accountId` storage in `connections` table — `src/db/migrations/016_connections_account_id.sql`
- New migration: `ALTER TABLE connections ADD COLUMN accountId TEXT`.
- `handleCallback` in `src/oauth/tokenExchange.ts` now fetches `GET https://api.atlassian.com/me`
  after a successful token exchange and stores the Atlassian `accountId` on the connection row
  (soft-failure: stores `NULL` if the `/me` call is unavailable).
- Storing `accountId` enables the Connections list UI to surface the authorizing account identity
  and provides an audit trail for the credential grant.

#### Connections list displays authorizing account ID — `src/ui/pages/ConnectionsList.tsx`, `src/ui/pages/ConnectionsList.css`
- `ConnectionRow` interface extended with optional `accountId?: string`.
- Each connection row now renders "Account: `<accountId>`" beneath the site name when
  `accountId` is present, giving operators immediate confirmation that OAuth completed for
  the correct Atlassian account.
- `.cl__account-id-text` CSS class added in `ConnectionsList.css` for monospace rendering.

### Documentation

- `INSTALL.md §2` — added `DB_PATH` (optional) to the env-var table; updated
  `ATLASSIAN_CLIENT_SECRET` row to note it is required at startup; clarified
  `OAUTH_REDIRECT_URI` must use HTTPS.
- `INSTALL.md §8` — full operations runbook content folded in (was previously a
  stub link to `docs/OPERATIONS.md`). Covers connection failure, scope drift,
  refresh-token rotation, JSM-site detection, and the structured log tag reference.
  Line reference to `_performRefresh` corrected from `:354` to `:_performRefresh`.
- `docs/OPERATIONS.md` — replaced with a redirect notice pointing to `INSTALL.md §8`;
  no parallel ops doc remains.
- `README.md` — quick-links table updated: `docs/OPERATIONS.md` row removed;
  `INSTALL.md` description updated to mention the operations runbook.
- `.env.example` — updated to document the two supported `OAUTH_REDIRECT_URI` values
  (podman-compose path on `:8443` and plain npm path via `caddy run` on `:443`); notes
  added to clarify required vs optional keys.

### No new environment variables
`ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `DB_PATH`, and `DCC_ATTACHMENT_DIR`
were all already defined in `.env.example`. No new keys are introduced.

---

## [Sprint Maintenance] — 2026-05-05 — README/INSTALL happy-path repair

Follows only README.md and INSTALL.md from a clean checkout to confirm a new contributor
can start the project and open the GUI in a browser. Four divergences were diagnosed and
resolved; all acceptance criteria now pass.

### Fixed

#### `vite.config.ts` — dev-server proxy target corrected to port 4000
- The Vite dev server proxy for `/api` pointed to `http://localhost:3000` (stale);
  changed to `http://localhost:4000` to match the API server default.
- On a clean checkout, every `/api/*` call from `npm run dev` now reaches the API server.

#### `Caddyfile.compose` — all-routes reverse proxy
- The compose Caddyfile previously proxied only `/api/*` to the `app` container.
  Replaced with an unscoped `reverse_proxy app:4000` so all routes (including `/`) are
  forwarded to the Express app, which now serves the built SPA for non-API paths.

#### `src/server.ts` — Express serves the Vite-built SPA (committed in preceding sprint)
- `app.use(express.static(distDir))` and a catch-all `app.get('*', ...)` were added so
  `npm run build && npm run server` makes the frontend available at `http://localhost:4000`.

### Documentation

- `README.md` Quick Start — updated inline comment to "API server + frontend GUI on
  http://localhost:4000" and added "open http://localhost:4000 in a browser" line.
- `INSTALL.md §4 Primary path` — replaced misleading "Vite dev server is not included"
  note with a correct statement that the Dockerfile builds the frontend at image time and
  Express serves it; GUI available at `http://localhost:4000` or `https://localhost` (Caddy).
- `INSTALL.md §4 Alternative` — documented the minimal single-terminal path
  (`npm run build && npm run server` → GUI at `http://localhost:4000`) alongside the
  existing two-terminal hot-reload path.

### No new environment variables
No new environment variables are introduced. Port 4000 and `/health` are unchanged.

---

## [Sprint Maintenance] — 2026-05-05 — Restore podman-compose runtime

Resolves the P0 "missing podman-compose" issue where documentation referenced a
container-based runtime that was not present in the repository.

### Added

#### `podman-compose.yml` — project root
- Compose v3.9 file starting two services:
  - `app` — Node 20 Alpine image built from `Dockerfile`; binds port `4000`; named
    volumes `sqlite_data` and `attachment_data` keep database and attachment files
    outside the container layer; Docker healthcheck polls `GET /health`.
  - `caddy` — `caddy:2-alpine` TLS sidecar reading `Caddyfile.compose`; depends on
    `app` reaching healthy state before starting; exposes ports 80 and 443.
- Standard Compose v3.9 syntax — fully compatible with `docker compose -f podman-compose.yml up`.

#### `Caddyfile.compose` — project root
- Caddy configuration for the compose stack: reverse-proxies `/api/*` to `http://app:4000`
  and all other paths to the Vite dev server when running inside the compose network.

#### `start.sh` — project root
- Bash wrapper for the primary local-development launch path.
- Copies `.env.example` → `.env` automatically if `.env` is absent, with a warning.
- Runs `podman-compose up -d`, then polls `http://localhost:4000/health` every 2 s
  until the server responds or a 60-second timeout elapses.
- Prints the service URL on success; exits non-zero on timeout.

#### `.env.example` — project root
- Documents all required and optional environment variables:
  `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `PORT` (default `4000`),
  `DB_PATH` (optional), `DCC_ATTACHMENT_DIR` (optional).

### Documentation

- `INSTALL.md §4` — restructured to make `podman-compose` + `./start.sh` the **primary**
  local-runtime path; npm two-terminal approach retained as an alternative.
- `INSTALL.md §4` — Docker-compatibility note added: `docker compose -f podman-compose.yml up`
  works without modification.
- All `.env`, `.env.example`, `podman-compose.yml`, `start.sh`, port `4000`, and `/health`
  references in `INSTALL.md` resolve to files that exist on disk.

### No new environment variables
`PORT` defaults to `4000` (unchanged from Sprint 18). No new keys introduced.

---

## [Sprint 18] — 2026-05-05 — Maintenance: Build & Run Validation

This sprint repaired the project to a fully green state: build succeeds, server starts on port 4000, test suite passes, and canonical docs are consistent.

### Fixed

#### TypeScript build errors — `src/` (multiple files)
- Class A: added `_code` / `_body` typed stub interface to test helpers in
  `src/routes/restore-guards-e2e.test.ts` and `src/routes/restore-jobs-phase-order.test.ts`.
- Class B: corrected unsafe `as Record<string, unknown>` cast to double-cast
  `as unknown as Record<string, unknown>` in `src/routes/restore-guards-e2e.test.ts`.
- Class C: added missing `RawIssue` type import in `src/workload/http/JiraHttpClient.ts`.
- Class D: removed unused imported/declared symbols (`CaptureProgressEvent`,
  `manifestId`, `connectionId`) in `src/workload/JiraWorkload.ts` and
  `src/workload/snapshot/ProgressEmitter.ts`.
- Class E: wrapped `vi.restoreAllMocks()` calls in `void` to satisfy
  `Awaitable<void>` return type in `afterEach` callbacks across five test files.
- Class F: corrected `MockInstance` generic annotation from
  `MockInstance<unknown[], unknown>` to `MockInstance` (no annotation) in
  `src/workload/restore/boardScopeRecheck.test.ts` and
  `src/workload/restore/trashDetectionGuard.test.ts`.
- Class G: changed `diffSummary` test fixture from `undefined` to `null` in
  `src/workload/snapshot/CaptureOrchestrator.test.ts`.
- Class H: replaced typed tuple destructuring with untyped destructuring in
  `Object.entries` callbacks in `CaptureOrchestrator.test.ts` and
  `ProgressEmitter.test.ts`.
- Class I: corrected empty-tuple index access in
  `src/workload/snapshot/downloadIssueAttachments.test.ts`.

#### Default port changed from 3000 to 4000 — `src/server.ts`, `.env.example`, `Caddyfile`
- `src/server.ts` fallback changed to `'4000'` so the server binds to port 4000
  without any `PORT` env var set.
- `.env.example` `PORT` default updated to `4000`.
- `Caddyfile` reverse-proxy target updated from `localhost:3000` to `localhost:4000`.

#### `/health` liveness endpoint added — `src/server.ts`
- `GET /health` returns `{ "status": "ok" }` with HTTP 200. Used as the canonical
  liveness probe in `INSTALL.md §5` and `README.md` Quick Start.

### Documentation

- `README.md` — added **Quick Start** block with literal `npm run build`,
  `npm run server`, `npm run test` commands and a `curl http://localhost:4000/health`
  liveness probe.
- `INSTALL.md §1` — renamed to "Clone, install, and build"; added `npm run build` step.
- `INSTALL.md §5` — updated liveness probe from `/api/connections` to
  `curl -sf http://localhost:4000/health`.
- `INSTALL.md §5a` — new section documenting `npm run test` with expected output.
- All port references in `INSTALL.md`, `README.md`, `.env.example`, and `Caddyfile`
  updated to `4000`.

### No new environment variables
No new environment variables introduced. `PORT` default changed to `4000` in
`.env.example` and `src/server.ts`.

---

## [1.0.0-mvp] [Sprint 17 — Phase 5 Sprint 2] — 2026-05-05 — MVP Closeout: CI Smoke Gating, Runbook & Tihomir Handoff

This release marks the Phase 1 MVP closeout. All G-01 through G-13 observable signals pass. The CI
smoke-probe gate is active on every push to `main`/`master`. The operations runbook and handoff
package are delivered and checked in.

### Added

#### Engineer-facing operations runbook — `docs/OPERATIONS.md`
- Four-section runbook covering the most common Phase 1 failure modes, each with **Symptoms →
  Diagnostic log greps → Resolution steps**:
  1. **Connection Failure** — `probe-failed` status, HTTP 403 remediation, missing-credentials
     recovery; includes example `[permission-probe]` log lines for all four probe endpoints.
  2. **Scope Drift** — detecting and recovering from missing OAuth scopes post-token rotation;
     re-authorize flow and Atlassian developer console scope verification steps.
  3. **Refresh-Token Rotation Failure** — diagnosing `[auth-refresh] outcome=failure` events;
     mutex-stuck scenarios and credential-table recovery procedure.
  4. **JSM-Site Detection** — identifying `PHASE_2_DEFERRED` projects in backup manifests;
     confirming JSM exclusion from inventory counts and verifying no JSM data leaks into
     Phase 1 results via `[discover] jsm-deferred` log lines.
- Source: Sprint 17 scope, T2 §4.5, T3 §3.2.

#### Sprint-kickoff handoff package — `docs/handoff/`
- Handoff brief for Tihomir covering:
  - Phase 1 scope summary: all G-01 through G-13 goals and their observable signals.
  - Phase 2 deferred items with source references (JSM, incremental backup, GFS retention,
    blob export, cross-site restore, ADF media-link rewrite, audit log, HIPAA tag).
  - Open-question log (OQ log): OQ-2 audit-log scope confirmation, OQ-3 cross-site
    remapping, OQ-5 ADF media-link rewrite pass, T7 OQ-3 JSM teaser profile.
  - Carry-forward backlog: items explicitly deferred from Phase 1 sprints with their
    source tags and engineering context.

#### Job-status semantics QA report — `docs/qa/job-status-semantics-sprint17.md`
- Verified coverage of `'Completed with N errors'` vs `'Completed successfully'` across
  both backup (`src/workload/snapshot/ProgressEmitter.ts`) and restore
  (`src/platform/ui/restore/RestoreJobProgress.tsx`) flows:
  - `errorsCount === 0` → `completed` → UI shows "Completed successfully."
  - `errorsCount > 0` → `completed_with_errors` → UI shows "Completed with N errors — M items
    restored." The phrase "Completed successfully" is never rendered when `errors > 0`.
  - `⚠` icon used for `completed_with_errors`; distinct from ✓ (clean) and ✕ (failed).
- Source: T5 §6.2b.

#### Final regression report — `docs/qa/final-regression-sprint17.md`
- End-to-end regression pass against all G-01 through G-13 observable signals:
  - G-01: OAuth 3LO → `GET /me` 200 + non-null `accessToken` + `refreshToken`. ✅
  - G-02: Project discovery zero-omissions invariant across `all` / `selected` scopes. ✅
  - G-03: Issue coverage invariant (all custom field values present, no field skipped). ✅
  - G-04: Binary-faithful attachment round-trip with SHA-256 `contentHash` verification. ✅
  - G-05: Capture order `IssueType → CustomField → … → Issue` enforced. ✅
  - G-06: Restore dependency chain `Project → … → issue → post-issue pass` enforced. ✅
  - G-07: Rotating-refresh-token atomic write + single-flight mutex. ✅
  - G-08: `POST /rest/api/3/search/jql` exclusive; `GET /rest/api/3/search` absent (`check-http-guard`). ✅
  - G-09: System-field skip guard in `discoverFieldContexts`; `[field-context] skip` log lines verified. ✅
  - G-10: SDI scanner detects email, API key, credit card, phone across all four file classes. ✅
  - G-11: Inventory sidebar renders four object types with JSM exclusion. ✅
  - G-12: Restore wizard three conflict modes; Skip default; cross-site blocked. ✅
  - G-13: Heartbeat ≤10 s; stalled alert >20 s; `'Completed with N errors'` semantics. ✅

### No new environment variables
No new environment variables are introduced in Sprint 17. The CI secrets (`JIRA_SANDBOX_*`)
documented in `INSTALL.md §6` remain unchanged. The operations runbook is referenced from
`INSTALL.md §8`.

---

## [Sprint 16 — Phase 5 Sprint 1] — 2026-05-05 — Observability, Hardening & Sprint-Kickoff Handoff

### Added

#### Rate-limit handling with exponential backoff — `src/workload/http/JiraHttpClient.ts`
- `_retryWithBackoff(url, init, firstResponse, endpoint)` — retries the original request on
  HTTP 429 up to `RATE_LIMIT_MAX_RETRIES = 4` additional attempts before throwing.
- `_computeRetryDelay(response, attempt)` — delay strategy:
  1. Reads the Atlassian `Retry-After` response header first: accepts both plain-seconds
     and HTTP-date formats.
  2. Falls back to capped exponential backoff when the header is absent or unparseable:
     `delay = min(RATE_LIMIT_BASE_MS × 2^(attempt−1), RATE_LIMIT_MAX_MS)` with ±20% jitter.
     - `RATE_LIMIT_BASE_MS = 1000 ms`, `RATE_LIMIT_MAX_MS = 8000 ms`.
     - Schedule (no `Retry-After`): attempt 1 → ~1 s; attempt 2 → ~2 s; attempt 3 → ~4 s; attempt 4 → ~8 s.
- Emits `[rate-limit] attempt=<n> delayMs=<ms> endpoint=<path>` before each sleep so every
  retry is operator-observable in the structured log stream.
- `RateLimitedError` — typed error thrown when all retries are exhausted; `message` encodes
  endpoint and attempt count; callers can distinguish rate-limit exhaustion from HTTP errors.
- `SleepFn` — injectable sleep function (`(ms: number) => Promise<void>`); production default
  is `setTimeout`; tests inject a no-op so backoff tests run without real wall-clock delays.
- Source: T2 §4.5.

#### CI smoke-probe suite — `.github/workflows/smoke-probes.yml`
- GitHub Actions workflow triggered on push and pull-request events targeting `main` /
  `master`, and on manual `workflow_dispatch`.
- Secrets consumed (set via **Settings → Secrets and variables → Actions**; see `INSTALL.md §6`):

  | Secret | Maps to env var |
  |---|---|
  | `JIRA_SANDBOX_CLIENT_ID` | `ATLASSIAN_CLIENT_ID` |
  | `JIRA_SANDBOX_CLIENT_SECRET` | `ATLASSIAN_CLIENT_SECRET` |
  | `JIRA_SANDBOX_OAUTH_REDIRECT_URI` | `OAUTH_REDIRECT_URI` |

- Runs all five operator-flow probes with `if: always()` so later probes execute even when
  an earlier probe fails:

  | Step | Script |
  |---|---|
  | `Probe: connect-jira-site` | `scripts/smoke/probe-connect-jira-site.sh` |
  | `Probe: run-first-backup` | `scripts/smoke/probe-run-first-backup.sh` |
  | `Probe: browse-protected-inventory` | `scripts/smoke/probe-browse-protected-inventory.sh` |
  | `Probe: restore-protected-objects` | `scripts/smoke/probe-restore-protected-objects.sh` |
  | `Probe: view-sdi-teaser` | `scripts/smoke/probe-view-sdi-teaser.sh` |

- Per-probe timeout extracted from each script's `# timeout:` header directive and enforced
  via the system `timeout` command; results (PASS / FAIL / TIMEOUT) written to a shared
  results file so the summary step can report all outcomes even when individual steps fail.
- Probe results rendered as a Markdown table in the GitHub Actions job summary via
  `$GITHUB_STEP_SUMMARY`; job exits 1 when any probe fails or times out.

#### Local smoke runner — `scripts/run-smoke-probes.sh`
- Discovers all `probe-*.sh` files in `scripts/smoke/` (or a custom directory passed as `$1`)
  and runs them in alphabetical order.
- Extracts `# name:` and `# timeout:` directives from each probe header; enforces the timeout
  via the system `timeout` command.
- Exits 1 and prints the failing probe names when any probe fails or times out.
- Writes a Markdown summary table to `$GITHUB_STEP_SUMMARY` when running inside GitHub Actions.
- Run locally: `bash scripts/run-smoke-probes.sh` (requires a running API server on `PORT`).

### Structured log-line catalog (Phase 1 — validated in this sprint)

All `[tag]` log lines confirmed present and accurate across the Phase 1 module set:

| Tag | Format | Source file |
|---|---|---|
| `[search]` | `endpoint=search/jql project=<key> page=<n> pageSize=<n> returnedCount=<n>` | `src/workload/http/JiraHttpClient.ts` |
| `[field-context]` | `skip field_id=<id> reason=system-field` / `fetch field_id=<id> contextCount=<n>` | `src/workload/backup/discoverFieldContexts.ts` |
| `[permission-probe]` | `connectionId=<id> endpoint=<path> status=<n> duration_ms=<n>` | `src/probes/permissionProbes.ts` |
| `[jql-validate]` | `connectionId=<id> outcome=valid\|invalid\|error errorsCount=<n>` | `src/routes/policies.ts` |
| `[restore]` | `guard=trash-detection projectKey=<key> trashed=<bool>` | `src/workload/restore/trashDetectionGuard.ts` |
| `[auth-refresh]` | `connectionId=<id> mutex=acquire\|release` / `outcome=success\|failure\|token-rotated` | `src/http/JiraHttpClient.ts`, `src/workload/http/JiraHttpClient.ts` |
| `[rate-limit]` | `attempt=<n> delayMs=<ms> endpoint=<path>` | `src/workload/http/JiraHttpClient.ts` |
| `[attachment]` | `op=download id=<id> bytes=<n> sha256=<hex> outcome=ok\|hash_mismatch\|http_error` | `src/workload/snapshot/downloadIssueAttachments.ts` |
| `[backup-job]` | `op=start\|heartbeat\|stalled\|completed\|failed jobId=<id> errors=<n>` | `src/workload/snapshot/ProgressEmitter.ts` |
| `[sdi]` | `scan path=<p> class=<c> email=<n> apiKey=<n> cc=<n> phone=<n>` | `src/workload/sdi/scanDispatcher.ts` |
| `[inventory]` | `connectionId=<id> backupPointId=<id\|none> jsmExcludedProjects=<n>` | `src/routes/inventory.ts` |
| `[discover]` | `jsm-deferred projectKey=<key> reason=PHASE_2_DEFERRED` | `src/workload/backup/discoverProjects.ts` |

### No new environment variables
`RATE_LIMIT_MAX_RETRIES` (4), `RATE_LIMIT_BASE_MS` (1000 ms), and `RATE_LIMIT_MAX_MS` (8000 ms)
are compile-time constants in `src/workload/http/JiraHttpClient.ts`. No env-var override is
exposed in Phase 1. CI secrets (`JIRA_SANDBOX_*`) are documented in `INSTALL.md §6`.

---

## [Sprint 15] — 2026-05-05 — SDI Teaser Scanner & Compliance Tags

### Added

#### SDI detectors — `src/workload/sdi/detectors.ts`
- `detectEmails(buffer)` — RFC-5322 simplified regex; counts email addresses found in text.
- `detectApiKeys(buffer)` — two-pass detection: well-known prefixed tokens (AWS AKIA, GitHub
  `ghp_`/`gho_`/`ghs_`/`ghr_`, Slack `xox*`, Stripe `sk_live_`, Google `AIza`) plus
  generic 32+-character sequences with Shannon entropy ≥ 4.0.
- `detectCreditCards(buffer)` — matches 13–19 digit sequences (plain, space-separated, or
  dash-separated); filters candidates via Luhn checksum validation before counting.
- `detectPhones(buffer)` — E.164 international format (`+1…`) and North American format
  (`(800) 555-1234`, `800-555-1234`, `800.555.1234`).
- Source: T7 §2, §3.

#### SDI scan dispatcher — `src/workload/sdi/scanDispatcher.ts`
- `scanFile(filePath, buffer)` — classifies the file by extension, dispatches to the
  appropriate scan strategy, and returns `ScanResult { email, apiKey, cc, phone, class }`.
- File class routing:

  | Class | Extensions / filenames |
  |---|---|
  | `xml` | `.xml` (entities export; XML tags stripped before scanning) |
  | `tabular` | `.csv`, `.tsv`, `.xlsx` (scanned row-by-row; `.xlsx` skipped — no parser) |
  | `dev-config` | `.env`, `.yaml`, `.yml`, `.json`, `.toml`, `.properties`, `.config` |
  | `text-log` | `.txt`, `.log`, `.md` |
  | `unsupported` | All other extensions — returns zero counts |

- Emits `[sdi] scan path=<p> class=<c> email=<n> apiKey=<n> cc=<n> phone=<n>` per file.
- `.xlsx` files emit an additional `[sdi] xlsx-skipped path=<p> reason=no-parser` line.
- Source: T7 §3, §4.

#### SDI type contracts — `src/workload/sdi/types.ts`
- `SdiRegulations` — `{ gdpr: 'active' | 'inactive'; pciDss: 'active' | 'inactive' }`.
- `BackupPointSdiSummary` — `{ backupPointId, issueCount, projectCount, regulations }`.

#### `GET /api/backup-points/:id/sdi-teaser` — `src/routes/backup-points.ts`
- Returns the SDI aggregate summary for a backup point:
  `{ backupPointId, issueCount, projectCount, regulations: [{ code, status }] }`.
- `regulations` always contains exactly two entries in Phase 1: `GDPR` and `PCI_DSS`.
  HIPAA is intentionally excluded from the Phase 1 response (T7 OQ-3).
- GDPR entry activates when any email or phone detector fired during the scan.
- PCI DSS entry activates when any credit card detector fired.
- `404 not_found` when no SDI summary row exists for the requested backup point.
- Source: T7 §4.

#### Database migration — `src/db/migrations/015_backup_point_sdi_summary.sql`
- `backup_point_sdi_summary` table — one row per backup point holding aggregate SDI results.
- Columns: `backupPointId` (PK, FK → `backup_manifests`), `issueCount INTEGER NOT NULL DEFAULT 0`,
  `projectCount INTEGER NOT NULL DEFAULT 0`, `regulations TEXT NOT NULL DEFAULT '{}'` (JSON),
  `createdAt TEXT NOT NULL`.
- Source: T7 §4.

#### SDI Teaser Panel UI — `src/ui/components/SdiTeaserPanel.tsx`
- `SdiTeaserPanel({ backupPointId })` — fetches `GET /api/backup-points/:id/sdi-teaser` on
  mount; renders badge and regulation chips.
- **Badge** — `⚠ Sensitive data detected` shown when `issueCount > 0`; replaced by
  `No sensitive data detected in this backup point.` when `issueCount === 0`.
- **Subtext** — `N issues across M projects` rendered beneath the badge when findings exist.
- **Regulation chips** — one chip per regulation entry; chip highlighted when `status === 'active'`.
  HIPAA chip is filtered out client-side (`r.code !== 'HIPAA'`) — never rendered in Phase 1.
- `buildSdiDisplay(data)` — pure helper; directly testable in isolation.
- Source: T7 §4.

> **HIPAA tag hidden in Phase 1.** The HIPAA regulation chip is intentionally excluded from
> both the API response and the UI panel. Full HIPAA teaser profiling is a Phase 2 deliverable
> requiring a separate T7-JSM specification (T7 OQ-3).

### No new environment variables
No new environment variables are introduced in this sprint. All SDI thresholds and
classification rules are compile-time constants in `detectors.ts` and `scanDispatcher.ts`.

---

## [Phase 4 Sprint 3] — 2026-05-05 — Restore Orchestrator, SSE Phase Stream & Heartbeat Telemetry

### Added

#### HeartbeatEmitter — `src/workload/restore/HeartbeatEmitter.ts`
- `HeartbeatEmitter(jobId, onEvent)` — arms a `setInterval` at `HEARTBEAT_INTERVAL_MS` (10 000 ms)
  that fires `{ type: 'heartbeat', jobId, ts, currentPhase }` into the SSE event stream.
- `start(phase)` — starts the interval; re-entrant: calling while running replaces the previous
  interval with the new phase so `currentPhase` is always accurate.
- `stop()` — clears the interval; safe to call when already stopped.
- `HEARTBEAT_INTERVAL_MS = 10 000` — exported constant; consumed by tests and the SSE route.
- Source: T5 §6.2.

#### Platform SSE event contract — `src/platform/restore/sseEvents.ts`
- Canonical platform-boundary type definitions for the restore SSE wire protocol.
- `SseEvent` — discriminated union of every event type the orchestrator emits:
  `phase_started`, `phase_progress`, `phase_completed`, `heartbeat`, `job_failed`,
  `job_completed`, `conflict_pause`, `conflict_resumed`, `post_issue_sub_phase`.
- `MAX_HEARTBEAT_INTERVAL_MS = 10 000` — maximum allowed gap between consecutive SSE events.
- `STALLED_THRESHOLD_MS = 20 000` — silence threshold after which the job is considered stalled.
- `RestorePhaseValue` — string-literal union of all phase identifiers for SSE event fields;
  platform consumers reference phase names without depending on the workload `RestorePhase` enum.
- `HeartbeatEvent`, `PhaseStartedEvent`, `PhaseCompletedEvent`, `JobFailedEvent`,
  `JobCompletedEvent`, `PostIssueSubPhaseEvent` — individually exported event interfaces.
- Source: T5 §5.2, §6.2, §6.2b.

#### RestoreOrchestrator — `src/workload/restore/RestoreOrchestrator.ts` (updated)
- `HeartbeatEmitter` wired into `runRestore()`:
  - `heartbeat.start(phase)` called immediately after emitting `phase_started`.
  - `heartbeat.stop()` called immediately before emitting `phase_completed` or `job_failed`.
- Heartbeat events fire at a ≤10 s cadence throughout every running phase, satisfying the
  ≤10 s SSE event contract (T5 §6.2).
- Source: T5 §6.2.

#### SSE route — `src/routes/restore-jobs.ts` (updated)
- Stalled watchdog wired into `GET /api/restore-jobs/:id/events`:
  - `STALLED_THRESHOLD_MS` (20 000 ms) `setTimeout` reset on every received SSE event.
  - After 20 s of silence the route emits
    `{ type: 'stalled', jobId, ts, lastPhase, secondsSinceLastEvent }` to the client and
    reschedules the watchdog for continuous monitoring without spamming.
  - `lastPhase` is updated on every `phase_started` event so the stalled report identifies
    the phase that was running when the stream went silent.
- SSE comment heartbeat line (`: heartbeat`) emitted every 9 s to prevent connection timeout;
  distinct from the orchestrator-level `{ type: 'heartbeat' }` event.
- Source: T5 §6.2.

#### Restore Job Progress UI — `src/platform/ui/restore/RestoreJobProgress.tsx` (updated)
- "Last heartbeat: Xs ago" indicator rendered while the job is running; updated every second.
  Timer resets on any received SSE event including `{ type: 'heartbeat' }` events.
- Stalled state: job transitions to `stalled` when the UI detects no SSE event for ≥20 s and
  the status banner shows **"No progress received for over 20 seconds. The restore job may be
  stalled."** (T5 §6.2).
- **"Completed with N errors"** status: when `job_completed.errors > 0` the banner shows
  **"Completed with N errors — M items restored."** The phrase "Completed successfully" is
  never displayed when `errors > 0` (T5 §6.2b).
- `completed_with_errors` job state mapped to `⚠` icon for visual distinction from
  clean completion (✓) and failure (✕).

#### Restore Wizard UI — `src/platform/ui/restore/RestoreWizard.tsx` (updated)
- Minor UX polish: loading-state wording and button disabled-state improvements.

#### Integration and unit tests
- `src/workload/restore/HeartbeatEmitter.test.ts` — standalone and orchestrator-integrated tests:
  - Cadence: ≥1 heartbeat within `HEARTBEAT_INTERVAL_MS + 1 s` of `start()`.
  - Tick rate: ≥2 heartbeats after 21 s; ≥3 after 31 s.
  - Stop: no new heartbeats after `stop()`; timer fully cleared.
  - Re-entrancy: second `start()` replaces the first interval; new `currentPhase` reported.
  - Orchestrator integration: heartbeat emitted mid-phase during a 25 s handler; stops between
    phases; `currentPhase` matches the active `RestorePhase` entry.
- `src/routes/restore-jobs-sse-http.test.ts` — real-HTTP SSE wire protocol integration tests:
  - Binds a live Express server on a random port; no mock HTTP layer.
  - Response headers: HTTP 200 + `Content-Type: text/event-stream`.
  - Forced-failure: Workflow handler throws → `job_failed { error.code: 'dependency_phase_failed',
    error.phase: 'workflow' }`; downstream phases never started; `job_completed` never emitted;
    `job_failed` is the terminal event. Error object contains exactly `{ code, phase, message }`.
  - Happy-path: all 8 phases started in `RESTORE_PHASE_ORDER`; `job_completed` is terminal;
    `job_failed` never emitted.
  - Wire format: every SSE message block begins with `event: <type>` followed by
    `data: <json>` where `parsed.type === eventType`. Heartbeat comment lines (`: heartbeat`)
    are correctly excluded from event parsing.

### **Phase 2 — not yet shipped**
The following restore phase handlers remain stub (no-op) implementations in Phase 1; concrete
write operations against the Atlassian REST API are Phase 2 deliverables:

| Phase | Status |
|---|---|
| `site-reference-data` | **Phase 2 — not yet shipped** (stub returns 0 restored) |
| `project` | **Phase 2 — not yet shipped** |
| `workflow` | **Phase 2 — not yet shipped** |
| `custom-field` | **Phase 2 — not yet shipped** |
| `board` | **Phase 2 — not yet shipped** |
| `sprint` | **Phase 2 — not yet shipped** |
| `issue` | **Phase 2 — not yet shipped** |

The `comment-attachment-subtask-issuelink` phase executes `runPostIssueCreationPass()` (Sprint 2
of this phase), but its HTTP write calls are also stub no-ops in Phase 1.

### No new environment variables
`HEARTBEAT_INTERVAL_MS` (10 000 ms) and `STALLED_THRESHOLD_MS` (20 000 ms) are compile-time
constants. No env-var override is exposed in Phase 1.

---

## [Phase 4 Sprint 2] — 2026-05-05 — Restore Wizard: Pre-flight Guards, Conflict Modes & Post-Issue Pass

### Added

#### Board scope re-check guard — `src/workload/restore/boardScopeRecheck.ts`
- `checkBoardScopesFromString(scopeString)` — pure function; parses a space-delimited
  scope string and verifies both `write:board-scope:jira-software` and
  `write:board-scope.admin:jira-software` are present. Returns `GuardResult`.
- `checkBoardScopes(connectionId)` — reads the stored `scopes` from the `credentials`
  table (no HTTP request; scopes are persisted at token-exchange time and updated
  atomically on refresh). Delegates to `checkBoardScopesFromString`.
- `REQUIRED_BOARD_SCOPES` — exported constant array of the two required scope strings.
- Emits `[permission-probe] scope=<scope> outcome=ok|missing` log lines per scope checked.
- Source: T2 §4.2.2, T5 §5.2.

#### Trash detection guard — `src/workload/restore/trashDetectionGuard.ts`
- `runTrashDetection(projectKeys, destination, checkTrash)` — runs the trash check for
  each project key in the selection. Forces `destination = 'alternate'` when a project
  is in the Atlassian 30–60 d trash window and `destination === 'original'`. Does NOT
  halt execution (not a `job_failed` condition).
- `extractProjectKeys(selection)` — extracts unique project keys from a mixed selection
  array (handles Issue keys, plain project keys; skips numeric IDs).
- `TrashChecker` — injectable function type for querying trash status (decoupled from
  HTTP; default no-op assumes all projects are live).
- Emits `[restore] guard=trash-detection projectKey=<key> trashed=<bool>` per project.
- When forcing alternate: `[restore] guard=trash-detection jobId=<id> forcing destination=alternate`.
- Source: T5 §4.2.

#### Post-issue-creation pass — `src/workload/restore/postIssueCreationPass.ts`
- `runPostIssueCreationPass(options, onEvent, deps)` — executes three sequential
  sub-phases after all Issue bodies are written:
  1. **Comments** — `POST /rest/api/3/issue/{id}/comment` in authored order.
  2. **Subtask links** — `POST /rest/api/3/issueLink` (subtask direction).
  3. **Issue links** — `POST /rest/api/3/issueLink` (all other link types).
- Best-effort: per-item errors are logged and counted but do not halt the pass.
- Emits `post_issue_sub_phase` SSE event after each sub-phase with `restored`, `errors`,
  and `attempted` counts.
- `defaultPostIssuePassDeps` — no-op injectable dependencies for stub/test use.
- Source: T5 §5.2, §6.2b, OQ-5.

#### RestoreOrchestrator — `src/workload/restore/RestoreOrchestrator.ts` (updated)
- Board scope re-check guard wired in before the Board phase:
  if `checkBoardScopes()` returns `passed: false`, emits `job_failed` with
  `error.code: 'dependency_phase_failed'` and halts.
- Trash detection guard wired in before the Project phase:
  extracts project keys from `selection`, runs `runTrashDetection()`, forces
  `effectiveOptions.destination = 'alternate'` when needed. Execution continues.
- `CommentAttachmentSubtaskIssuelink` phase now wired to `runPostIssueCreationPass()`
  instead of a stub handler. Phase emits `post_issue_sub_phase` sub-events and
  returns `postIssuePassReport` in the phase result.
- `RestoreRunResult.trashDetectionResults` populated from all `TrashStatus` records.
- `RestoreRunResult.postIssuePassReport` populated from the post-issue pass.
- Constructors accept injectable `boardScopeChecker` and `trashChecker` for hermetic tests.

#### RestoreOrchestrator type contracts — `src/workload/restore/types.ts` (updated)
- `GuardResult` — result of any pre-restore guard check (`passed`, `guardName`,
  `failureCode`, `failureMessage`, `missingScopes`).
- `TrashStatus` — Atlassian project trash-window state (`projectId`, `projectKey`,
  `inTrash`, `trashedAt?`, `daysInTrash?`, `alternateLocationRequired`).
- `PostIssuePassReport` — per-item counts from the post-issue pass (comments, attachments,
  subtask links, issue links — restored, errors; plus `adfMediaLinkWarning` flag).
- `PostIssueSubPhase` — `'comment' | 'subtask' | 'issuelink'`.
- `PostIssueSubPhaseEvent` — SSE event emitted after each sub-phase; added to
  `RestoreSseEvent` discriminated union.
- `ConflictPauseEvent`, `ConflictResumedEvent`, `ConflictDecision`, `ConflictType` —
  contracts for interactive `ask`-mode conflict resolution (Phase 2 execution;
  Phase 1: `conflictMode === 'ask'` records the preference but behaves like Skip).
- `RestoreRunResult` extended with optional `trashDetectionResults?` and
  `postIssuePassReport?` fields.

#### `GET /api/restore-jobs/trash-check` — `src/routes/restore-jobs.ts` (updated)
- New route: `GET /api/restore-jobs/trash-check?connectionId=&projectKeys=`
- Returns `{ trashedProjectKeys: string[] }`.
- Stub behaviour: project keys whose uppercase form starts with `"TRASH"` are
  classified as in the trash window.
- `400` when `connectionId` absent; `404` when connection not found.
- Source: T5 §4.2.

#### Restore Wizard — `src/platform/ui/restore/RestoreWizard.tsx` (updated)
- Step 3 (destination) now runs a pre-flight trash check immediately on mount.
- `GET /api/restore-jobs/trash-check` called for all project keys extracted from
  the current selection.
- Yellow warning banner shown when any project is in the trash window.
- **Original location** radio option disabled ("Unavailable — project is in
  Atlassian native trash.") and destination forced to **Alternate location**.
- "Checking project trash status…" spinner while the trash check is in flight.
- The **Next →** button is disabled while the trash check is loading.

### No new environment variables
No new environment variables are introduced in this sprint.

---

## [Phase 4 Sprint 1] — 2026-05-05 — Restore Wizard Foundation & Dependency-Ordered Orchestrator

### Added

#### Restore Wizard UI — `src/platform/ui/restore/RestoreWizard.tsx`
- Four-step wizard: (1) Select objects, (2) Conflict mode, (3) Destination, (4) Review & confirm.
- **Step 1** — connection selector, backup-point display, and paginated object list with
  Issue / Project / Board / Sprint tabs; per-item and select-all checkboxes.
- **Step 2** — conflict mode radio group: **Skip** (default), Override, Ask per conflict (T5 §5.1).
- **Step 3** — destination selector: Original location, Alternate location (same Jira site),
  Export / Browser Download. Alternate location reveals a target project key field.
  An info banner explicitly states that cross-site / cross-tenant restore is not supported
  in Phase 1 (T5 §5.2).
- **Step 4** — review panel summarising connection, backup point, object count, conflict mode,
  and destination; **Start restore** button submits to `POST /api/restore-jobs`.
- Navigation guards: Next is disabled until each step's required fields are satisfied.
- On successful job creation, navigates to `/restore-jobs/{jobId}` (progress view; Sprint 2).

#### Restore type contracts — `src/workload/restore/types.ts`
- `ConflictMode` — `'override' | 'skip' | 'ask'`; default `'skip'` (T5 §5.1).
- `RestoreDestinationType` — `'original' | 'alternate' | 'export'`; cross-site restore
  explicitly blocked at the API validation layer (T5 §5.2).
- `RestorePhase` enum — canonical write-dependency order:
  `site-reference-data → project → workflow → custom-field → board → sprint → issue →
  comment-attachment-subtask-issuelink` (T1 §1, T5 §5.2).
- `RESTORE_PHASE_ORDER` — immutable phase sequence; every orchestrator implementation must
  iterate in exactly this order.
- `RestoreSseEvent` — discriminated union: `phase_started`, `phase_completed`,
  `phase_progress`, `job_failed`, `job_completed`.
  `job_failed` always carries `{ error: { code: 'dependency_phase_failed', phase, message } }`;
  subsequent phases are never started after this event.
- `RestoreJob`, `RestoreRunOptions`, `RestoreRunResult`, `RestorePhaseResult`,
  `IRestoreOrchestrator` — full boundary contracts for the restore orchestrator.

#### Restore orchestrator — `src/workload/restore/RestoreOrchestrator.ts`
- `RestoreOrchestrator.runRestore(options, onEvent)` — iterates `RESTORE_PHASE_ORDER` strictly
  in sequence; on any phase handler throw, emits `job_failed { error.code:
  'dependency_phase_failed' }` and halts — subsequent phases are not started (T1 §1, T5 §5.2).
- Emits `phase_started` → `phase_completed` per phase in exact dependency order; stream always
  ends with `job_completed` or `job_failed`.
- `errorCount > 0` at completion maps to `completed_with_errors`; UI must display
  "Completed with N errors", never "Completed successfully" (T5 §6.2b).
- Stub phase handlers registered for all 8 phases — concrete implementations added in
  subsequent sprints; the orchestrator is exercisable end-to-end from Sprint 1.

#### In-memory event bus — `src/workload/restore/eventBus.ts`
- `publish(jobId, event)` — buffers the event and notifies all live SSE subscribers.
- `subscribe(jobId, onEvent)` — replays all buffered events synchronously before returning
  the unsubscribe function, ensuring late-connecting SSE clients receive the full event
  sequence (T5 §6.2).
- `clearJob(jobId)` — removes buffer and listener set for a completed job.

#### `POST /api/restore-jobs` — `src/routes/restore-jobs.ts`
- Creates a restore job, persists it to `restore_jobs`, and launches
  `RestoreOrchestrator.runRestore()` asynchronously (fire-and-forget).
- Required body fields: `connectionId`, `backupPointId`, `destination`, `selection` (array).
- Optional: `conflictMode` (default `'skip'`), `alternateDestination`
  (`{ cloudId: string, projectKey: string }`).
- Cross-site restore guard: rejects `targetCloudId` or `alternateDestination.cloudId` that
  differ from the connection's `cloudId` with HTTP 400 `cross_site_restore_not_supported`.
- Returns HTTP 201 `{ jobId, status: 'queued' }`.
- HTTP 400 on missing required fields or invalid `conflictMode` / `destination` values.
- HTTP 404 when `connectionId` is not found.

#### `GET /api/restore-jobs/:id/events` — `src/routes/restore-jobs.ts`
- Server-Sent Events stream for a restore job (`Content-Type: text/event-stream`).
- Replays all buffered events immediately so late-connecting clients receive the full
  event sequence.
- SSE comment heartbeat every 9 s (≤10 s interval per T5 §6.2); stream closes automatically
  after `job_completed` or `job_failed`.
- HTTP 404 when the job ID is not found.

#### Database migration — `src/db/migrations/014_restore_jobs.sql`
- `restore_jobs` table: `jobId` (PK), `connectionId` (FK → `connections`), `backupPointId`,
  `conflictMode` (checked: `override | skip | ask`, default `skip`),
  `destination` (checked: `original | alternate | export`), `selection` (JSON array),
  `alternateDestination` (JSON, nullable), `status` (default `queued`),
  `restoredCount`, `errorCount`, `phaseDiagnostic` (nullable), `createdAt`, `completedAt`.

### No new environment variables
No new environment variables are introduced in this sprint.

---

## [Phase 3 Sprint 2] — 2026-05-05 — Inventory Filters, Search & Traceability

### Added

#### `GET /api/inventory/:type` — Issue filter facets and keyword search — `src/routes/inventory.ts`

Extended the paginated item endpoint with structured filter facets and keyword search for
`Issue` items. All filter params are silently ignored for non-Issue types.

**Structured filter facets** (OR semantics within a facet, AND across facets):

| Query param | Maps to column | Accepts |
|---|---|---|
| `status` | `status` | One or more Issue status values |
| `issueType` | `issueType` | One or more Issue type names (Bug, Story, Task, …) |
| `assignee` | `assignee` | One or more assignee account IDs |
| `sprint` | `sprintId` | One or more sprint IDs |
| `board` | `boardId` | One or more board IDs |
| `label` | `labels` (JSON array) | One or more label strings; matched via `json_each` |
| `priority` | `priority` | One or more priority names |
| `updatedFrom` | `updatedAt` | ISO-8601 date; items with `updatedAt >= value` |
| `updatedTo` | `updatedAt` | ISO-8601 date; items with `updatedAt <= value` |

`updatedFrom` and `updatedTo` are validated for ISO-8601 format before SQL execution;
HTTP 400 `{ "error": "invalid_date_format" }` returned on bad input.

**Keyword search (`q`):**
- Pattern `[A-Z][A-Z0-9_]+-\d+` → exact-match on `itemId` (Issue key lookup).
- All other values → tokenized on whitespace; each token must appear in
  `LOWER(summary) LIKE ?` (AND across tokens, case-insensitive).
- Body-content search (ADF description/comment text) is explicitly not supported.

**Attachment filename search (`attachmentFilename`):**
- Tokenizes the value on whitespace; every token must appear case-insensitively in at
  least one filename entry in the `attachments` JSON array column (AND across tokens).

**JSM exclusion — defense-in-depth at item query layer:**
- Issue items: project key prefix extracted from `itemId` via
  `SUBSTR(itemId, 1, INSTR(itemId, '-') - 1) NOT IN (<jsm_project_keys>)`.
- Project items: `itemId NOT IN (<jsm_project_ids>)`.
- JSM project keys/IDs sourced from `manifest.jsmDeferredProjects` parsed from the
  backup manifest row; each exclusion emits
  `[inventory] jsm_excluded projectKey=<key> reason=service_desk`.

#### Database migrations

- `src/db/migrations/012_inventory_items_facets.sql` — adds nullable facet columns to
  `backup_point_items` via `ALTER TABLE … ADD COLUMN`: `status TEXT`, `issueType TEXT`,
  `assignee TEXT`, `priority TEXT`, `updatedAt TEXT`, `sprintId TEXT`, `boardId TEXT`,
  `labels TEXT` (JSON array). All columns nullable; existing rows default to `NULL`.
- `src/db/migrations/013_inventory_items_attachments.sql` — adds nullable
  `attachments TEXT` column (JSON array of attachment filename strings) to
  `backup_point_items`. `NULL` for Issues with no attachments; existing rows default
  to `NULL`.

### No new environment variables
No new environment variables are introduced in this sprint.
The `DCC_ATTACHMENT_DIR` documentation gap (key introduced Sprint 3 Phase 2, omitted
from `INSTALL.md` §2 env table at that time) is resolved in this sprint.

---

## [Phase 3 Sprint 1] — 2026-05-04 — Inventory API & Sidebar (Protected Object Browse Flow)

### Added

#### `GET /api/inventory` — expanded response — `src/routes/inventory.ts`
- Response now returns an `objectTypes[]` array (replaces the Phase 1 stub `counts` object).
- Each entry: `{ type, displayName, count, lastBackupAt }` where `type` is one of
  `Issue` | `Project` | `Board` | `Sprint` | `Workflow` | `CustomField`.
- `count` is sourced from the most recent `BackupManifest` for the `connectionId`.
- **JSM exclusion**: only `manifest.projects` (non-`service_desk`) contribute to counts;
  `manifest.jsmDeferredProjects` entries are excluded from all types (T8 §2, §3).
- Board IDs and Sprint IDs are deduplicated across all non-JSM projects before counting.
- `lastBackupAt` is set to `manifest.discoveredAt`; `null` when no manifest exists.
- `backupPointId` (the manifest UUID) is returned alongside `objectTypes[]` to seed the
  Object Explorer with the most recent backup point.
- Structured log: `[inventory] connectionId=<id> backupPointId=<id|none> jsmExcludedProjects=<n>`
- `buildInventoryResponse(manifest)` — pure helper; directly testable in isolation.
- Error responses: `400 missing_required_fields` (no `connectionId`),
  `404 connection_not_found`, `404 no_manifest_found`.

#### `GET /api/inventory/:type` — paginated item list — `src/routes/inventory.ts`
- Path parameter `:type` must be one of: `Issue`, `Project`, `Board`, `Sprint`.
  Returns `400 invalid_type` for any other value.
- Required query params: `connectionId`, `backupPointId`.
- Optional: `limit` (default 50, max 200), `offset` (default 0).
- Reads `backup_point_items` rows for `(connectionId, backupPointId, objectType)`.
- Response: `{ items[], pagination: { limit, offset, total } }`.
- Each item: `{ id, displayName, backupPointId, backupPointTimestamp, changeBadge, summary? }`.
  - `summary` is included (and non-empty) only for `Issue` items.
- **Single-click traceability**: every item carries `backupPointId` (UUID) and
  `backupPointTimestamp` (ISO-8601), satisfying T5 §6.2 traceability (T8 §3).
- Error responses: `400 missing_required_fields`, `404 connection_not_found`,
  `404 backup_point_not_found`.

#### Database migration — `src/db/migrations/011_inventory_items.sql`
- `backup_point_items` table — per-item inventory rows for `Issue`, `Project`, `Board`, `Sprint`.
- Columns: `rowId` (autoincrement PK), `connectionId` (FK → `connections`),
  `backupPointId` (FK → `backup_manifests`), `objectType` (checked enum), `itemId`,
  `displayName`, `summary` (nullable), `changeBadge` (checked enum, default `unchanged`),
  `capturedAt` (ISO-8601).
- Unique index on `(backupPointId, objectType, itemId)`; lookup index on
  `(connectionId, backupPointId, objectType)`.
- Both FKs cascade-delete when the parent connection or manifest row is removed.

#### Inventory Sidebar — `src/ui/components/InventorySidebar.tsx`
- Renders four object types in fixed order: Issues (default), Projects, Boards, Sprints.
- Calls `GET /api/inventory?connectionId=<id>` on mount; renders skeleton rows during load.
- Each row: object-type label, count badge, relative timestamp ("2h ago"); `title` tooltip
  shows full ISO-8601 timestamp on hover.
- **"No backup yet" banner** when all four types have `lastBackupAt: null`.
- `onSelect(type)` callback drives the active type in the parent `InventoryPage`.
- `onInventoryLoad({ backupPointId })` passes the manifest UUID up to seed `ObjectExplorer`.

#### Object Explorer — `src/ui/components/ObjectExplorer.tsx`
- Paginated browse panel for a single object type; page size 50 items per page.
- Calls `GET /api/inventory/:type?connectionId&backupPointId&limit&offset` when
  `backupPointId` is non-null.
- Pagination bar: "Showing X–Y of N" with ← Prev / Next → buttons; disabled at boundaries.
- Each item row: change badge (`Added` | `Modified` | `Deleted` | `Unchanged`), display name,
  optional summary (Issues only), and a ⊕ trace button.
- **Trace panel**: clicking ⊕ expands an inline panel showing `Backup Point ID` (UUID) and
  `Captured At` (formatted local timestamp). Click ⊕ again to collapse.
- In-flight requests are cancelled on navigation (offset, type, or backup-point change).

#### API fetch utility — `src/ui/lib/apiFetch.ts`
- `apiFetch<T>(path, options?)` — typed wrapper around `fetch`; throws `ApiError(status)`
  on non-2xx responses. Used by `InventorySidebar` and `ObjectExplorer`.

#### Inventory page wiring — `src/App.tsx`
- `/inventory` route added; renders `InventoryPage` composing sidebar and explorer side-by-side.
- Auto-selects the first connected site via `GET /api/connections` on mount.
- `selectedType` state defaults to `'Issue'`; `backupPointId` is received from the sidebar
  `onInventoryLoad` callback.

### No new environment variables
No new environment variables or ports are introduced in this sprint.
`INSTALL.md` is unchanged. See `.env.example` for the full documented key set.

---

## [Sprint 3 — Phase 2] — 2026-05-04 — Attachments, Manifest Diff, Policies & Progress Telemetry

### Added

#### Binary-faithful attachment storage — `src/workload/snapshot/downloadIssueAttachments.ts`
- `downloadIssueAttachments(client, cloudBaseUrl, backupPointId, issueKey, attachments, baseDir?)` —
  downloads every attachment ref in an Issue payload via `IJiraHttpClient.downloadAttachment()`
  (no raw `fetch`/`axios`); writes the binary byte-for-byte to disk and re-reads it to
  verify SHA-256 before writing the sidecar (T3 §3.2, §4.4).
- Disk layout:
  - Binary: `data/attachments/{backupPointId}/{issueKey}/{attachmentId}`
  - Sidecar: `data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json`
- Post-write SHA-256 mismatch is recorded as a per-item error (`outcome=hash_mismatch`);
  processing of remaining attachments continues.
- Structured log per attachment:
  `[attachment] op=download id=<id> bytes=<n> sha256=<hex> outcome=<ok|hash_mismatch|http_error>`
- Storage root defaults to `data/attachments`; override via `DCC_ATTACHMENT_DIR` env var.
- Wired into `CaptureOrchestrator.runCapture()` — attachment errors increment `issueErrorCount`
  without aborting the Issue phase.

#### Attachment storage contracts — `src/workload/types/Attachment.ts`
- `AttachmentStoragePaths` — `{ binaryPath, sidecarPath }` pair resolved by
  `resolveAttachmentPaths(backupPointId, issueKey, attachmentId, baseDir?)`.
- `AttachmentSidecar` — JSON sidecar schema: `attachmentId`, `issueKey`, `backupPointId`,
  `filename`, `mimeType`, `size`, `sha256`, `capturedAt`.
- `Attachment` — composite of paths + metadata consumed by the restore engine.

#### Manifest deletion-diff — `src/workload/backup/computeManifestDiff.ts`
- `computeManifestDiff(current, previous)` — compares the current `BackupManifest` against
  the previous one for the same `connectionId`; stamps each `ProjectRecord.changeBadge` with
  `added` | `modified` | `deleted` | `unchanged` (T4 §6).
- `stableProjectHash(p)` — SHA-256 digest of `{ projectKey, projectName, projectTypeKey,
  boardIds (sorted), sprintIds (sorted) }`; excludes volatile timestamps and computed counts.
- Deleted projects are retained in `projects[]` with `changeBadge: 'deleted'` and
  `lastSeenBackupPointId` pointing to the manifest where they last appeared.
- `DiffSummary` — aggregate `{ added, modified, deleted, unchanged }` counts persisted
  as `BackupManifest.diffSummary` after every snapshot run.

#### Manifest diff contracts — `src/workload/types/ManifestDiff.ts`
- `ChangeBadge`, `ProjectDiffEntry`, `ManifestDiffSummary`, `ManifestDiff` — type contracts
  for the deletion-diff pass.

#### `POST /api/policies` — `src/routes/policies.ts`
- Accepts `{ connectionId, rpoHours, retentionDays, projectScope, selectedProjectKeys?,
  jqlFilter? }`.
- `rpoHours` (required, > 0) — Recovery Point Objective in hours.
- `jqlFilter` (optional) — validated via `POST /rest/api/3/jql/parse` before the policy
  is stored; HTTP 400 `{ "error": "invalid_jql" }` on parse failure.
- Returns HTTP 201 with `{ policyId, connectionId, rpoHours, projectScope,
  selectedProjectKeys, retentionDays, jqlFilter?, updatedAt }`.

#### Policy type contracts — `src/workload/types/PolicyRecord.ts`
- `PolicyRecord`, `PolicyRequest`, `JqlParseRequest`, `JqlParseResponse` — shape definitions
  for the policy store and the JQL validation round-trip.

#### `GET /api/jobs/:id` — `src/routes/jobs.ts`
- Returns `{ jobId, status, manifestId, connectionId, createdAt, updatedAt, errorsCount,
  lastEvent }` for a backup job.
- `lastEvent` is the most recent `backup_job_events` row (parsed from `eventJson`).
- HTTP 404 when the job ID is not found.

#### Progress emitter & stalled detection — `src/workload/snapshot/ProgressEmitter.ts`
- `ProgressEmitter` manages the `backup_jobs` + `backup_job_events` tables for a single job.
- `start()` — transitions job to `running` and arms the watchdog timer (polls every 5 s).
- `emit(captureEvent, errorsCount)` — persists a heartbeat event row and resets the stalled
  clock; satisfies the ≤10 s contract (T5 §6.2).
- `complete(errorsCount)` — sets `completed` (errorsCount === 0) or `completed_with_errors`
  (errorsCount > 0); clears the watchdog.
- `fail(reason)` — sets `failed`; clears the watchdog.
- Watchdog: transitions job to `stalled` when `Date.now() − lastHeartbeatMs > 20 000 ms`
  (T5 §6.2).
- Structured log: `[backup-job] op=start|heartbeat|stalled|completed|failed jobId=<id> errors=<n>`

#### Progress event contracts — `src/workload/types/ProgressEvent.ts`
- `ProgressEvent` — unified shape for backup and restore job heartbeats.
- `JobStatus` — `pending | running | completed | completed_with_errors | failed | stalled`.
- `MAX_HEARTBEAT_INTERVAL_MS = 10 000` — maximum gap between emitted events.
- `STALLED_THRESHOLD_MS = 20 000` — silence threshold for stalled detection.

#### Database migrations
- `src/db/migrations/010_backup_jobs.sql` — `backup_jobs` table (`jobId`, `manifestId`,
  `connectionId`, `status`, `createdAt`, `updatedAt`, `lastEventTs`, `errorsCount`) and
  `backup_job_events` table with a `(jobId, ts)` index.
- `src/db/migrations/010_policies_rpo_jql.sql` — adds `rpoHours INTEGER NOT NULL DEFAULT 24`
  and `jqlFilter TEXT` columns to the existing `policies` table.

#### Environment variable
- `DCC_ATTACHMENT_DIR` — overrides the attachment binary storage root directory.
  Default: `data/attachments`. Set in `.env` to redirect storage to an external volume,
  e.g. `DCC_ATTACHMENT_DIR=/mnt/backup-volume/attachments`.

---

## [Sprint 2 — Phase 2] — 2026-05-04 — Issue Enumeration, Custom Field Context & Capture Order

### Added

#### Custom field context discovery — `src/workload/backup/discoverFieldContexts.ts`
- `discoverFieldContexts(client, cloudBaseUrl)` — calls `GET /rest/api/3/field` once
  to list all fields, then for each field where `custom === true` calls
  `GET /rest/api/3/field/{id}/context` (paginated via `startAt` / `isLast`).
- System fields (`custom === false`) are never passed to the context endpoint; each
  emits a `[field-context] skip field_id=<id> reason=system-field` log line.
- Custom fields emit `[field-context] fetch field_id=<id> contextCount=<n>` after all
  context pages are collected.
- Results are persisted inside `manifestJson` in `backup_manifests` (T2 §6 Constraint 7,
  T3 §4.2).

#### Issue payload assembler — `src/workload/snapshot/assembleIssuePayload.ts`
- `assembleIssuePayload(raw, allCustomFieldIds)` — normalizes a raw
  `POST /rest/api/3/search/jql` response into an `IssuePayload` satisfying the
  coverage invariant (T3 §3.3, §3.5).
- Full payload: system fields, `customFieldValues` map (all custom field IDs present,
  `null` when absent), ADF comments, all issue links (inward and outward), subtask keys,
  sprint IDs, watcher accountIds, worklogs, and attachment refs.
- `assertCoverageInvariant(payload, allCustomFieldIds)` — throws a diagnostic when
  `Object.keys(customFieldValues).length !== allCustomFieldIds.length`.
- Sprint IDs extracted by scanning all custom field values for sprint-shaped objects
  (`{ id, state: 'active' | 'closed' | 'future' }`), avoiding a hardcoded
  `customfield_10020` assumption.

#### Capture-order orchestrator — `src/workload/snapshot/CaptureOrchestrator.ts`
- `CaptureOrchestrator.runCapture(options, onProgress)` — executes snapshot phases in
  dependency order: `CustomField → Project → Issue` (T1 §1, T3 §3.4).
- A failure in `CustomField` phase halts execution and surfaces a named `phaseDiagnostic`
  before any Project or Issue capture begins.
- Issue enumeration uses `enumerateIssues()` backed by `POST /rest/api/3/search/jql`;
  pagination terminates on `issues.length === 0` or `issues.length < maxResults`.
- Progress events emitted per project and on a 9-second time-based heartbeat, satisfying
  the ≤10 s contract (T5 §6.2). Jobs silent for >20 s surface a "stalled" alert.
- `"Completed with N errors"` semantics: `issuePhase.status === 'partial'` when any
  issue fails; full error count in `CaptureRunResult.errorCount` (T5 §6.2b).

#### Issue enumeration — `src/workload/http/JiraHttpClient.ts`
- `enumerateIssues(cloudBaseUrl, projectKey, jql, fields, opts)` — paginates
  `POST /rest/api/3/search/jql` using `nextPageToken`; terminates on
  `issues.length === 0` or `issues.length < maxResults`.
- Emits `[search] endpoint=search/jql project=<key> page=<n> pageSize=<n> returnedCount=<n>` per page
  for operator-observable progress.

#### `JiraWorkload.snapshot()` — `src/workload/JiraWorkload.ts`
- Loads the manifest from `backup_manifests`, constructs a `CaptureOrchestrator`,
  runs the full capture lifecycle, and persists the updated manifest
  (`fieldContexts`, `customFieldsCaptured`, `coverageInvariant`) back to the DB.
- Returns `{ backupPointId, completedAt, itemCount, errorCount }` to the platform layer.

### Forbidden endpoint
- `GET /rest/api/3/search` is explicitly forbidden and not used anywhere in the
  codebase. All Issue discovery and backup uses `POST /rest/api/3/search/jql`
  exclusively. The `check:http-guard` script (`scripts/check-http-guard.sh`) enforces
  this invariant (T2 §6 Constraint 6).

### Not yet exposed
- `/api/snapshot` HTTP route — Sprint 3 deliverable. Issue enumeration and capture
  logic are fully implemented and verified via unit tests.

---

## [Sprint 1 — Phase 2] — 2026-05-04 — Backup Engine Foundations: HTTP Client, Project Discovery & JSM Detection

### Added

#### Workload JiraHttpClient — `src/workload/http/JiraHttpClient.ts`
- Concrete implementation of `IJiraHttpClient` (defined in `src/workload/backup/types.ts`)
  for use by the backup engine.
- `getJson<T>` — authenticated GET with optional query parameters; retries once on HTTP 401
  using the rotating-refresh-token mechanism inherited from the credential store.
- `searchJql` — `POST /rest/api/3/search/jql` exclusive Issue enumeration path; the
  deprecated `GET /rest/api/3/search` endpoint is never used.
- `downloadAttachment` — `GET /rest/api/3/attachment/content/{id}` binary download;
  computes a SHA-256 `contentHash` immediately after download for integrity verification.
- `getPaginated` — generic paginator using Jira's `startAt / maxResults / isLast` pattern;
  stops on `isLast === true` or when the returned `values` array is shorter than `pageSize`.
- `_createForTesting` / `_clearInstances` — test-double injection points for hermetic
  unit and smoke tests; production code uses `JiraHttpClient.forConnection(connectionId)`.
- Single-flight refresh mutex: concurrent callers queue behind one in-flight
  `POST https://auth.atlassian.com/oauth/token`; both `accessToken` and `refreshToken`
  are atomically committed to the `credentials` table before the mutex releases.

#### Backup Engine type contracts — `src/workload/backup/types.ts`
- `IJiraHttpClient` interface decoupling the backup engine from transport concerns.
- `CapturePhase` / `CAPTURE_PHASE_ORDER` — immutable dependency-ordered capture sequence:
  `IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue`.
- `BackupManifest`, `ProjectRecord`, `JsmDeferredProject` — manifest schema types.
- `IssueRecord` — full Issue payload satisfying the coverage invariant (all system fields,
  `customFieldValues` map, ADF comments, issue links, subtasks, sprint membership, watchers,
  worklogs, and attachment references).
- `CaptureProgressEvent`, `ICaptureOrchestrator`, `CaptureRunResult` — orchestrator interface
  with phase progress events emitted at most every 10 seconds.

#### Project discovery — `src/workload/backup/discoverProjects.ts`
- `discoverProjects(client, cloudBaseUrl, scope, selectedKeys?)` — paginates
  `GET /rest/api/3/project/search` via `JiraHttpClient.getPaginated`, honouring
  `projectScope` (`all` / `selected`).
- Zero-omissions invariant: every project returned by the API appears in either
  `projects[]` (backed up) or `jsmDeferredProjects[]` (deferred) — no project
  is silently omitted (T3 §4.3, T4 §6).
- JSM detection: projects with `projectTypeKey === 'service_desk'` are separated
  into `jsmDeferredProjects` with `reason: 'PHASE_2_DEFERRED'` and a structured
  `[discover] jsm-deferred` log line per excluded project.
- `partitionJsmProjects` — pure helper for classifying a flat project array;
  used by `discoverProjects` and directly testable in isolation.

#### Discover operation — `src/workload/JiraWorkload.ts`, `src/routes/discover.ts`
- `JiraWorkload.discover(connectionId, policy)` — resolves credentials from the DB,
  constructs the `cloudBaseUrl` (`https://api.atlassian.com/ex/jira/{cloudId}`),
  calls `discoverProjects`, assembles a `BackupManifest`, and persists it to
  `backup_manifests` in a single `INSERT`.
- Returns `{ backupPointId, completedAt, projectCount, jsmDeferredCount }` to the
  platform layer.
- `WorkloadAuthError` — typed error thrown when the connection or credentials row is
  missing; surfaced by the route as HTTP 401.
- `POST /api/discover` — route accepting `{ connectionId, projectScope, selectedProjectKeys? }`;
  validates required fields (HTTP 400) and delegates to `jiraWorkload.discover()`;
  surfaces `WorkloadAuthError` as HTTP 401.

#### Database migration — `src/db/migrations/009_backup_manifests.sql`
- `backup_manifests` table (`id`, `connectionId` FK → `connections`, `cloudId`,
  `createdAt`, `manifestJson`) storing the full `BackupManifest` JSON payload
  produced by each discover run.

#### Smoke probe — `scripts/smoke-discover.ts`
- Standalone `tsx` script that exercises `JiraWorkload.discover()` with an
  in-memory SQLite database and a mocked Atlassian project-search API (3 software +
  1 JSM project). Asserts `projectCount`, `jsmDeferredCount`, manifest row written
  to `backup_manifests`, and `PHASE_2_DEFERRED` reason on the deferred entry.
- Run with `npx tsx scripts/smoke-discover.ts`. No live credentials required.

---

## [Sprint 2] — 2026-05-04 — Platform Stub Endpoints, Manual Connection & Doc Grounding

### Added

#### Manual connection path — `src/routes/connections.ts`
- `POST /api/connections` now accepts `"mode": "manual"` (or `"connectionType": "manual"`)
  with `cloudId`, `siteName`, `clientId`, and `clientSecret` fields.
- Returns `{ connectionId, cloudId, siteName, scopes: [], status: "connected", clientIdMasked }`;
  `clientIdMasked` shows only the last four characters of `clientId`.
- cloudId mismatch enforcement (HTTP 409) applies to both manual and OAuth modes.

#### Inventory endpoint — `src/routes/inventory.ts`, `src/server.ts`
- `GET /api/inventory?connectionId=<id>` — returns a stub manifest with object counts
  (`projects`, `issues`, `boards`, `sprints`) scoped to the requested connection.
- Returns HTTP 400 if `connectionId` is omitted; HTTP 404 if the connection does not exist.
- Response shape: `{ manifestId, completedAt, counts }`.

#### Policies endpoint — `src/routes/policies.ts`, `src/server.ts`
- `POST /api/policies` — creates a backup policy for a connection.
- Required fields: `connectionId`, `projectScope` (`"all"` | `"selected"`), `retentionDays`.
- Optional: `selectedProjectKeys` (array of project keys; only used when `projectScope` is `"selected"`).
- Returns HTTP 201 with `{ policyId, connectionId, projectScope, selectedProjectKeys, retentionDays, updatedAt }`.

#### Restore endpoints — `src/routes/restores.ts`, `src/server.ts`
- `POST /api/restores` — enqueues a restore job.
  Required: `connectionId`, `backupPointId`, `itemIds` (array).
  Optional: `conflictMode` (default `"skip"`), `destination` (default `{ type: "original" }`).
  Returns HTTP 201 with `{ restoreId, status: "pending" }`.
- `GET /api/restores/:id` — returns restore job status including `restoredCount`, `errorCount`,
  `createdAt`, `completedAt`, and `phaseDiagnostic` (when set).
- `GET /api/restores/:id/events` — Server-Sent Events stream; emits one initial progress event
  with current phase and status, then closes.

#### Database migrations
- `007_restores.sql` — `restores` table (`restoreId`, `connectionId`, `backupPointId`, `status`,
  `conflictMode`, `destination`, `itemIds`, `restoredCount`, `errorCount`, `phaseDiagnostic`,
  `createdAt`, `completedAt`).
- `008_policies.sql` — `policies` table (`policyId`, `connectionId` FK → `connections`, `projectScope`,
  `selectedProjectKeys`, `retentionDays`, `updatedAt`).

#### Developer setup
- `Caddyfile` — local HTTPS reverse-proxy: terminates TLS at `https://localhost`, forwards `/api/*`
  to port 3000 (API server) and `/*` to port 5173 (Vite dev server). Required for OAuth callback
  registration with Atlassian's developer console.
- `.env.example` — documents all required environment variables (`ATLASSIAN_CLIENT_ID`,
  `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI`, `PORT`).

---

## [Sprint 3] — 2026-05-04 — OAuth 3LO Foundation: HTTP Client, Probes & Connections UI

### Added

#### OAuth 2.0 Authorization Code (3LO) flow — `src/oauth/authorize.ts`, `src/oauth/tokenExchange.ts`
- `buildAuthorizeUrl` constructs the Atlassian authorization URL with PKCE (S256) and
  the full Phase 1 scope set (`offline_access`, `read:jira-work`, `write:jira-work`,
  `read:jira-user`, `manage:jira-project`, `manage:jira-configuration`,
  `read:board-scope:jira-software`, `write:board-scope:jira-software`,
  `write:board-scope.admin:jira-software`, `read:sprint:jira-software`,
  `write:sprint:jira-software`).
- `handleAuthorize` generates a PKCE verifier/challenge pair, persists state in
  `oauth_state` with a 10-minute TTL, and redirects the browser to Atlassian.
- `handleCallback` validates state, exchanges the authorization code for tokens,
  resolves `cloudId` + `siteName` from accessible-resources, enforces cloudId
  mismatch detection (returns HTTP 409 on reauth collision), and upserts the
  connection + credential records in a single SQLite transaction.
- State is consumed exactly once (deleted before network calls) to prevent replay.

#### JiraHttpClient — `src/http/JiraHttpClient.ts`
- Canonical authenticated HTTP client; one singleton per `connectionId` via
  `JiraHttpClient.forConnection(connectionId)`.
- Automatic token refresh on HTTP 401: retries the original request exactly once
  with the rotated access token.
- Single-flight refresh mutex: concurrent callers queue behind one in-flight
  `POST https://auth.atlassian.com/oauth/token` request; the mutex releases only
  after both `accessToken` and `refreshToken` are atomically committed to the
  `credentials` table.
- Injected `FetchFn` for hermetic testing (`_createForTesting`, `_clearInstances`).

#### Permission-validation probes — `src/probes/permissionProbes.ts`
- `runPermissionProbes(connectionId)` hits all four Phase 1 probe endpoints in
  parallel with a 5-second aggregate timeout:
  - `GET /rest/api/3/myself`
  - `GET /rest/api/3/field`
  - `GET /rest/agile/1.0/board`
  - `GET /rest/api/3/workflow/search`
- Results are persisted to `probe_results` (one transaction, idempotent replace)
  and returned as `ProbeResult[]` with `remediationNeeded: true` for HTTP 403.
- `getProbeResults(connectionId)` retrieves the latest probe snapshot from the DB.
- `GET /api/connections` surfaces `"status": "probe-failed"` when any probe has
  `remediationNeeded: true`.

#### Platform Stub endpoints — `src/routes/connections.ts`, `src/routes/oauth.ts`, `src/server.ts`
- `POST /api/connections` — upserts a connection + credentials record; returns
  `{ connectionId, status: "connected" }`.
- `GET /api/connections` — lists all connections with embedded probe results.
- `GET /api/connections/:id/probes` — returns latest probe snapshot for one connection.
- `GET /api/oauth/authorize` — starts the OAuth flow.
- `GET /api/oauth/callback` — completes the token exchange.

#### Database migrations — `src/db/migrations/`
- `002_connections.sql` — `connections` table (connectionId, cloudId, siteName, status).
- `003_oauth_state.sql` — `oauth_state` table with TTL expiry column.
- `004_client_creds.sql` — `credentials` table with clientId/clientSecret columns.
- `005_oauth_state_connectionid.sql` — adds `connectionId` FK to `oauth_state` for
  reauth cloudId mismatch enforcement.
- `006_probe_results.sql` — `probe_results` table (endpoint, status, duration_ms,
  remediationNeeded, checkedAt).

#### Connections UI — `src/ui/components/WorkloadCard.tsx`, `src/ui/pages/ConnectionsList.tsx`
- `WorkloadCard` — value-prop copy, minimum requirements, and **Authorize Jira Cloud**
  button that initiates the OAuth redirect via `GET /api/oauth/authorize`.
- `ConnectionsList` — lists connected sites with `siteName` per row; polls
  `GET /api/connections` on mount.

#### Documentation
- `README.md` — project overview and quick-links table.
- `INSTALL.md` — prerequisites, `.env.example` key reference, HTTPS-via-Caddy note,
  podman-compose start instructions.
- `DEMO.md` — Connect Jira Site walkthrough, manual connection path, machine-readable
  smoke probes (curl + grep + python3; no jq dependency).
- `.env.example` — documents `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`,
  `OAUTH_REDIRECT_URI`, `PORT`.
- `ARCHITECTURE.md` — platform/workload boundary, interface contract, design constraints.

---

_Earlier sprints pre-date this CHANGELOG. See git history for prior context._
