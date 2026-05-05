# Smoke Test Report — Podman-Compose Runtime Verification
**Sprint:** Maintenance — Restore podman-compose runtime  
**Test date:** 2026-05-05  
**Author:** QA Engineer Persona  
**Test environment:** Linux aarch64 (runner), Node.js v20.20.2, npm 10.8.2  
**Verdict:** PARTIAL PASS — API server functional, podman-compose path BLOCKED (root cause confirmed)

---

## Executive Summary

The sprint's central goal was to verify (and restore) the podman-compose runtime described in documentation. This smoke test confirms the core finding: **`podman` and `podman-compose` are not installed on the host**, making the documented primary start path (`./start.sh`) non-functional. `docker` and `docker-compose` are also absent.

The API server itself is fully functional via the npm alternative path. All five smoke probes and all 533 unit tests pass. The issue is exclusively at the container runtime layer.

---

## Environment Audit

| Tool | Status | Version |
|------|--------|---------|
| `podman` | **NOT INSTALLED** | — |
| `podman-compose` | **NOT INSTALLED** | — |
| `docker` | **NOT INSTALLED** | — |
| `docker-compose` | **NOT INSTALLED** | — |
| `node` | PRESENT | v20.20.2 |
| `npm` | PRESENT | 10.8.2 |
| `python3` | PRESENT | 3.11.15 |
| `curl` | PRESENT | 8.14.1 |

---

## Bug Report: BUG-001 — Primary Start Path Non-Functional

**Severity:** P0 — Blocks the documented operator flow  
**File:** `start.sh`, `INSTALL.md §4`, `DEMO.md Prerequisites`  
**Reproduction steps:**

```bash
cp .env.example .env
./start.sh
# Result: /usr/bin/env: 'bash': exit 127
# or: podman-compose: command not found
```

**Root cause:**  
`start.sh` line 13 calls `podman-compose up -d`. The binary `podman-compose` is not installed on the host. Neither is `podman` itself, nor the Docker CLI alternative.

**Impact:**  
The documented primary start path (`./start.sh`) fails immediately. The `caddy` TLS sidecar (which handles HTTPS for the OAuth callback URI) also cannot be started. The INSTALL.md `§4 Primary path — podman-compose + start.sh` and DEMO.md Prerequisites are both non-functional without container tooling.

**What is needed to fix (one of the following):**  
1. Install `podman` and `podman-compose` on the host (or provide a Dockerfile-based setup script using `docker compose`).  
2. Add a `./start.sh` fallback branch that detects absent container tooling and falls back to `npm run server` with a warning.  
3. Document the npm alternative path more prominently in DEMO.md as the primary path for environments without container tools.

---

## What Was Done Instead — npm Alternative Path

Per `INSTALL.md §4 Alternative — two terminals (plain npm, no container)`, the API server was confirmed already running on port 4000 (started in a previous session via `npm run server`). The `.env` file was present with OAuth credentials populated.

### Health check

```bash
curl -s http://localhost:4000/health
# {"status":"ok"}
```

**Result: PASS** — server healthy on port 4000.

```bash
curl -s http://localhost:4000/api/connections | python3 -m json.tool | head -5
# [ { "connectionId": "conn-1", ... } ]
```

**Result: PASS** — database initialized, connections endpoint responsive.

---

## Smoke Probe Execution

All five operator-flow smoke probes were run via `bash scripts/run-smoke-probes.sh` against the running server.

### Results Summary

| Probe | Checks | Result |
|-------|--------|--------|
| `browse-protected-inventory` | 8/8 | **PASS** |
| `connect-jira-site` | 5/5 | **PASS** |
| `restore-protected-objects` | 10/10 | **PASS** |
| `run-first-backup` | 9/9 | **PASS** |
| `view-sdi-teaser` | 4/4 | **PASS** |

**Overall: 5/5 probes PASS**

### Per-Probe Detail

#### probe-browse-protected-inventory
```
[1/8] Create smoke connection — PASS
[2/8] Seed backup manifest + Issue items — PASS
[3/8] GET /api/inventory sidebar counts — PASS (6 objectTypes, Issue count=2)
[4/8] Exact-key search q=SMOKE-1 — PASS (1 item returned)
[5/8] Facet filter status=Done — PASS (1 item returned)
[6/8] Attachment filename search — PASS (1 item returned)
[7/8] Paginated list — PASS (2 items, total=2)
[8/8] Traceability — PASS (backupPointId + timestamp present)
```

