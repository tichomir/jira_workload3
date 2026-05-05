# Installation

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20 LTS |
| npm | 10 |
| Python 3 | 3.9 (smoke probes only) |
| curl | any recent version |

## 1. Clone, install, and build

```bash
git clone <repo-url> jira-workload
cd jira-workload
npm install
npm run build
```

## 2. Configure environment

Copy the example file and fill in your Atlassian OAuth app credentials:

```bash
cp .env.example .env
```

Edit `.env`:

| Key | Description |
|---|---|
| `ATLASSIAN_CLIENT_ID` | OAuth app Client ID from the Atlassian developer console |
| `ATLASSIAN_CLIENT_SECRET` | OAuth app Client Secret — **required at server startup**; the server exits with a FATAL error if this is not set |
| `OAUTH_REDIRECT_URI` | Callback URL registered in the Atlassian developer console — **must use HTTPS** (Atlassian rejects plain HTTP redirect URIs) |
| `PORT` | API server port (default `4000`) |
| `DB_PATH` | _(optional)_ SQLite database file path (default: `data/jira_workload.db` relative to project root). Set to an absolute path to redirect the database to a persistent volume. |
| `DCC_ATTACHMENT_DIR` | _(optional)_ Override directory for attachment binary storage (default: `data/attachments`). Set to an absolute path to redirect storage to an external volume, e.g. `/mnt/backup-volume/attachments`. |

### HTTPS callback requirement

Atlassian's OAuth 2.0 (3LO) flow requires a registered redirect URI. For local
development the redirect URI must be served over HTTPS. The recommended setup is
Caddy as a local TLS terminator:

