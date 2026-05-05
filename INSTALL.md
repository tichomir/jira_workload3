# Installation

## Prerequisites

| Requirement | Minimum version |
|---|---|
| Node.js | 20 LTS |
| npm | 10 |
| Python 3 | 3.9 (smoke probes only) |
| curl | any recent version |

## 1. Clone and install dependencies

```bash
git clone <repo-url> jira-workload
cd jira-workload
npm install
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
| `PORT` | API server port (default `3000`) |
| `DCC_ATTACHMENT_DIR` | _(optional)_ Override directory for attachment binary storage (default: `data/attachments`). Set to an absolute path to redirect storage to an external volume, e.g. `/mnt/backup-volume/attachments`. |

### HTTPS callback requirement

Atlassian's OAuth 2.0 (3LO) flow requires a registered redirect URI. For local
development the redirect URI must be served over HTTPS. The recommended setup is
Caddy as a local TLS terminator:

1. Install [Caddy](https://caddyserver.com/docs/install).
2. A `Caddyfile` is included in the project root with the correct configuration:

```
localhost {
    reverse_proxy /api/* localhost:3000
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

### Option A — two terminals (plain npm)

Terminal 1: API server

```bash
npm run server
```

Terminal 2: Vite dev server (UI)

```bash
npm run dev
```

Navigate to `https://localhost` (if using Caddy) or `http://localhost:5173` (plain Vite).

### Option B — podman-compose (API + Caddy)

If you have `podman-compose` (or `docker compose`) available you can start the API
server and a Caddy sidecar with a single command. Create a compose file
containing at minimum an `api` service running `npm run server` and a `caddy`
service using the official Caddy image. Then:

```bash
podman-compose up -d      # start in background
podman-compose logs -f    # follow logs
podman-compose down       # stop
```

The Vite dev server is not included in the compose stack — run `npm run dev` in a
separate terminal as usual.

## 5. Verify the server is running

```bash
curl -sf http://localhost:${PORT:-3000}/api/connections | python3 -m json.tool
```

An empty JSON array `[]` confirms the server is healthy and the database is
initialised.

## 6. API surface

All endpoints are served by the Express API server (`npm run server`) on
`http://localhost:${PORT}` (default 3000).

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
