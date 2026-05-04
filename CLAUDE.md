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
