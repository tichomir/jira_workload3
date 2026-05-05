# JIRA_WORKLOAD_3 — Project Intelligence

_Auto-maintained by PersonaForge. Updated at sprint start, after every role checkpoint, and at sprint end._
_Read this file BEFORE `.persona-snapshot.md` and BEFORE any exploration._
_It tells you what has been built, in what order, and key decisions made._

## Project Context

Executive Summary
Jira Cloud is Atlassian's multi-tenant SaaS issue-tracking platform, hosted on AWS, serving software delivery, IT, and business project teams. Atlassian's Shared Responsibility Model explicitly excludes customer-initiated destructive changes from infrastructure backup recovery — deleted Issues are permanently destroyed with no native undo, and deleted Projects enter a 60-day trash window after which all contained data is irrecoverable (T1 §2). This workload delivers automated daily backup and granular point-in-time restore for the Phase 1 object set — Issues, Projects, Boards, Sprints, Workflows, Custom Fields, and Attachments — via Atlassian's OAuth 2.0 (3LO) surface, reusing the auth architecture established in the Confluence Cloud pilot. The Phase 1 contract is: every Issue's system and custom field values round-trip completely (the coverage invariant), restore dependency ordering is enforced automatically (Project → Workflow + WorkflowScheme → CustomField + FieldConfiguration → Board → Sprint → Issue), and Sensitive Data Intelligence scanning surfaces GDPR and PCI DSS exposure without operator intervention.

2. Goals
Goal: The DCC connector authenticates to a Jira Cloud site via OAuth 2.0 (3LO) using the scope set defined in T2 §4.2.2. The authorizing account holds Site Admin or Atlassian Organization Admin role. On completion, GET https://api.atlassian.com/me returns HTTP 200 with a valid accountId and the connection credential store contains a non-null accessToken and refreshToken. Source: T2 §4.2, §4.5.

Goal: The backup connector discovers all Projects on the connected Jira Cloud site via paginated GET /rest/api/3/project/search, scoped by the "Project scope" configuration field (All projects / Selected projects). Discovery completes with zero silent omissions — every project returned by the API is represented in the backup point manifest. Source: T3 §4.3, T4 §6.

Goal: Every Issue backed up captures all properties defined in T3 §3.3 for the Issue object type: system fields, all custom field values (customFieldValues map, no field skipped), all comments (ADF body + author + timestamps), all issue links (all link types, both directions), subtask references, sprint membership, attachment references, watchers, and worklogs. This is the primary coverage invariant. Source: T3 §3.5.

Goal: Attachments are stored binary-faithful — byte-for-byte, original MIME type, original filename, no transcoding or recompression — via GET /rest/api/3/attachment/content/{id} through the canonical authenticated HTTP client. Source: T3 §3.2, §4.4.

Goal: The backup engine enforces the restore dependency capture order: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue. Context node capture is always performed before Protected Object capture in every backup job. Source: T1 §1, T3 §3.4.

Goal: The restore engine enforces the write dependency order: Project → Workflow + WorkflowScheme → CustomField + FieldConfiguration → Board → Sprint → Issue body → issue links + comments + attachments (post-issue-creation pass). A failure in any phase halts execution and surfaces a named diagnostic before the next phase begins. Source: T1 §1, T2 §6 Constraint 8, T5 §5.2.

Goal: The canonical authenticated HTTP client handles rotating refresh tokens atomically: on every POST https://auth.atlassian.com/oauth/token refresh, both the new access_token and new refresh_token are written to the credential store before the mutex is released. Concurrent refresh requests queue behind a single in-flight refresh. Source: T2 §4.5, §6 Constraint 4.

Goal: The search endpoint used for all Issue discovery and backup is POST /rest/api/3/search/jql. The deprecated GET /rest/api/3/search endpoint is not used anywhere in the codebase. Pagination terminates on issues.length === 0 or issues.length < maxResults. Source: T2 §4.5, §6 Constraint 6.

Goal: Custom field context discovery calls GET /rest/api/3/field/{id}/context only for fields where custom: true. System fields (custom: false) are never passed to the context endpoint. Source: T2 §6 Constraint 7, T3 §4.2.

Goal: The SDI teaser scanner detects email addresses, API keys / secret tokens, credit card numbers, and phone numbers across entities.xml, tabular exports (.csv, .xlsx, .tsv), developer configuration attachments (.env, .yaml, .yml, .json, .toml, .properties, .config), and text/log attachments (.txt, .log, .md). On detection of email or phone data, the GDPR regulation tag activates. On detection of credit card data, the PCI DSS regulation tag activates. Source: T7 §2, §3, §4.

Goal: The Protected Object Inventory view sidebar renders four object types — Issues (JiraIssue), Projects (JiraProject), Boards (JiraBoard), Sprints (JiraSprint) — with Issues as the default selection. Each sidebar row shows a count of discovered objects from the most recent backup point manifest. Source: T8 §2, §3.

Goal: The restore wizard supports three conflict modes (Override, Skip, Ask per conflict) with Skip as the default. Destination options are Original location, Alternate location (same Jira site), and Export/Browser Download. Cross-site and Cross-tenant restore are not supported in Phase 1. Source: T5 §5.1, §5.2.

Goal: Backup and restore jobs each emit a progress event every ≤10 seconds. A job with no heartbeat for >20 seconds surfaces a "stalled" alert in the UI. A backup that completes with per-item errors displays "Completed with N errors" — not "Completed successfully." Each backed-up item is traceable to a backup-point ID and timestamp via a single UI click. Source: T5 §6.2, §6.2b.

3. Non-Goals
The following are explicitly deferred to Phase 2 or out of scope for engineering entirely.

Deferred to Phase 2:

Jira Service Management (JSM) objects — JSMTicket, JSMQueue, JSMRequestType, JSMSLAM. Not in scope even for sites whose project type is service_desk; JSM-specific metadata is excluded from Phase 1 backup and restore. The onboarding wizard surfaces an out-of-scope notice when service_desk project type is detected. (T1 §1, T2 §6 Constraint 11, T3 §3.2)
Audit Log backup — AuditLog node type; requires read:audit-log:jira or coverage under manage:jira-configuration, pending Engineering confirmation (T6 OQ-2). (T1 §1, T3 §3.2, T6 §2)
Cross-site restore — restoring a backup from Site A (cloudId A) to Site B (cloudId B). Atlassian accountIds and custom field IDs are site-scoped and not portable without remapping tables. (T2 OQ-3, T5 §5.2)
Incremental backup — the Phase 1 model is a full-snapshot daily backup. Incremental via updated >= {lastBackupTimestamp} is a Phase 2 performance optimisation. (T3 §4.3)
Custom backup window — backup timing is platform-managed. No per-workload schedule exposure in Phase 1. (T4 §3)
GFS (Grandfather-Father-Son) retention — flat RPO+Retention (Configuration A) is the Phase 1 model. GFS re-evaluation is gated on a named JSM-compliance customer requirement. (T4 §2)
Blob storage export destination — export destination in Phase 1 is Browser Download only. S3 / Azure Blob / GCS export is Phase 2. (T5 §5.2)
ADF media link rewriting post-attachment-restore — restored attachments receive new attachmentId values; ADF media node references in Issue descriptions and comments may break. Best-effort warning in restore report; full rewrite pass is Phase 2. (T5 OQ-5, §7 Constraint 10)
Merge conflict mode — no read-compare-write cycle; deferred given rate-limit constraints. (T5 §5.1)
Full JSM teaser profile — a separate T7 for JSM is Phase 2. (T7 OQ-3)
Restore from Atlassian's native project trash — Projects in the 60-day Atlassian-managed trash window are blocked for in-place restore and must use alternate-location restore; native trash integration is not in scope. (T5 §4.2)
SMB GTM motion — sub-50-seat customers are a Phase 2 target. (T1 §2)
Out of scope (not a Phase 2 item, not engineering scope):

