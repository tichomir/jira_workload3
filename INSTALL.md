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
| `ATLASSIAN_CLIENT_SECRET` | OAuth app Client Secret |
| `OAUTH_REDIRECT_URI` | Callback URL registered in the Atlassian developer console |
| `PORT` | API server port (default `4000`) |
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

The engineer-facing runbook for diagnosing and recovering from Phase 1 failure modes is at
**[`docs/OPERATIONS.md`](docs/OPERATIONS.md)**.

It covers four failure modes, each with Symptoms → Diagnostic log greps → Resolution steps:

| Section | Failure mode |
|---|---|
| §1 | Connection failure (403 probe, missing credentials) |
| §2 | Scope drift (missing OAuth scopes post-token rotation) |
| §3 | Refresh-token rotation failure (mutex-stuck, credential-table recovery) |
| §4 | JSM-site detection (PHASE_2_DEFERRED projects, exclusion from inventory counts) |
