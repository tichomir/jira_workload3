# Jira Cloud Workload — Phase 1

Automated daily backup and point-in-time restore for Jira Cloud Issues, Projects, Boards, Sprints, Workflows, Custom Fields, and Attachments via Atlassian OAuth 2.0 (3LO).

## Quick links

| Document | Purpose |
|---|---|
| [INSTALL.md](INSTALL.md) | Prerequisites, environment setup, and start instructions |
| [DEMO.md](DEMO.md) | Connect Jira Site walkthrough and machine-readable smoke probes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Platform/workload boundary, interface contract, design constraints |
| [CHANGELOG.md](CHANGELOG.md) | Sprint-by-sprint release notes |

## What is built (Sprint 3)

- **OAuth 2.0 (3LO)** authorization code flow with PKCE — full Phase 1 scope set
- **Rotating-refresh-token HTTP client** (`JiraHttpClient`) with single-flight mutex
- **Permission-validation probes** for `/rest/api/3/myself`, `/rest/api/3/field`, `/rest/agile/1.0/board`, `/rest/api/3/workflow/search`
- **Connections UI** — WorkloadCard with Authorize button, ConnectionsList showing siteName per site
- **Platform Stub** — `POST /api/connections`, `GET /api/connections`, OAuth authorize/callback endpoints

## Phase 1 object coverage

Issues · Projects · Boards · Sprints · Workflows · Custom Fields · Attachments

JSM objects, Audit Logs, incremental backup, cross-site restore, and GFS retention are Phase 2.