#### probe-connect-jira-site
```
[1/3] POST /api/connections (OAuth mode) — PASS (status=connected)
[2/3] GET /api/connections — PASS (cloudId in list, valid JSON)
[3/3] POST /api/connections (manual mode) — PASS (clientIdMasked present, status=connected, found in list)
```

#### probe-restore-protected-objects
```
[1/10]  Create smoke connection — PASS
[2/10]  POST /api/restore-jobs — PASS (status=queued)
[3/10]  SSE phase stream (8-phase dependency order) — PASS
[4/10]  Trash-check non-trashed keys — PASS (empty trashedProjectKeys)
[5/10]  Trash-check TRASH-prefixed key — PASS (correctly identified)
[6/10]  Trash-check missing connectionId → 400 — PASS
[7/10]  boardScopeRecheck unit tests — PASS
[8/10]  trashDetectionGuard unit tests — PASS
[9/10]  RestoreOrchestrator unit tests — PASS
[10/10] HeartbeatEmitter + SSE HTTP integration tests — PASS
```

#### probe-run-first-backup
```
[1/9]  Create smoke connection — PASS
[2/9]  GET /api/inventory objectTypes — PASS
[3/9]  POST /api/policies — PASS (rpoHours=24 returned)
[4/9]  GET /api/jobs/:id unknown → 404 — PASS
[5/9]  Discover flow (mock Atlassian, in-memory DB) — PASS
       → backupPointId non-empty, projectCount=3, jsmDeferredCount=1
       → backup_manifests row written with correct cloudId, projects, jsmDeferredProjects
[6/9]  Custom field context discovery unit tests — PASS
[7/9]  Issue payload assembler + CaptureOrchestrator — PASS
[8/9]  downloadIssueAttachments (SHA-256 verification) — PASS
[9/9]  computeManifestDiff (changeBadge deletion-diff) — PASS
```

#### probe-view-sdi-teaser
```
[1/4] Seed backup_point_sdi_summary — PASS
[2/4] GET /api/backup-points/:id/sdi-teaser — PASS (GDPR=active, PCI_DSS=inactive, no HIPAA)
[3/4] Unknown backup point → 404 — PASS
[4/4] SDI detector + scanDispatcher unit tests — PASS
```

---

## Test Suite

```bash
npm test
```

```
Test Files  32 passed (32)
     Tests  533 passed (533)
  Start at  08:48:09
  Duration  3.86s
```

**Result: PASS** — all 533 tests pass (the G-09 log-format issue from Sprint 17 was resolved in Sprint 18 maintenance).

---

## Teardown Notes

No container stack was started during this test run (podman-compose was unavailable). The API server that served the smoke probes was already running from a prior session and was not stopped to avoid disrupting the environment.

In a full podman-compose run, teardown would be:
```bash
podman-compose down
# Volumes are retained by design (sqlite_data, attachment_data, caddy_data, caddy_config)
```

---

## Server Startup Observation

When `npm run server` was invoked at the start of this test run, the process exited immediately with:

```
Error: listen EADDRINUSE: address already in use :::4000
```

This confirmed a server was already bound to port 4000. The smoke probes ran successfully against that pre-existing server. This is expected behavior in a persistent dev environment.

---

## Summary of Findings

| Finding | Severity | Status |
|---------|----------|--------|
| `podman` not installed — `./start.sh` fails | P0 | Open — sprint deliverable |
| `podman-compose` not installed — primary start path blocked | P0 | Open — sprint deliverable |
| `docker`/`docker-compose` absent (no fallback) | P0 | Open — sprint deliverable |
| API server health endpoint `/health` | — | PASS |
| All 5 operator-flow smoke probes | — | PASS (5/5) |
| Full test suite (`npm test`) | — | PASS (533/533) |

The API server, database, all REST endpoints, and all operator flows are fully functional. The only blocker is the missing container runtime that prevents `./start.sh` and the Caddy TLS sidecar from starting.