Marketing copy, competitive matrices, BoM collateral, and sales enablement materials — covered by the PMM brief (out-pmm). Do not implement.
BYOS (Bring Your Own Storage) and attestation — out of scope per global agent rules.
DCC region selection — platform-level concern, not workload-specific. (T2 §5.1)
Compliance reset as a workload capability. (Global agent rules)

---

## Sprint History
### Sprint 3 — OAuth 3LO Foundation: HTTP Client, Probes & Connections UI | 2026-05-04 | ⏳ in progress | 31 SP est.
**Goal:** [Phase: Platform Stub & OAuth 3LO Connection — Sprint 1 of 2]
Stand up the Platform Stub serving T0 §2 endpoints, implement Atlassian OAuth 2.0 (3LO) authorization with the full Phase 1 scope set (including both write:board-scope:jira-software variants), and deliver the Connections workflow with permission-validation probes and rotating-refresh-token credential storage. This phase establishes the foundation that every subsequent flow exercises.

Deliverables (across all sprints in this phase):
- Platform Stub exposing all T0 §2 endpoints (POST /api/connections, GET /api/inventory, POST /api/policies, restore endpoints) for single-operator local dev
- Workload Card UI with value-prop and minimum-requirements copy plus Authorize button
- OAuth 2.0 Authorization Code (3LO) redirect flow with full T2 §4.2.2 scope string, including both write:board-scope:jira-software (plain) and write:board-scope.admin:jira-software
- Manual Connection path accepting masked Client ID + Client Secret
- Canonical authenticated HTTP client with atomic rotating-refresh-token handling, in-flight refresh mutex, and credential store
- Permission-validation probes for /rest/api/3/myself, /rest/api/3/field, /rest/agile/1.0/board, /rest/api/3/workflow/search with HTTP 403 remediation banners
- cloudId mismatch handling (409 on reauth) and multi-site connection support
- Connections list UI showing siteName per connected site

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 3 — OAuth 3LO Foundation: HTTP Client, Probes & Connections UI | 2026-05-04 | 📋 reviewing | 31 SP
**Goal:** [Phase: Platform Stub & OAuth 3LO Connection — Sprint 1 of 2]
Stand up the Platform Stub serving T0 §2 endpoints, implement Atlassian OAuth 2.0 (3LO) authorization with the full Phase 1 scope set (including both write:board-scope:jira-software variants), and deliver the Connections workflow with permission-validation probes and rotating-refresh-token credential storage. This phase establishes the foundation that every subsequent flow exercises.

Deliverables (across all sprints in this phase):
- Platform Stub exposing all T0 §2 endpoints (POST /api/connections, GET /api/inventory, POST /api/policies, restore endpoints) for single-operator local dev
- Workload Card UI with value-prop and minimum-requirements copy plus Authorize button
- OAuth 2.0 Authorization Code (3LO) redirect flow with full T2 §4.2.2 scope string, including both write:board-scope:jira-software (plain) and write:board-scope.admin:jira-software
- Manual Connection path accepting masked Client ID + Client Secret
- Canonical authenticated HTTP client with atomic rotating-refresh-token handling, in-flight refresh mutex, and credential store
- Permission-validation probes for /rest/api/3/myself, /rest/api/3/field, /rest/agile/1.0/board, /rest/api/3/workflow/search with HTTP 403 remediation banners
- cloudId mismatch handling (409 on reauth) and multi-site connection support
- Connections list UI showing siteName per connected site

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define PlatformWorkloadInterface and connection data contracts — Software Architect (◈ Standard, 3 SP)
- ✅ Implement SQLite schema and migration for connections + credentials — Backend Developer (⚡ Quick, 2 SP)
- ✅ Harden canonical JiraHttpClient with single-flight refresh mutex and atomic rotating-token write — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement OAuth 3LO authorize redirect with full Phase 1 scope string — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement OAuth 3LO callback — Backend Developer (⚡ Quick, 2 SP)
- ✅ token exchange — Backend Developer (⚡ Quick, 2 SP)
- ✅ cloudId resolution — Backend Developer (⚡ Quick, 1 SP)
- ✅ Implement four permission-validation probes with structured logging — Backend Developer (◈ Standard, 3 SP)
- ✅ Build Workload Card UI with Authorize button and minimum-requirements copy — Frontend Developer (◈ Standard, 3 SP)
- ✅ Build Connections list view with siteName, cloudId, status and 403 remediation banner — Frontend Developer (◈ Standard, 3 SP)
- ✅ Update INSTALL.md, DEMO.md, CHANGELOG.md for OAuth + Connections flow — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Doc grounding verification + connect-jira-site smoke probe execution — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 2 — Platform Stub Endpoints, Manual Connection & Doc Grounding | 2026-05-04 | ⏳ in progress | 21 SP est.
**Goal:** [Phase: Platform Stub & OAuth 3LO Connection — Sprint 2 of 2]
Stand up the Platform Stub serving T0 §2 endpoints, implement Atlassian OAuth 2.0 (3LO) authorization with the full Phase 1 scope set (including both write:board-scope:jira-software variants), and deliver the Connections workflow with permission-validation probes and rotating-refresh-token credential storage. This phase establishes the foundation that every subsequent flow exercises.

Deliverables (across all sprints in this phase):
- Platform Stub exposing all T0 §2 endpoints (POST /api/connections, GET /api/inventory, POST /api/policies, restore endpoints) for single-operator local dev
- Workload Card UI with value-prop and minimum-requirements copy plus Authorize button
- OAuth 2.0 Authorization Code (3LO) redirect flow with full T2 §4.2.2 scope string, including both write:board-scope:jira-software (plain) and write:board-scope.admin:jira-software
- Manual Connection path accepting masked Client ID + Client Secret
- Canonical authenticated HTTP client with atomic rotating-refresh-token handling, in-flight refresh mutex, and credential store
- Permission-validation probes for /rest/api/3/myself, /rest/api/3/field, /rest/agile/1.0/board, /rest/api/3/workflow/search with HTTP 403 remediation banners
- cloudId mismatch handling (409 on reauth) and multi-site connection support
- Connections list UI showing siteName per connected site

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 2 — Platform Stub Endpoints, Manual Connection & Doc Grounding | 2026-05-04 | 📋 reviewing | 21 SP
**Goal:** [Phase: Platform Stub & OAuth 3LO Connection — Sprint 2 of 2]
Stand up the Platform Stub serving T0 §2 endpoints, implement Atlassian OAuth 2.0 (3LO) authorization with the full Phase 1 scope set (including both write:board-scope:jira-software variants), and deliver the Connections workflow with permission-validation probes and rotating-refresh-token credential storage. This phase establishes the foundation that every subsequent flow exercises.

