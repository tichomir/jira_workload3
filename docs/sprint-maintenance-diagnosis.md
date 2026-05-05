# Sprint Maintenance — README/INSTALL Happy-Path Diagnosis

_Generated: 2026-05-05 | Role: Software Architect | Sprint: Maintenance — README/INSTALL happy-path repair_

## Environment

- Node.js: v20.20.2
- npm: 10.8.2
- Working directory: `/home/runner/coding/jira_workload_3`
- Latest commit: `a722014 [Sprint Maintenance — Restore podman-compose runtime]`

## Methodology

Followed README.md (Quick Start) and INSTALL.md (§1–§5a) exactly as a new contributor would. Commands run verbatim from the docs. Exit codes and HTTP responses recorded.

---

## Build and Test Commands — Results

| Command | Documented outcome | Actual outcome | Exit code |
|---|---|---|---|
| `npm install` | Install dependencies | Succeeds (node_modules populated) | 0 |
| `npm run build` | Compile TypeScript + Vite bundle | Succeeds; outputs `dist/index.html` + `dist/assets/` | **0** |
| `npm run server` | API server on `http://localhost:4000` | Server starts, listens on 4000 | 0 |
| `curl -sf http://localhost:4000/health` | `{"status":"ok"}` | `{"status":"ok"}` — HTTP 200 ✅ | — |
| `npm test` (= `vitest run`) | Test suite passes | **533 tests passed, 32 test files** | **0** |

---

## GUI URL Tests

| URL | Expected per docs | Actual | Notes |
|---|---|---|---|
| `http://localhost:4000/` | (not stated in README Quick Start) | **HTTP 404** — Express "Cannot GET /" error page | Express serves no static files |
| `http://localhost:5173/` | GUI (per INSTALL.md §4 alternative path) | **HTTP 000 — Connection refused** | Vite dev server not running |
| `https://localhost` | GUI (per INSTALL.md §4 primary/Caddy path, start.sh) | Not tested (Caddy not installed in env) | See Issue #4 below |

---

## Divergence Inventory

### Issue 1 — CRITICAL: Express server does not serve the built frontend

| Field | Value |
|---|---|
| **Doc + location** | README.md Quick Start: `npm run build` then `npm run server` implies the app is accessible |
| **Actual codebase state** | `src/server.ts` has no `express.static` or `sendFile` middleware. `dist/index.html` is never served. `http://localhost:4000/` returns HTTP 404 |
| **Root cause** | `src/server.ts` (all 35 lines) only mounts API routes and `/health`. There is no `app.use(express.static(path.join(distDir)))` or `app.get('*', ...)` fallback to serve the Vite-built SPA |
| **Impact** | A new contributor following the README Quick Start (`npm install && npm run build && npm run server`) ends up with a running API server but no GUI reachable at port 4000. The only documented path is the API health check. |
| **Proposed minimal fix** | In `src/server.ts`, after all API route mounts, add: `app.use(express.static(path.join(__dirname, '../dist')));` and a catch-all `app.get('*', ...)` that serves `dist/index.html` for React Router client-side routes. This makes `http://localhost:4000/` return the SPA after `npm run build`. |
| **Owning role** | Backend Developer |

---

### Issue 2 — CRITICAL: `vite.config.ts` proxy target points to wrong port (committed state)

| Field | Value |
|---|---|
| **Doc + location** | INSTALL.md §4 Alternative: `npm run dev` then navigate to `http://localhost:5173` |
| **Actual codebase state** | Committed `vite.config.ts` has `target: 'http://localhost:3000'` for the `/api` proxy. The API server runs on port 4000. Working tree has an uncommitted fix to 4000 (not yet committed). |
| **Root cause** | The Vite dev-server proxy configuration (`vite.config.ts` line 10) was never updated from the initial port 3000 placeholder to the project's actual port 4000. On a clean `git clone`, every `/api/*` request from the Vite frontend would silently fail (ECONNREFUSED on port 3000). |
| **Impact** | On a clean checkout: `npm run dev` starts the Vite server at 5173, the page loads, but all API calls (connections list, inventory, policies) fail because the proxy routes to port 3000 instead of 4000. The app appears to load but is completely non-functional. |
| **Proposed minimal fix** | Change `target: 'http://localhost:3000'` → `target: 'http://localhost:4000'` in `vite.config.ts` and commit. (This fix already exists in the working tree as an unstaged change.) |
| **Owning role** | Frontend Developer / DevOps |

---

### Issue 3 — HIGH: `Caddyfile.compose` missing frontend route

