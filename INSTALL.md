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

### HTTPS callback requirement

Atlassian's OAuth 2.0 (3LO) flow requires a registered redirect URI. For local
development the redirect URI must be served over HTTPS. The recommended setup is
Caddy as a local TLS terminator:

1. Install [Caddy](https://caddyserver.com/docs/install).
2. Create a `Caddyfile` in a directory of your choice:

```
localhost {
    reverse_proxy /api/* localhost:3000
    reverse_proxy /* localhost:5173
}
```

3. Run `caddy run` from that directory. Caddy provisions a locally-trusted TLS
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