Deliverables (across all sprints in this phase):
- Platform Stub exposing all T0 §2 endpoints (POST /api/connections, GET /api/inventory, POST /api/policies, restore endpoints) for single-operator local dev
- Workload Card UI with value-prop and minimum-requirements copy plus Authorize button
- OAuth 2.0 Authorization Code (3LO) redirect flow with full T2 §4.2.2 scope string, including both write:board-scope:jira-software (plain) and write:board-scope.admin:jira-software
- Manual Connection path accepting masked Client ID + Client Secret
- Canonical authenticated HTTP client with atomic rotating-refresh-token handling, in-flight refresh mutex, and credential store
- Permission-validation probes for /rest/api/3/myself, /rest/api/3/field, /rest/agile/1.0/board, /rest/api/3/workflow/search with HTTP 403 remediation banners
- cloudId mismatch handling (409 on reauth) and multi-site connection support
- Connections list UI showing siteName per connected site

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define Platform Stub T0 §2 endpoint contracts and manual-connection schema — Software Architect (◈ Standard, 3 SP)
- ✅ Implement POST /api/connections and Manual Connection path — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement GET /api/inventory and POST /api/policies stub endpoints — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement restore endpoints (stub) per T0 §2 — Backend Developer (◈ Standard, 3 SP)
- ✅ Build Manual Connection UI form with masked credential input — Frontend Developer (◈ Standard, 3 SP)
- ✅ Fix carried-forward doc-grounding P0s in INSTALL.md and DEMO.md — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update DEMO.md with Manual Connection flow and stub-endpoint smoke probes — Frontend Developer (⚡ Quick, 2 SP)
- ✅ QA: doc-grounding verification + stub-endpoint smoke probe execution — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 1 — Phase 2: Backup Engine Foundations (HTTP Client, Project Discovery, JSM Detection) | 2026-05-04 | ⏳ in progress | 25 SP est.
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 1 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 1 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 1 — Phase 2: Backup Engine Foundations (HTTP Client, Project Discovery, JSM Detection) | 2026-05-04 | 📋 reviewing | 25 SP
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 1 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 1 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define backup-engine module boundaries and capture-order orchestrator contract — Software Architect (◈ Standard, 3 SP)
- ✅ Implement canonical JiraHttpClient with rotating-refresh-token mutex — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement Project discovery via paginated GET /rest/api/3/project/search — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement JSM project detection and PHASE_2_DEFERRED manifest flagging — Backend Developer (⚡ Quick, 2 SP)
- ✅ Wire Discover operation into PlatformWorkloadInterface and persist manifest — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement Workload Card UI with Authorize button (carry-forward P0) — Frontend Developer (◈ Standard, 3 SP)
- ✅ Fix carried-forward doc-grounding P0s (.env, Caddyfile, process.env, src/oauth/* refs) — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update DEMO.md and CHANGELOG.md for Discover flow + smoke probe — Frontend Developer (⚡ Quick, 2 SP)
- ✅ QA: doc-grounding verification + Discover smoke-probe execution — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 2 — Issue Enumeration, Custom Field Context & Capture Order | 2026-05-04 | ⏳ in progress | 25 SP est.
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 2 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 2 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 2 — Issue Enumeration, Custom Field Context & Capture Order | 2026-05-04 | 📋 reviewing | 25 SP
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 2 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 2 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define Snapshot orchestrator contract and capture-order sequence — Software Architect (◈ Standard, 3 SP)
- ✅ Implement Issue enumeration via POST /rest/api/3/search/jql with pagination — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement custom field context discovery with system-field skip guard — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement Issue payload assembler (system + custom fields, comments, links, subtasks, sprint, watchers, worklogs, attachment refs) — Backend Developer (◉ Deep, 5 SP)
- ✅ Wire Snapshot phase into capture-order orchestrator and persist manifest — Backend Developer (◈ Standard, 3 SP)
- ✅ Fix carry-forward doc-grounding P0s (.env, sprint6.md, JiraHttpClient line refs, process.env) — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update DEMO.md and CHANGELOG.md for Snapshot Issue-enumeration slice — Frontend Developer (⚡ Quick, 2 SP)
- ✅ QA: doc-grounding verification + Snapshot smoke-probe execution — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 3 — Attachments, Manifest Diff, Policies & Progress Telemetry | 2026-05-04 | ⏳ in progress | 27 SP est.
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 3 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 3 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 3 — Attachments, Manifest Diff, Policies & Progress Telemetry | 2026-05-04 | 📋 reviewing | 27 SP
**Goal:** [Phase: Discovery & Full-Snapshot Backup (Run-First-Backup Flow) — Sprint 3 of 3]
Implement Discover and Snapshot operations against the Atlassian REST API using POST /rest/api/3/search/jql exclusively, capturing the full Phase 1 object set in dependency-correct order with the coverage invariant intact. Attachments are stored binary-faithful with SHA-256 verification. This phase delivers the operator-observable run-first-backup flow.

Deliverables (across all sprints in this phase):
- Project discovery via paginated GET /rest/api/3/project/search honoring projectScope (all / selected)
- JSM project detection (projectTypeKey = service_desk) flagged PHASE_2_DEFERRED in manifest, excluded from backup
- Issue enumeration via POST /rest/api/3/search/jql with pagination terminating on issues.length === 0 || < maxResults; zero usage of deprecated GET /rest/api/3/search
- Custom field context discovery calling GET /rest/api/3/field/{id}/context only for custom: true fields, with [field-context] skip log lines for system fields
- Capture-order orchestrator: IssueType → CustomField + FieldConfiguration → Workflow + WorkflowScheme → Project → Board → Sprint → Issue
- Full Issue payload capture: system + all custom field values, ADF comments, all issue links (both directions), subtasks, sprint membership, watchers, worklogs, attachment refs
- Binary-faithful attachment download via GET /rest/api/3/attachment/content/{id} with SHA-256 contentHash verification
- Backup manifest with deletion-diff detection (added/modified/deleted/unchanged change badges)
- POST /api/policies endpoint accepting rpoHours, retentionDays, projectScope, optional jqlFilter validated via POST /rest/api/3/jql/parse
- Backup job progress events emitted ≤10s, stalled alert at >20s, 'Completed with N errors' status semantics

This is sprint 3 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Design attachment storage layout, manifest-diff schema, and progress-event contract — Software Architect (◈ Standard, 3 SP)
- ✅ Implement binary-faithful attachment download with SHA-256 verification — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement backup manifest deletion-diff with change badges — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement POST /api/policies with jqlFilter validation via /rest/api/3/jql/parse — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement backup job progress heartbeat, stalled-alert, and 'Completed with N errors' status — Backend Developer (◉ Deep, 5 SP)
- ✅ Fix carry-forward doc-grounding P0s (.env, JiraHttpClient line refs, process.env, sprint reports) — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update DEMO.md and CHANGELOG.md for attachments, manifest-diff, policies, and progress telemetry — Frontend Developer (⚡ Quick, 2 SP)
- ✅ QA: doc-grounding verification + smoke-probe execution for Sprint 3 deliverables — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 1 — Inventory API & Sidebar (Phase 3 slice 1 of 2) | 2026-05-04 | ⏳ in progress | 29 SP est.
**Goal:** [Phase: Protected Object Inventory & Browse Flow — Sprint 1 of 2]
Deliver the operator-facing Inventory sidebar and Object Explorer that exercises the backup manifest produced by the snapshot phase. This is the browse-protected-inventory operator flow: sidebar with four object types defaulting to Issues, structured search and filter facets, and traceability from any item to its backup-point ID and timestamp.

Deliverables (across all sprints in this phase):
- GET /api/inventory endpoint returning objectTypes array with Project, Issue, Board, Sprint, Workflow, Custom Field entries with counts and lastBackupAt
- Inventory sidebar UI with four Phase 1 object types (Issues default, Projects, Boards, Sprints) and per-type counts
- Object Explorer pagination via GET /api/inventory/{type}?connectionId&backupPointId&limit&offset
- Issue displayName rendering as <PROJECT_KEY>-<N> with changeBadge (added/modified/deleted/unchanged)
- Structured filter facets: status, issueType, assignee, sprint, board, label, priority, date-range on updated
- Exact-match Issue key search and tokenized case-insensitive Issue summary search
- Tokenized partial-match attachment filename search
- Body-content search explicitly disabled (no full-text across ADF description/comments)
- JSM project exclusion from sidebar counts and inventory results
- Single-click traceability from any item to backup-point ID + timestamp

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 1 — Inventory API & Sidebar (Phase 3 slice 1 of 2) | 2026-05-05 | 📋 reviewing | 29 SP
**Goal:** [Phase: Protected Object Inventory & Browse Flow — Sprint 1 of 2]
Deliver the operator-facing Inventory sidebar and Object Explorer that exercises the backup manifest produced by the snapshot phase. This is the browse-protected-inventory operator flow: sidebar with four object types defaulting to Issues, structured search and filter facets, and traceability from any item to its backup-point ID and timestamp.

Deliverables (across all sprints in this phase):
- GET /api/inventory endpoint returning objectTypes array with Project, Issue, Board, Sprint, Workflow, Custom Field entries with counts and lastBackupAt
- Inventory sidebar UI with four Phase 1 object types (Issues default, Projects, Boards, Sprints) and per-type counts
- Object Explorer pagination via GET /api/inventory/{type}?connectionId&backupPointId&limit&offset
- Issue displayName rendering as <PROJECT_KEY>-<N> with changeBadge (added/modified/deleted/unchanged)
- Structured filter facets: status, issueType, assignee, sprint, board, label, priority, date-range on updated
- Exact-match Issue key search and tokenized case-insensitive Issue summary search
- Tokenized partial-match attachment filename search
- Body-content search explicitly disabled (no full-text across ADF description/comments)
- JSM project exclusion from sidebar counts and inventory results
- Single-click traceability from any item to backup-point ID + timestamp

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define Inventory API contract and sidebar boundary in ARCHITECTURE.md — Software Architect (◈ Standard, 3 SP)
- ✅ Implement GET /api/inventory endpoint with object-type counts and lastBackupAt — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement GET /api/inventory/{type} pagination endpoint — Backend Developer (◉ Deep, 5 SP)
- ✅ Build Inventory sidebar UI with four object types and counts — Frontend Developer (◈ Standard, 3 SP)
- ✅ Build Object Explorer list view with pagination and changeBadge — Frontend Developer (◉ Deep, 5 SP)
- ✅ Update DEMO.md with browse-protected-inventory operator flow + smoke probe — Frontend Developer (⚡ Quick, 2 SP)
- ✅ Update CHANGELOG.md and INSTALL.md for inventory endpoints — Devops Engineer (◈ Standard, 3 SP)
- ✅ QA: end-to-end inventory flow tests (happy + error paths) — Qa Engineer (◈ Standard, 3 SP)
- ✅ QA: doc-grounding verification for Sprint 1 docs — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 2 — Inventory Filters, Search & Traceability | 2026-05-05 | ⏳ in progress | 31 SP est.
**Goal:** [Phase: Protected Object Inventory & Browse Flow — Sprint 2 of 2]
Deliver the operator-facing Inventory sidebar and Object Explorer that exercises the backup manifest produced by the snapshot phase. This is the browse-protected-inventory operator flow: sidebar with four object types defaulting to Issues, structured search and filter facets, and traceability from any item to its backup-point ID and timestamp.

Deliverables (across all sprints in this phase):
- GET /api/inventory endpoint returning objectTypes array with Project, Issue, Board, Sprint, Workflow, Custom Field entries with counts and lastBackupAt
- Inventory sidebar UI with four Phase 1 object types (Issues default, Projects, Boards, Sprints) and per-type counts
- Object Explorer pagination via GET /api/inventory/{type}?connectionId&backupPointId&limit&offset
- Issue displayName rendering as <PROJECT_KEY>-<N> with changeBadge (added/modified/deleted/unchanged)
- Structured filter facets: status, issueType, assignee, sprint, board, label, priority, date-range on updated
- Exact-match Issue key search and tokenized case-insensitive Issue summary search
- Tokenized partial-match attachment filename search
- Body-content search explicitly disabled (no full-text across ADF description/comments)
- JSM project exclusion from sidebar counts and inventory results
- Single-click traceability from any item to backup-point ID + timestamp

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 2 — Inventory Filters, Search & Traceability | 2026-05-05 | 📋 reviewing | 34 SP
**Goal:** [Phase: Protected Object Inventory & Browse Flow — Sprint 2 of 2]
Deliver the operator-facing Inventory sidebar and Object Explorer that exercises the backup manifest produced by the snapshot phase. This is the browse-protected-inventory operator flow: sidebar with four object types defaulting to Issues, structured search and filter facets, and traceability from any item to its backup-point ID and timestamp.

Deliverables (across all sprints in this phase):
- GET /api/inventory endpoint returning objectTypes array with Project, Issue, Board, Sprint, Workflow, Custom Field entries with counts and lastBackupAt
- Inventory sidebar UI with four Phase 1 object types (Issues default, Projects, Boards, Sprints) and per-type counts
- Object Explorer pagination via GET /api/inventory/{type}?connectionId&backupPointId&limit&offset
- Issue displayName rendering as <PROJECT_KEY>-<N> with changeBadge (added/modified/deleted/unchanged)
- Structured filter facets: status, issueType, assignee, sprint, board, label, priority, date-range on updated
- Exact-match Issue key search and tokenized case-insensitive Issue summary search
- Tokenized partial-match attachment filename search
- Body-content search explicitly disabled (no full-text across ADF description/comments)
- JSM project exclusion from sidebar counts and inventory results
- Single-click traceability from any item to backup-point ID + timestamp

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Specify filter facet, search, and traceability contracts in ARCHITECTURE.md — Software Architect (◈ Standard, 3 SP)
- ✅ Implement JSM project exclusion in inventory counts and results — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement structured filter facets on GET /api/inventory/Issue — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement Issue key exact-match and summary tokenized search — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement tokenized attachment filename search — Backend Developer (⚡ Quick, 2 SP)
- ✅ Add backup-point traceability fields to inventory item responses — Backend Developer (⚡ Quick, 2 SP)
- ✅ Build filter facet panel and search bar in Object Explorer UI — Frontend Developer (◉ Deep, 5 SP)
- ✅ Add single-click traceability UI from inventory item to backup-point ID + timestamp — Frontend Developer (◈ Standard, 3 SP)
- ✅ Update DEMO.md with filter/search/traceability flow and refresh smoke probe — Frontend Developer (⚡ Quick, 2 SP)
- ✅ Update CHANGELOG.md and INSTALL.md for new inventory query params — Devops Engineer (⚡ Quick, 1 SP)
- ✅ QA: doc-grounding verification across all canonical docs — Qa Engineer (⚡ Quick, 2 SP)
- ✅ Resolve P0 carry-forward: jsmExcluded field documentation discrepancy — Qa Engineer (◈ Standard, 3 SP)

---
### Sprint 1 — Restore Wizard Foundation & Dependency-Ordered Orchestrator | 2026-05-05 | ⏳ in progress | 31 SP est.
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 1 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 1 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 1 — Restore Wizard Foundation & Dependency-Ordered Orchestrator | 2026-05-05 | 📋 reviewing | 31 SP
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 1 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 1 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define restore orchestrator interfaces and SSE event contract — Software Architect (◈ Standard, 3 SP)
- ✅ Implement Platform Stub POST /api/restore-jobs endpoint — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement restore orchestrator phase dispatcher with dependency-chain enforcement — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement SSE event stream endpoint GET /api/restore-jobs/{id}/events — Backend Developer (◈ Standard, 3 SP)
- ✅ Build Restore Wizard UI shell with conflict mode and destination selectors — Frontend Developer (◉ Deep, 5 SP)
- ✅ Build Restore Job progress view consuming SSE phase events — Frontend Developer (◈ Standard, 3 SP)
- ✅ Update DEMO.md with restore wizard walkthrough and smoke probe — Frontend Developer (⚡ Quick, 2 SP)
- ✅ Update INSTALL.md and CHANGELOG.md for restore endpoints — Devops Engineer (⚡ Quick, 2 SP)
- ✅ QA: integration test asserting strict phase order and dependency_phase_failed semantics — Qa Engineer (◈ Standard, 3 SP)
- ✅ QA: doc-grounding verification across DEMO/INSTALL/CHANGELOG/ARCHITECTURE — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 2 — Restore Wizard: Pre-flight Guards, Conflict Modes & Post-Issue Pass | 2026-05-05 | ⏳ in progress | 28 SP est.
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 2 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 2 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 2 — Restore Wizard: Pre-flight Guards, Conflict Modes & Post-Issue Pass | 2026-05-05 | 📋 reviewing | 28 SP
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 2 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 2 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Design pre-restore guard sequence and post-issue-pass contract — Software Architect (◈ Standard, 3 SP)
- ✅ Implement pre-restore scope re-check for both write:board-scope variants — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement Atlassian native trash detection forcing alternate-location restore — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement post-issue-creation pass for comments, subtasks, and issuelinks — Backend Developer (◉ Deep, 5 SP)
- ✅ Build Restore wizard UI: conflict modes + destination selector — Frontend Developer (◉ Deep, 5 SP)
- ✅ QA: end-to-end restore flow tests for guards and post-issue pass — Qa Engineer (◈ Standard, 3 SP)
- ✅ Update DEMO.md with restore wizard walkthrough — Frontend Developer (⚡ Quick, 2 SP)
- ✅ Update CHANGELOG.md and INSTALL.md for restore wizard release — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Doc-grounding verification across canonical docs — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 3 — Restore Orchestrator, SSE Phase Stream & Heartbeat Telemetry | 2026-05-05 | ⏳ in progress | 28 SP est.
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 3 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 3 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 3 — Restore Orchestrator, SSE Phase Stream & Heartbeat Telemetry | 2026-05-05 | 📋 reviewing | 28 SP
**Goal:** [Phase: Restore Wizard & Dependency-Ordered Restore Flow — Sprint 3 of 3]
Deliver the operator-facing Restore wizard exercising the restore engine end-to-end. Enforces the hard write-dependency chain, supports three conflict modes and three destinations (excluding cross-site/cross-tenant and blob export), and emits SSE phase events. This is the restore-protected-objects operator flow.

Deliverables (across all sprints in this phase):
- Restore wizard UI with conflict modes (Override, Skip default, Ask per conflict)
- Destination selector: Original location, Alternate location (same Jira site), Export/Browser Download — cross-site/cross-tenant explicitly blocked
- Restore orchestrator enforcing dependency chain: site-reference-data → project → workflow → custom-field → board → sprint → issue → comment/attachment/subtask/issuelink
- SSE phase event stream emitting events strictly in dependency order with job_failed { error.code: 'dependency_phase_failed', phase: <name> } on failure
- Pre-restore scope re-check including both write:board-scope variants before Board phase begins
- Atlassian native trash detection: in-place restore blocked for projects in 30–60d trash, alternate-location path forced
- Best-effort warning in restore report for ADF media-link rewrite gaps post attachment-restore
- Restore job progress events ≤10s heartbeat, stalled alert at >20s, 'Completed with N errors' semantics
- Comments, subtasks, issue links restored in post-issue-creation pass with counts in restore report

This is sprint 3 of 3 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Define RestoreOrchestrator interface and SSE phase event schema — Software Architect (◈ Standard, 3 SP)
- ✅ Implement RestoreOrchestrator with strict phase ordering and dependency_phase_failed semantics — Backend Developer (◉ Deep, 5 SP)
- ✅ Implement SSE endpoint GET /api/restore/jobs/:id/events streaming phase events — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement progress heartbeat (≤10s) on the restore job event stream — Backend Developer (⚡ Quick, 2 SP)
- ✅ Implement >20s stalled-alert detection on restore job stream — Backend Developer (⚡ Quick, 2 SP)
- ✅ Wire Restore Wizard UI to SSE stream with phase progress, heartbeat freshness, and stalled banner — Frontend Developer (◉ Deep, 5 SP)
- ✅ Update DEMO.md, CHANGELOG.md, and INSTALL.md for restore SSE flow — Devops Engineer (◈ Standard, 3 SP)
- ✅ QA: end-to-end restore SSE phase-ordering and failure-mode test suite — Qa Engineer (◈ Standard, 3 SP)
- ✅ QA: doc-grounding verification for sprint 14 docs — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 15 — SDI Teaser Scanner & Compliance Tags | 2026-05-05 | ⏳ in progress | 26 SP est.
**Goal:** [Phase: SDI Teaser & Compliance Tag Surfacing]
Run the Sensitive Data Intelligence teaser scan during backup across entities, tabular exports, dev-config attachments, and text/log attachments. Surface aggregate counts and activate GDPR/PCI DSS regulation tags in the operator UI. This phase delivers the view-sdi-teaser operator flow.

Deliverables:
- SDI scanner detecting email addresses, API keys/secret tokens, credit card numbers, and phone numbers
- Scan coverage across entities.xml, tabular exports (.csv/.xlsx/.tsv), dev-config (.env/.yaml/.yml/.json/.toml/.properties/.config), and text/log (.txt/.log/.md)
- Aggregate issue_count and project_count rollups per backup point (no per-item findings)
- GDPR regulation tag activation on email or phone detection
- PCI DSS regulation tag activation on credit card detection
- HIPAA tag explicitly hidden in Phase 1
- Teaser badge 'Sensitive data detected' rendered in operator UI with active regulation tags

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 15 — SDI Teaser Scanner & Compliance Tags | 2026-05-05 | ✅ done | 26 SP
**Goal:** [Phase: SDI Teaser & Compliance Tag Surfacing]
Run the Sensitive Data Intelligence teaser scan during backup across entities, tabular exports, dev-config attachments, and text/log attachments. Surface aggregate counts and activate GDPR/PCI DSS regulation tags in the operator UI. This phase delivers the view-sdi-teaser operator flow.

Deliverables:
- SDI scanner detecting email addresses, API keys/secret tokens, credit card numbers, and phone numbers
- Scan coverage across entities.xml, tabular exports (.csv/.xlsx/.tsv), dev-config (.env/.yaml/.yml/.json/.toml/.properties/.config), and text/log (.txt/.log/.md)
- Aggregate issue_count and project_count rollups per backup point (no per-item findings)
- GDPR regulation tag activation on email or phone detection
- PCI DSS regulation tag activation on credit card detection
- HIPAA tag explicitly hidden in Phase 1
- Teaser badge 'Sensitive data detected' rendered in operator UI with active regulation tags

**Delivered:**
- ✅ Define SDI scanner interface and teaser data contract in ARCHITECTURE.md — Software Architect (◈ Standard, 3 SP)
- ✅ Implement SDI detectors (email, API key, credit card, phone) — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement file-type dispatcher for SDI scan coverage — Backend Developer (◈ Standard, 3 SP)
- ✅ Wire SDI scanner into snapshot pipeline and persist BackupPointSdiSummary — Backend Developer (◉ Deep, 5 SP)
- ✅ Add Platform Stub endpoint GET /api/backup-points/{id}/sdi-teaser — Backend Developer (⚡ Quick, 2 SP)
- ✅ Render SDI teaser badge and regulation tags in operator UI — Frontend Developer (◈ Standard, 3 SP)
- ✅ End-to-end QA: SDI teaser detection and regulation activation — Qa Engineer (◈ Standard, 3 SP)
- ✅ Update DEMO.md and CHANGELOG.md for view-sdi-teaser flow — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Doc-grounding verification for sprint 15 docs — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 16 — Observability, Log-Line Guards & Rate-Limit Hardening | 2026-05-05 | ⏳ in progress | 23 SP est.
**Goal:** [Phase: Observability, Hardening & Sprint-Kickoff Handoff — Sprint 1 of 2]
Close out MVP with end-to-end observability, the documented log-line guards from the postmortem, hardening against rate limits and edge cases, and the sprint-kickoff handoff package for Tihomir. Validates that every operator flow's smoke probe passes in CI on a clean environment.

Deliverables (across all sprints in this phase):
- Structured log lines for [search] endpoint, [field-context] skip, [permission-probe], [jql-validate], [restore] phase events, [auth-refresh] mutex acquire/release
- CI smoke-probe suite running every operator-flow probe against a sandbox Jira site
- Backup/restore heartbeat + stalled-alert telemetry validated under fault injection
- Rate-limit handling with exponential backoff on Atlassian 429 responses
- Job-status semantics QA: 'Completed with N errors' vs 'Completed successfully' coverage
- Engineer-facing operations runbook (connection failure, scope drift, refresh-token rotation, JSM-site detection)
- Sprint kickoff brief delivered to Tihomir with Phase 1 scope, Phase 2 deferrals, and open-question log
- Final regression pass against G-01 through G-13 observable signals

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 16 — Observability, Log-Line Guards & Rate-Limit Hardening | 2026-05-05 | 📋 reviewing | 23 SP
**Goal:** [Phase: Observability, Hardening & Sprint-Kickoff Handoff — Sprint 1 of 2]
Close out MVP with end-to-end observability, the documented log-line guards from the postmortem, hardening against rate limits and edge cases, and the sprint-kickoff handoff package for Tihomir. Validates that every operator flow's smoke probe passes in CI on a clean environment.

Deliverables (across all sprints in this phase):
- Structured log lines for [search] endpoint, [field-context] skip, [permission-probe], [jql-validate], [restore] phase events, [auth-refresh] mutex acquire/release
- CI smoke-probe suite running every operator-flow probe against a sandbox Jira site
- Backup/restore heartbeat + stalled-alert telemetry validated under fault injection
- Rate-limit handling with exponential backoff on Atlassian 429 responses
- Job-status semantics QA: 'Completed with N errors' vs 'Completed successfully' coverage
- Engineer-facing operations runbook (connection failure, scope drift, refresh-token rotation, JSM-site detection)
- Sprint kickoff brief delivered to Tihomir with Phase 1 scope, Phase 2 deferrals, and open-question log
- Final regression pass against G-01 through G-13 observable signals

This is sprint 1 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Specify structured log schema and rate-limit/backoff contract in ARCHITECTURE.md — Software Architect (◈ Standard, 3 SP)
- ✅ Resolve P0 doc-grounding carry-forward items — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Implement structured log lines across the six observability tags — Backend Developer (◈ Standard, 3 SP)
- ✅ Implement exponential backoff for Atlassian 429 responses in JiraHttpClient — Backend Developer (◈ Standard, 3 SP)
- ✅ Validate heartbeat + stalled-alert telemetry under fault injection — Qa Engineer (◈ Standard, 3 SP)
- ✅ Build CI smoke-probe suite scaffold for operator-flow probes — Devops Engineer (◉ Deep, 5 SP)
- ✅ Update CHANGELOG.md and INSTALL.md for observability + CI smoke + rate-limit hardening — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Doc-grounding verification for sprint 16 docs — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint 17 — MVP Closeout: CI Smoke Gating, Runbook & Tihomir Handoff | 2026-05-05 | ⏳ in progress | 23 SP est.
**Goal:** [Phase: Observability, Hardening & Sprint-Kickoff Handoff — Sprint 2 of 2]
Close out MVP with end-to-end observability, the documented log-line guards from the postmortem, hardening against rate limits and edge cases, and the sprint-kickoff handoff package for Tihomir. Validates that every operator flow's smoke probe passes in CI on a clean environment.

Deliverables (across all sprints in this phase):
- Structured log lines for [search] endpoint, [field-context] skip, [permission-probe], [jql-validate], [restore] phase events, [auth-refresh] mutex acquire/release
- CI smoke-probe suite running every operator-flow probe against a sandbox Jira site
- Backup/restore heartbeat + stalled-alert telemetry validated under fault injection
- Rate-limit handling with exponential backoff on Atlassian 429 responses
- Job-status semantics QA: 'Completed with N errors' vs 'Completed successfully' coverage
- Engineer-facing operations runbook (connection failure, scope drift, refresh-token rotation, JSM-site detection)
- Sprint kickoff brief delivered to Tihomir with Phase 1 scope, Phase 2 deferrals, and open-question log
- Final regression pass against G-01 through G-13 observable signals

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 17 — MVP Closeout: CI Smoke Gating, Runbook & Tihomir Handoff | 2026-05-05 | 📋 reviewing | 29 SP
**Goal:** [Phase: Observability, Hardening & Sprint-Kickoff Handoff — Sprint 2 of 2]
Close out MVP with end-to-end observability, the documented log-line guards from the postmortem, hardening against rate limits and edge cases, and the sprint-kickoff handoff package for Tihomir. Validates that every operator flow's smoke probe passes in CI on a clean environment.

Deliverables (across all sprints in this phase):
- Structured log lines for [search] endpoint, [field-context] skip, [permission-probe], [jql-validate], [restore] phase events, [auth-refresh] mutex acquire/release
- CI smoke-probe suite running every operator-flow probe against a sandbox Jira site
- Backup/restore heartbeat + stalled-alert telemetry validated under fault injection
- Rate-limit handling with exponential backoff on Atlassian 429 responses
- Job-status semantics QA: 'Completed with N errors' vs 'Completed successfully' coverage
- Engineer-facing operations runbook (connection failure, scope drift, refresh-token rotation, JSM-site detection)
- Sprint kickoff brief delivered to Tihomir with Phase 1 scope, Phase 2 deferrals, and open-question log
- Final regression pass against G-01 through G-13 observable signals

This is sprint 2 of 2 for the phase. Plan a slice of the deliverables appropriate for one sprint; remaining items will be picked up in subsequent sprints via the auto-extracted Carry-Forward Backlog.

**Delivered:**
- ✅ Author engineer-facing operations runbook (docs/OPERATIONS.md) — Software Architect (◈ Standard, 3 SP)
- ✅ Wire all operator-flow probes into CI smoke-probe pipeline — Devops Engineer (◉ Deep, 5 SP)
- ✅ QA job-status semantics: 'Completed with N errors' vs 'Completed successfully' — Qa Engineer (◈ Standard, 3 SP)
- ✅ Final regression pass against G-01 through G-13 observable signals — Qa Engineer (◈ Standard, 3 SP)
- ✅ Author sprint-kickoff brief for Tihomir — Software Architect (◈ Standard, 3 SP)
- ✅ Resolve P0 doc-grounding carry-forwards in canonical docs — Devops Engineer (◈ Standard, 3 SP)
- ✅ Update CHANGELOG.md and INSTALL.md for sprint 17 deliverables — Devops Engineer (⚡ Quick, 1 SP)
- ✅ Doc-grounding verification across all canonical docs — Qa Engineer (⚡ Quick, 2 SP)
- ✅ Fix G-09 field-context skip log format mismatch — Qa Engineer (◈ Standard, 3 SP)
- ✅ Verify test suite passes after log format changes — Devops Engineer (◈ Standard, 3 SP)

---
### Sprint 18 — Maintenance: Build & Run Validation | 2026-05-05 | ⏳ in progress | 24 SP est.
**Goal:** [Maintenance Sprint] Build & Run Validation

## Goal
Get the project to a state where it builds without errors, starts cleanly,
and its existing tests pass. Do NOT add features. Do NOT change architecture.
Only repair.

## Definition of Done (all four must be true)
1. The project's standard build command succeeds with exit 0.
2. The project's standard start command launches the server, it stays
   alive for at least 30 seconds, and `GET http://localhost:4000/health`
   (or the project's documented liveness endpoint) returns 2xx.
3. The project's standard test command exits 0 with no failures or errors.
4. README.md / INSTALL.md state the build and start commands; running them
   exactly as documented produces points 1-3.

## Configuration
- TARGET_PORT: 4000  (the server must listen on this port; if the
  default in the codebase is different, change the default to TARGET_PORT)

## Approach (iterate until DoD is met)
1. **Detect project shape.** Look for one of:
   - `package.json` → Node.js / npm or pnpm or yarn
   - `pyproject.toml` / `setup.py` / `requirements.txt` → Python
   - `Cargo.toml` → Rust
   - `go.mod` → Go
   - `pom.xml` / `build.gradle` → Java
   - `Makefile` → make-driven
   Use the tooling that matches. Don't introduce a new build system.

2. **Build pass.** Run the standard build command. If it fails:
   - Read the error output completely.
   - Fix the smallest set of things that resolve it (type errors, missing
     imports, unused-symbol strict-mode warnings, version conflicts).
   - Re-run. Repeat until exit 0.

3. **Dependency pass.** If the build or test command can't even start
   because of missing native binaries / lockfile drift / missing platform
   modules:
   - Re-resolve dependencies (e.g. `rm -rf node_modules && npm install`
     for Node, `pip install -r requirements.txt` for Python, equivalent
     for the project's package manager).
   - Verify the lockfile is committed.

4. **Run pass.** Start the server on TARGET_PORT.
   - If the codebase defaults to a different port, change the default to
     TARGET_PORT in the relevant config file (`.env.example`, `config.ts`,
     CLI flag default, etc.) and update INSTALL.md/README.md to match.
   - Probe `GET http://localhost:TARGET_PORT/health` (or the project's
     documented endpoint). If it returns 2xx, that's a pass.
   - If startup fails, read stderr, fix the cause, re-run.

5. **Test pass.** Run the standard test command. Fix every failing test
   until exit 0. If a test is failing because of a real product bug, fix
   the bug; if it's failing because of a stale assertion, fix the test.
   Don't delete tests to make them pass.

6. **Doc consistency.** README.md and INSTALL.md must state the build,
   start, and test commands literally. If TARGET_PORT changed, every
   port reference in canonical docs must be updated.

## Out of scope
- New features
- Refactoring that isn't strictly necessary to make 1-4 pass
- Performance work
- Updating dependencies to newer major versions

## When to surface as P0 carry-forward (instead of fixing in this sprint)
- The project is missing a fundamental component (e.g. no entry point at all,
  no test runner configured) — flag it; don't reinvent.
- A test is asserting against a removed feature — flag it for product owner
  decision; don't silently delete.
- Build error caused by an external service being down — flag it.

## Hints for the planner
This sprint typically decomposes into ~5-7 tasks:
- Diagnosis (architect, 2 SP): walk the repo, list every error class
- Build-error fixes (backend, 3-5 SP per cluster of related errors)
- Dependency repair if needed (devops, 2 SP)
- Run/port fix (backend, 2-3 SP)
- Test fixes (backend or QA, 3-5 SP)
- Doc consistency pass (architect or devops, 2 SP)

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint 18 — Maintenance: Build & Run Validation | 2026-05-05 | ✅ done | 24 SP
**Goal:** [Maintenance Sprint] Build & Run Validation

## Goal
Get the project to a state where it builds without errors, starts cleanly,
and its existing tests pass. Do NOT add features. Do NOT change architecture.
Only repair.

## Definition of Done (all four must be true)
1. The project's standard build command succeeds with exit 0.
2. The project's standard start command launches the server, it stays
   alive for at least 30 seconds, and `GET http://localhost:4000/health`
   (or the project's documented liveness endpoint) returns 2xx.
3. The project's standard test command exits 0 with no failures or errors.
4. README.md / INSTALL.md state the build and start commands; running them
   exactly as documented produces points 1-3.

## Configuration
- TARGET_PORT: 4000  (the server must listen on this port; if the
  default in the codebase is different, change the default to TARGET_PORT)

## Approach (iterate until DoD is met)
1. **Detect project shape.** Look for one of:
   - `package.json` → Node.js / npm or pnpm or yarn
   - `pyproject.toml` / `setup.py` / `requirements.txt` → Python
   - `Cargo.toml` → Rust
   - `go.mod` → Go
   - `pom.xml` / `build.gradle` → Java
   - `Makefile` → make-driven
   Use the tooling that matches. Don't introduce a new build system.

2. **Build pass.** Run the standard build command. If it fails:
   - Read the error output completely.
   - Fix the smallest set of things that resolve it (type errors, missing
     imports, unused-symbol strict-mode warnings, version conflicts).
   - Re-run. Repeat until exit 0.

3. **Dependency pass.** If the build or test command can't even start
   because of missing native binaries / lockfile drift / missing platform
   modules:
   - Re-resolve dependencies (e.g. `rm -rf node_modules && npm install`
     for Node, `pip install -r requirements.txt` for Python, equivalent
     for the project's package manager).
   - Verify the lockfile is committed.

4. **Run pass.** Start the server on TARGET_PORT.
   - If the codebase defaults to a different port, change the default to
     TARGET_PORT in the relevant config file (`.env.example`, `config.ts`,
     CLI flag default, etc.) and update INSTALL.md/README.md to match.
   - Probe `GET http://localhost:TARGET_PORT/health` (or the project's
     documented endpoint). If it returns 2xx, that's a pass.
   - If startup fails, read stderr, fix the cause, re-run.

5. **Test pass.** Run the standard test command. Fix every failing test
   until exit 0. If a test is failing because of a real product bug, fix
   the bug; if it's failing because of a stale assertion, fix the test.
   Don't delete tests to make them pass.

6. **Doc consistency.** README.md and INSTALL.md must state the build,
   start, and test commands literally. If TARGET_PORT changed, every
   port reference in canonical docs must be updated.

## Out of scope
- New features
- Refactoring that isn't strictly necessary to make 1-4 pass
- Performance work
- Updating dependencies to newer major versions

## When to surface as P0 carry-forward (instead of fixing in this sprint)
- The project is missing a fundamental component (e.g. no entry point at all,
  no test runner configured) — flag it; don't reinvent.
- A test is asserting against a removed feature — flag it for product owner
  decision; don't silently delete.
- Build error caused by an external service being down — flag it.

## Hints for the planner
This sprint typically decomposes into ~5-7 tasks:
- Diagnosis (architect, 2 SP): walk the repo, list every error class
- Build-error fixes (backend, 3-5 SP per cluster of related errors)
- Dependency repair if needed (devops, 2 SP)
- Run/port fix (backend, 2-3 SP)
- Test fixes (backend or QA, 3-5 SP)
- Doc consistency pass (architect or devops, 2 SP)

**Delivered:**
- ✅ Diagnose repo build/run/test state and produce error inventory — Software Architect (⚡ Quick, 2 SP)
- ✅ Resolve dependencies and lockfile drift — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Fix build errors until `npm run build` exits 0 — Backend Developer (◉ Deep, 5 SP)
- ✅ Set server default port to 4000 and verify /health liveness — Backend Developer (◈ Standard, 3 SP)
- ✅ Repair failing tests until `npm test` exits 0 — Qa Engineer (◉ Deep, 5 SP)
- ✅ Update README.md and INSTALL.md to document literal build/start/test commands and port 4000 — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Resolve P0 carry-forward doc-grounding gaps in canonical docs — Devops Engineer (◈ Standard, 3 SP)
- ✅ Verify doc grounding and DoD end-to-end on a clean checkout — Qa Engineer (⚡ Quick, 2 SP)

---
### Sprint Maintenance — Restore podman-compose runtime | 2026-05-05 | ⏳ in progress | 19 SP est.
**Goal:** #1: Missing podman-compose

Documentation states that I can run this with podman, but in reality, we are missing the podman-compose for that. 
We need to resolve this as it basically the product doesn't work.

_Sprint started. Role checkpoints below will update as work completes._

---
### Sprint Maintenance — Restore podman-compose runtime | 2026-05-05 | ✅ done | 22 SP
**Goal:** #1: Missing podman-compose

Documentation states that I can run this with podman, but in reality, we are missing the podman-compose for that. 
We need to resolve this as it basically the product doesn't work.

**Delivered:**
- ✅ Define container topology and service contract for podman-compose — Software Architect (⚡ Quick, 2 SP)
- ✅ Author podman-compose.yml at repo root — Devops Engineer (◈ Standard, 3 SP)
- ✅ Create .env.example with all required env vars — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Add start.sh / start.bat / start.ps1 wrappers around podman-compose — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update INSTALL.md and CHANGELOG.md for podman-compose runtime — Devops Engineer (⚡ Quick, 2 SP)
- ✅ Update DEMO.md to run end-to-end via podman-compose — Frontend Developer (⚡ Quick, 2 SP)
- ✅ End-to-end smoke test on a clean checkout via podman-compose — Qa Engineer (◈ Standard, 3 SP)
- ✅ Doc grounding verification across all canonical docs — Qa Engineer (◈ Standard, 3 SP)
- ✅ Fix: Complete end-to-end smoke test on clean checkout via podman-compose — Qa Engineer (◈ Standard, 3 SP)

---
