# Changelog

All notable changes are documented here by sprint.

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