| Field | Value |
|---|---|
| **Doc + location** | INSTALL.md §4 Primary path: `./start.sh` then "Open: https://localhost" |
| **Actual codebase state** | `Caddyfile.compose` contains only `reverse_proxy /api/* app:4000`. There is no route serving the frontend (`/*`). Compare with `Caddyfile` (local dev, non-compose) which has both `reverse_proxy /api/* localhost:4000` AND `reverse_proxy /* localhost:5173`. |
| **Root cause** | When `Caddyfile.compose` was authored for the compose stack, the frontend route was omitted. The compose stack's `app` container runs `npm run server` (API only, no Vite dev server), and no `/*` proxy target was added. The frontend in `dist/` is also not served (Issue #1). |
| **Impact** | With podman-compose running, navigating to `https://localhost` returns a Caddy 502/empty response for non-API paths. Only `/api/*` routes work. The GUI is completely inaccessible via the compose stack. |
| **Proposed minimal fix** | After fixing Issue #1 (static serving in server.ts), add `reverse_proxy /* app:4000` to `Caddyfile.compose` so that all non-API paths are served by the Express static middleware. Alternatively, the compose Dockerfile could run `npm run build` and the Express static fix makes it self-contained. |
| **Owning role** | DevOps Engineer |

---

### Issue 4 — MEDIUM: `podman-compose.yml` Caddy port mismatch (unstaged working-tree change)

| Field | Value |
|---|---|
| **Doc + location** | INSTALL.md §4: `./start.sh` → "Open: https://localhost"; `podman-compose.yml` caddy service ports |
| **Actual codebase state** | Working tree (unstaged) has changed Caddy ports from `80:80` / `443:443` (committed) to `8080:8080` / `8443:8443`. `Caddyfile.compose` uses `localhost {}` which binds Caddy to port 443 by default. With the 8080/8443 mapping, Caddy's port 443 inside the container is not exposed; `https://localhost` on the host is unreachable. |
| **Root cause** | An unstaged modification changed the Caddy port exposure from standard 80/443 to 8080/8443, breaking alignment with the Caddyfile `localhost {}` block (which binds 443). `start.sh` still prints "Open: https://localhost" (port 443), which is now unreachable. |
| **Impact** | `./start.sh` reports the stack healthy (it polls `http://localhost:4000/health`, not Caddy), then tells the user to open `https://localhost` — which refuses connection. |
| **Proposed minimal fix** | Revert `podman-compose.yml` to the committed state (`80:80` / `443:443`). Alternatively, if non-root port binding is required, update `Caddyfile.compose` to explicitly bind to `:8080` (HTTP) and `:8443` (HTTPS) and update `start.sh` URL accordingly. |
| **Owning role** | DevOps Engineer |

---

### Issue 5 — DOCUMENTATION: README Quick Start does not state where to access the GUI

| Field | Value |
|---|---|
| **Doc + location** | README.md lines 8–12: Quick Start block |
| **Actual codebase state** | The Quick Start shows `npm run server # API server on http://localhost:4000` but never states a URL for the GUI. The only URL shown is for the health check (`curl -sf http://localhost:4000/health`). |
| **Root cause** | The Quick Start was written for the API-server path only. The GUI URL was documented only in INSTALL.md §4. A new contributor stopping at README would not know where to open the app. |
| **Impact** | New contributors following only README.md cannot find the GUI. After Issue #1 is fixed and static serving is added, `http://localhost:4000` will serve the GUI; this should be stated in the Quick Start. |
| **Proposed minimal fix** | Add one line to the README Quick Start after `npm run server`: `# Open http://localhost:4000 in your browser for the GUI`. |
| **Owning role** | DevOps / Frontend |

---

## Dependency Map

The issues form a dependency chain:

```
Issue #1 (server.ts static serving)
    └─► Issue #3 (Caddyfile.compose /* route) — fix #3 depends on #1 being done first
    └─► Issue #5 (README GUI URL) — update README URL after #1 is confirmed

Issue #2 (vite.config.ts port) — independent, commit the unstaged fix

Issue #4 (podman-compose ports) — independent, revert unstaged change
```

---

## Prioritised Fix List

| Priority | Issue | Owner | Effort |
|---|---|---|---|
| P0 | Issue #1: Add `express.static('dist')` + catch-all SPA route to `src/server.ts` | Backend Developer | ~15 min |
| P0 | Issue #2: Commit `vite.config.ts` proxy fix (port 3000 → 4000) | Frontend/DevOps | ~2 min |
| P1 | Issue #4: Revert `podman-compose.yml` Caddy ports to 80:80 / 443:443 | DevOps | ~2 min |
| P1 | Issue #3: Add `reverse_proxy /* app:4000` to `Caddyfile.compose` | DevOps | ~5 min |
| P2 | Issue #5: Add GUI URL to README Quick Start | DevOps | ~2 min |

---

## No-Change Confirmation

No source files, config files, or documentation were modified by this diagnosis task. All commands were read-only or spawned subprocesses killed after measurement.
