# Jira Cloud Workload — Phase 1

Automated daily backup and point-in-time restore for Jira Cloud Issues, Projects, Boards, Sprints, Workflows, Custom Fields, and Attachments via Atlassian OAuth 2.0 (3LO).

## Quick links

| Document | Purpose |
|---|---|
| [INSTALL.md](INSTALL.md) | Prerequisites, environment setup, and start instructions |
| [DEMO.md](DEMO.md) | Connect Jira Site walkthrough and machine-readable smoke probes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Platform/workload boundary, interface contract, design constraints |
| [CHANGELOG.md](CHANGELOG.md) | Sprint-by-sprint release notes |

## What is built

### Phase 2 Sprint 2 — Issue Enumeration, Custom Field Context & Capture Order
- **Custom field context discovery** — `GET /rest/api/3/field/{id}/context` called only for `custom: true` fields; system fields emit `[field-context] skip` log lines (T2 §6 Constraint 7)
- **Issue payload assembler** — captures all system + custom field values, ADF comments, issue links (both directions), subtasks, sprint membership, watchers, worklogs, and attachment refs (T3 §3.3 coverage invariant)
- **Capture orchestrator** (`CaptureOrchestrator`) — executes phases in dependency order: CustomField → Project → Issue; coverage invariant violation throws a named diagnostic and increments `errorCount`
- **`JiraWorkload.snapshot()`** — wires orchestrator into `PlatformWorkloadInterface`, persists full `BackupManifest` including `coverageInvariant` block to `backup_manifests`
- **Issue enumeration** — `POST /rest/api/3/search/jql` exclusively; pagination terminates on `issues.length === 0 || issues.length < maxResults`; deprecated `GET /rest/api/3/search` is forbidden and enforced by `scripts/check-http-guard.sh`

### Phase 2 Sprint 1 — Backup Engine Foundations
- **Project discovery** — paginated `GET /rest/api/3/project/search` honoring `projectScope` (`all` / `selected`)
- **JSM detection** — `service_desk` projects flagged `PHASE_2_DEFERRED` in manifest, excluded from all backup phases
- **`JiraWorkload.discover()`** — persists `BackupManifest` with `projects` + `jsmDeferredProjects` to `backup_manifests` table via `POST /api/discover`
- **Backup engine HTTP client** (`src/workload/http/JiraHttpClient.ts`) — rotating-refresh-token mutex, `enumerateIssues`, `downloadAttachment`, `getPaginated` helpers

### Phase 1 Sprint 3 — OAuth 3LO Foundation
- **OAuth 2.0 (3LO)** authorization code flow with PKCE — full Phase 1 scope set
- **Rotating-refresh-token HTTP client** (`JiraHttpClient`) with single-flight mutex
- **Permission-validation probes** for `/rest/api/3/myself`, `/rest/api/3/field`, `/rest/agile/1.0/board`, `/rest/api/3/workflow/search`
- **Connections UI** — WorkloadCard with Authorize button, ConnectionsList showing siteName per site
- **Platform Stub** — `POST /api/connections`, `GET /api/connections`, OAuth authorize/callback endpoints

### Phase 1 Sprint 2 — Platform Stub Endpoints
- **Manual Connection path** — `POST /api/connections` with `mode: "manual"`, `clientId`/`clientSecret`, returns `clientIdMasked`
- **Inventory endpoint** — `GET /api/inventory?connectionId=<id>` returning `{ manifestId, completedAt, counts }`
- **Policies endpoint** — `POST /api/policies` creating backup policy with `projectScope` and `retentionDays`
- **Restore endpoints** — `POST /api/restores` (enqueue job), `GET /api/restores/:id` (poll status), `GET /api/restores/:id/events` (SSE stream)
- **Caddyfile** — local HTTPS reverse-proxy for OAuth callback registration

## Phase 1 object coverage

Issues · Projects · Boards · Sprints · Workflows · Custom Fields · Attachments

JSM objects, Audit Logs, incremental backup, cross-site restore, and GFS retention are Phase 2.