1. Install [Caddy](https://caddyserver.com/docs/install).
2. A `Caddyfile` is included in the project root with the correct configuration:

```
localhost {
    reverse_proxy /api/* localhost:4000
    reverse_proxy /* localhost:5173
}
```

3. Run `caddy run` from the project root. Caddy provisions a locally-trusted TLS
   certificate automatically via its internal CA.
4. Set `OAUTH_REDIRECT_URI=https://localhost/api/oauth/callback` in `.env` and
   register the same URI in the Atlassian developer console.

## 3. Run database migrations

The first run of the API server applies migrations automatically via `src/db/database.ts`.
You can also trigger them manually:

```bash
npx tsx src/db/database.ts
```

## 4. Start the services

### Primary path — podman-compose + start.sh

A `podman-compose.yml` is included at the project root. It starts the API server
(`app` service, Node 20) and a Caddy TLS sidecar (`caddy` service) together.
Named volumes keep SQLite and attachment data outside the container layer.

> **Docker compatibility:** `docker compose -f podman-compose.yml up` works without
> modification — `podman-compose.yml` uses standard Compose v3.9 syntax.

```bash
cp .env.example .env   # copy and fill in your OAuth credentials
./start.sh             # builds image, starts stack, waits for /health
```

`start.sh` runs `podman-compose up -d` and polls `http://localhost:4000/health`
until the server responds, then prints the URL. Additional compose commands:

```bash
podman-compose logs -f app   # follow API server logs
podman-compose down          # stop and remove containers (volumes are retained)
```

Caddy provisions a locally-trusted TLS certificate automatically. Set
`OAUTH_REDIRECT_URI=https://localhost/api/oauth/callback` in `.env` and register
the same URI in the Atlassian developer console.

The Dockerfile runs `npm run build` at image build time; the Express app serves the
compiled frontend from `dist/`. The GUI is available at **http://localhost:4000** (direct)
or at **https://localhost** through the Caddy TLS terminator. Run `npm run dev` in a
separate terminal only if you need UI hot-reload during development.

### Alternative — plain npm (no container)

**Minimal path** — build once, then run the server (single terminal):

```bash
npm run build   # build the frontend bundle (once, or after UI changes)
npm run server  # API server + frontend GUI on http://localhost:4000
```

Open **http://localhost:4000** in a browser for the GUI.

**Hot-reload development path** — two terminals:

Terminal 1: API server

```bash
npm run server
```

Terminal 2: Vite dev server (UI hot-reload)

```bash
npm run dev
```

Navigate to `https://localhost` (if using Caddy) or `http://localhost:5173` (plain Vite dev server).

## 5. Verify the server is running

```bash
curl -sf http://localhost:4000/health
```

A `{"status":"ok"}` response confirms the server is healthy.

To also confirm the database is initialised:

```bash
curl -sf http://localhost:4000/api/connections | python3 -m json.tool
```

An empty JSON array `[]` confirms connections are accessible.

## 5a. Run the test suite

```bash
npm run test
```

All tests run against an in-memory SQLite database with no live credentials required.
Exit 0 and `Test Files N passed` confirms the suite is healthy.

## 6. CI Secrets

The smoke-probe CI workflow (`.github/workflows/smoke-probes.yml`) runs all
five operator-flow probes against a sandbox Jira site on every push to
`main`/`master` and on every pull request.

Add the following secrets to your GitHub repository
(**Settings → Secrets and variables → Actions → New repository secret**):

| Secret name | Description |
|---|---|
| `JIRA_SANDBOX_CLIENT_ID` | OAuth 2.0 Client ID for the sandbox Jira app (Atlassian developer console) |
| `JIRA_SANDBOX_CLIENT_SECRET` | OAuth 2.0 Client Secret for the same app |
| `JIRA_SANDBOX_OAUTH_REDIRECT_URI` | Redirect URI registered in the Atlassian developer console for the sandbox app |

These map to the `.env` keys `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`,
and `OAUTH_REDIRECT_URI` used by the API server at runtime.

### CI artifacts

After each run, the workflow uploads a per-probe results file as the artifact
`smoke-probe-results` (retained for 30 days). The file contains one `STATUS|probe-name`
line per probe and is visible in the GitHub Actions run summary under **Artifacts**.
The job summary also renders a Markdown table of PASS / FAIL / TIMEOUT / Not run
status for every probe.

### Running smoke probes locally

To run all probes locally against a running API server:

```bash
# Start the server first (Terminal 1)
npm run server

# Run the probe suite (Terminal 2)
bash scripts/run-smoke-probes.sh
```

Each probe script in `scripts/smoke/` can also be run individually:

```bash
bash scripts/smoke/probe-connect-jira-site.sh
bash scripts/smoke/probe-run-first-backup.sh
bash scripts/smoke/probe-browse-protected-inventory.sh
bash scripts/smoke/probe-restore-protected-objects.sh
bash scripts/smoke/probe-view-sdi-teaser.sh
```

The runner script extracts `# name:` and `# timeout:` from each probe's header
and enforces the timeout via the system `timeout` command.

---

## 7. API surface

All endpoints are served by the Express API server (`npm run server`) on
`http://localhost:${PORT}` (default 4000).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/connections` | List all connected Jira sites |
| `POST` | `/api/connections` | Connect a Jira site (OAuth or manual) |
| `GET` | `/api/connections/:id/probes` | Latest permission-probe results for a connection |
| `GET` | `/api/oauth/authorize` | Start the OAuth 3LO authorization flow |
| `GET` | `/api/oauth/callback` | OAuth callback — exchanges code for tokens |
| `POST` | `/api/discover` | Run project discovery for a connection |
| `POST` | `/api/policies` | Create or update a backup policy |
| `GET` | `/api/jobs/:id` | Get backup job status and last heartbeat event |
| `GET` | `/api/inventory` | Object-type counts from the most recent backup manifest |
| `GET` | `/api/inventory/:type` | Paginated object list (`Issue`, `Project`, `Board`, `Sprint`) |
| `POST` | `/api/restore-jobs` | Create and launch a restore job |
| `GET` | `/api/restore-jobs/:id/events` | SSE stream of restore phase events for a job |
| `GET` | `/api/restore-jobs/trash-check` | Pre-flight trash-window check for selected project keys |
| `GET` | `/api/backup-points/:id/sdi-teaser` | SDI aggregate summary (issue/project counts, GDPR/PCI DSS regulation tags) for a backup point |

---

## 8. Operations runbook

Engineer-facing reference for diagnosing and recovering from the four most common failure modes. Each section follows the pattern: **Symptoms → Diagnostic log greps → Resolution steps**.

---

### 8.1 Connection Failure

#### Symptoms

- `GET /api/connections` returns a connection with `status: "probe-failed"`.
- Operator UI shows a 403 remediation banner on one or more permission probes.
- Backup or restore job fails immediately with an HTTP error before touching any objects.
- Server log contains lines like `getJson /rest/api/3/myself HTTP 403` or `No credentials found for connectionId=<id>`.

#### Diagnostic log greps

```bash
# All permission-probe results for a connection
grep '\[permission-probe\]' server.log

# Example matching output:
# [permission-probe] connectionId=<id> endpoint=/rest/api/3/myself status=403 duration_ms=212
# [permission-probe] connectionId=<id> endpoint=/rest/api/3/field status=200 duration_ms=89
# [permission-probe] connectionId=<id> endpoint=/rest/agile/1.0/board status=403 duration_ms=176
# [permission-probe] connectionId=<id> endpoint=/rest/api/3/workflow/search status=200 duration_ms=95

# Connection creation events (confirm connection exists)
grep 'connection_created' server.log

# Missing credentials error
grep 'No credentials found\|credentials row not found' server.log
```

The four probe endpoints checked by `src/probes/permissionProbes.ts`:
- `/rest/api/3/myself`
- `/rest/api/3/field`
- `/rest/agile/1.0/board`
- `/rest/api/3/workflow/search`

Any probe returning `status=403` sets `remediationNeeded: true` in `probe_results` and causes `GET /api/connections` to return `status: "probe-failed"` for that connection.

#### Resolution steps

1. **Re-authorise via OAuth 3LO.** Open the Connections page (`/connections`), click **Authorize** on the failing site, and complete the OAuth flow. This issues a fresh token with the full Phase 1 scope set defined in `src/oauth/authorize.ts:PHASE1_SCOPES`.

2. **Verify the Atlassian app has the required scopes.** In the Atlassian developer console, check that the app's OAuth 2.0 (3LO) permissions include all scopes from `src/oauth/authorize.ts`:
   ```
   offline_access read:jira-work write:jira-work read:jira-user
   manage:jira-project manage:jira-configuration
   read:board-scope:jira-software write:board-scope:jira-software
   write:board-scope.admin:jira-software
   read:sprint:jira-software write:sprint:jira-software
   ```

3. **Re-run probes manually** after re-authorising:
   ```bash
   curl -s http://localhost:4000/api/connections/<connectionId>/probes | python3 -m json.tool
   ```
   All four probes should return `status: 200` and `remediationNeeded: false`.

4. **Check credentials row** if the error is `No credentials found for connectionId=<id>`:
   ```bash
   sqlite3 data/jira_workload.db \
     "SELECT connectionId, expiresAt, updatedAt FROM credentials WHERE connectionId = '<id>';"
   ```
   A missing row means the connection was created before the credentials migration. Re-create the connection from the UI.

---

### 8.2 Scope Drift

#### Symptoms

- Restore job halts at the **Board** phase with `error.code: 'dependency_phase_failed'` and a message containing `Missing required board scope(s)`.
- Server log shows `[permission-probe] scope=write:board-scope:jira-software outcome=missing`.
- The SSE stream emits `{ type: 'job_failed', error: { code: 'dependency_phase_failed', phase: 'Board', ... } }`.
- Issue, Sprint, and subsequent phases never start.

#### Diagnostic log greps

```bash
# Board-scope re-check failures — fires before every Board restore phase
grep '\[permission-probe\] scope=write:board-scope' server.log

# Example matching output (drift case):
# [permission-probe] scope=write:board-scope:jira-software outcome=missing
# [permission-probe] scope=write:board-scope.admin:jira-software outcome=ok

# Restore-phase guard log
grep '\[restore\].*guard=board-scope-recheck' server.log

# Example matching output:
# [restore] phase=Board outcome=fail jobId=<id> guard=board-scope-recheck
```

The guard lives in `src/workload/restore/boardScopeRecheck.ts`. It reads the `scopes` column from the `credentials` table and checks for both variants:
- `write:board-scope:jira-software`
- `write:board-scope.admin:jira-software`

#### Why scope drift occurs

Atlassian's OAuth token refresh does not re-request scopes. If an app's permission set is modified in the developer console after the initial authorisation, the stored `scopes` column (`credentials.scopes`) retains the original grant. The stored scopes are only updated when the operator re-authorises from scratch.

#### Resolution steps

1. **Identify the missing scope(s)**:
   ```bash
   sqlite3 data/jira_workload.db \
     "SELECT connectionId, scopes FROM credentials WHERE connectionId = '<id>';"
   ```
   The `scopes` column is a space-separated string. Confirm that `write:board-scope:jira-software` and `write:board-scope.admin:jira-software` are both present.

2. **Verify the Atlassian app still has both board-scope permissions.** In the Atlassian developer console, navigate to the app → Permissions → Jira Software and confirm both:
   - `write:board-scope:jira-software`
   - `write:board-scope.admin:jira-software`

3. **Re-authorise the connection.** From the Connections page (`/connections`), click **Authorize** for the affected site. After the OAuth callback completes, `credentials.scopes` is updated atomically via `src/routes/connections.ts:_handleOAuth`.

4. **Confirm scopes are stored correctly**:
   ```bash
   sqlite3 data/jira_workload.db \
     "SELECT scopes FROM credentials WHERE connectionId = '<id>';" | tr ' ' '\n' | grep board
   # Expected output:
   # read:board-scope:jira-software
   # write:board-scope:jira-software
   # write:board-scope.admin:jira-software
   ```

5. **Retry the restore job** from the Restore Wizard. The board-scope guard in `src/workload/restore/RestoreOrchestrator.ts` runs fresh on every invocation.

---

### 8.3 Refresh-Token Rotation Failure

#### Symptoms

- A request fails with HTTP 401 and the job does not recover.
- Server log shows `[auth-refresh] connectionId=<id> outcome=failure`.
- Multiple concurrent requests for the same `connectionId` were in-flight when the token expired.
- Rarely: `token endpoint returned HTTP 400` indicating the stored `refreshToken` has already been consumed by a prior rotation that did not write atomically.

#### Log patterns — mutex lifecycle

The mutex logic lives in `src/workload/http/JiraHttpClient.ts:_refresh()`. Every token rotation produces three log lines:

```
[auth-refresh] connectionId=<id> mutex=acquire
[auth-refresh] connectionId=<id> outcome=success
[auth-refresh] connectionId=<id> mutex=release
```

A contention case (second concurrent caller queues behind the first) produces:

```
[auth-refresh] connectionId=<id> mutex=acquire   ← first caller acquires
[auth-refresh] connectionId=<id> mutex=acquire   ← second caller hits the guard, joins the same promise
[auth-refresh] connectionId=<id> outcome=success ← first caller completes the refresh
[auth-refresh] connectionId=<id> mutex=release   ← both callers unblock here
```

A failure case:

```
[auth-refresh] connectionId=<id> mutex=acquire
[auth-refresh] connectionId=<id> outcome=failure
[auth-refresh] connectionId=<id> mutex=release
```

#### Diagnostic log greps

```bash
# All auth-refresh events for a connection
grep "\[auth-refresh\] connectionId=<id>" server.log

# Failure events only
grep '\[auth-refresh\].*outcome=failure' server.log

# Rate-limit backoff during refresh-adjacent requests
grep '\[rate-limit\]' server.log
```

#### How the atomic write works

When a refresh succeeds, `JiraHttpClient._performRefresh()` writes both `accessToken` and `refreshToken` inside a single SQLite transaction (see `src/workload/http/JiraHttpClient.ts:_performRefresh`):

```typescript
db.transaction(() => {
  db.prepare(
    `UPDATE credentials SET accessToken = ?, refreshToken = ?, expiresAt = ?, updatedAt = ?
     WHERE connectionId = ?`
  ).run(data.access_token, data.refresh_token, expiresAt, now, connectionId);
})();
```

This guarantees that no concurrent reader can observe a half-written credential pair.

#### Resolution steps

**If `outcome=failure` appears once and recovery logs follow:** This is normal transient behaviour. The `_request` method automatically retries the original request after a successful refresh; no manual action is needed.

**If `outcome=failure` repeats and the connection is permanently broken:**

1. Check whether the Atlassian token has been revoked in the app admin panel.

2. Inspect the current credential expiry:
   ```bash
   sqlite3 data/jira_workload.db \
     "SELECT connectionId, expiresAt, updatedAt FROM credentials WHERE connectionId = '<id>';"
   ```
   An `expiresAt` of `0` means the row was created via the Manual Connection path and never had a valid OAuth token.

3. Re-authorise the connection from the Connections page (`/connections`). This resets `accessToken`, `refreshToken`, and `expiresAt` via `src/routes/connections.ts:_handleOAuth`.

4. After successful re-auth, confirm the refresh cycle works:
   ```bash
   # Trigger any authenticated probe to force a token use
   curl -s http://localhost:4000/api/connections/<connectionId>/probes | python3 -m json.tool
   # Then check the log for a clean mutex lifecycle
   grep "\[auth-refresh\]" server.log | tail -5
   ```

**If you suspect a dropped token rotation (refreshToken already consumed):**

Atlassian issues a new `refresh_token` on every successful token rotation. If the server process crashed between the Atlassian token endpoint returning HTTP 200 and the SQLite write completing, the old `refreshToken` is consumed but the new one is not stored. The result is a permanent `HTTP 400` from the token endpoint.

Resolution: re-authorise the connection from scratch. There is no way to recover a consumed refresh token without a new authorization grant.

---

### 8.4 JSM-Site Detection

#### Symptoms

- After a backup run, some projects are missing from the Inventory sidebar counts.
- The backup manifest JSON in `backup_manifests` contains a non-empty `jsmDeferredProjects` array.
- Server log contains `[discover] jsm-deferred projectKey=<KEY>` lines.
- The operator UI may show an out-of-scope notice when a `service_desk` project type was detected during onboarding.

#### Log patterns

```bash
# JSM-deferred projects during discovery
grep '\[discover\] jsm-deferred' server.log

# Example matching output:
# [discover] jsm-deferred projectKey=HD projectId=10001
# [discover] jsm-deferred projectKey=IT projectId=10042

# All project-discovery page events (see total vs included counts)
grep '\[discover\] phase=project' server.log
```

#### What happens to JSM projects

The detection logic lives in `src/workload/backup/discoverProjects.ts:partitionJsmProjects()`. Any project where `projectTypeKey === 'service_desk'` is:

1. Added to `jsmDeferredProjects` in the backup manifest with `reason: 'PHASE_2_DEFERRED'`.
2. Excluded from all backup phases (no issues, boards, or sprints captured).
3. Excluded from inventory sidebar counts and `GET /api/inventory` responses.

This is by design — JSM (Jira Service Management) objects are a Phase 2 deliverable per T1 §1, T2 §6 Constraint 11, and T3 §3.2. **These projects are not backed up in Phase 1.**

#### Inspecting the deferred list

```bash
# Query the backup_manifests table directly
sqlite3 data/jira_workload.db \
  "SELECT id, createdAt FROM backup_manifests ORDER BY createdAt DESC LIMIT 5;"

# Inspect the manifest JSON for a specific backup point
sqlite3 data/jira_workload.db \
  "SELECT json_extract(manifestJson, '$.jsmDeferredProjects') FROM backup_manifests
   WHERE id = '<id>';" | python3 -m json.tool
```

The `jsmDeferredProjects` array entries look like:
```json
{
  "projectId": "10001",
  "projectKey": "HD",
  "projectName": "Help Desk",
  "reason": "PHASE_2_DEFERRED"
}
```

#### Operator messaging

When a `service_desk` project is detected during the initial backup discovery, the onboarding wizard surfaces an out-of-scope notice. This is expected behaviour, not an error. The project will be skipped silently on all subsequent backup runs.

#### Resolution

There is no Phase 1 resolution. JSM/Service Desk projects are deferred to Phase 2 by design. If a site contains only JSM projects, the backup will complete successfully with `jsmDeferredProjects` populated and zero issues captured.

**Phase 2 — not yet shipped:** Full JSM backup coverage (JSMTicket, JSMQueue, JSMRequestType, JSMSLA) is tracked in the Phase 2 backlog per T1 §1 and T7 OQ-3.

---

### 8.5 Log tag reference

All structured log lines emitted by this workload follow the `[tag] key=value ...` pattern:

| Tag | Source file | When emitted |
|-----|-------------|--------------|
| `[search]` | `src/workload/http/JiraHttpClient.ts:enumerateIssues` | Every `POST /rest/api/3/search/jql` page |
| `[field-context]` | `src/workload/backup/discoverFieldContexts.ts` | Each field: `skip` for system fields, `fetch` for custom fields |
| `[permission-probe]` | `src/probes/permissionProbes.ts` and `src/workload/restore/boardScopeRecheck.ts` | Probe run or board-scope re-check |
| `[jql-validate]` | `src/routes/policies.ts` | Every `POST /api/policies` with a `jqlFilter` |
| `[restore]` | `src/workload/restore/RestoreOrchestrator.ts` and `src/workload/restore/trashDetectionGuard.ts` | Phase start, complete, fail, and guard results |
| `[auth-refresh]` | `src/workload/http/JiraHttpClient.ts:_refresh` | Mutex acquire, outcome, and release on every token rotation |
| `[rate-limit]` | `src/workload/http/JiraHttpClient.ts:_retryWithBackoff` | Every 429 retry attempt before `RateLimitedError` is thrown |
| `[discover]` | `src/workload/backup/discoverProjects.ts` | Project discovery pages and JSM deferrals |
