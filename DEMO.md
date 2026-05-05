# Demo — Connect Jira Site

## Prerequisites

Configure and start the podman-compose stack before running any step below:

```bash
cp .env.example .env   # fill in ATLASSIAN_CLIENT_ID, ATLASSIAN_CLIENT_SECRET, OAUTH_REDIRECT_URI
./start.sh             # builds image, starts API server + Caddy TLS sidecar, waits for /health
```

Verify the server is healthy:

```bash
curl -sf http://localhost:4000/health
```

See [INSTALL.md](INSTALL.md) for full environment setup and OAuth configuration details.

> **Alternative (no container):** `npm run server` in one terminal + `caddy run` in another. See [INSTALL.md](INSTALL.md) §4.

---

## Connect Jira Site walkthrough

### OAuth flow

#### Step 1 — Open the Connections page

Navigate to `https://localhost` in your browser. You will land on the
**Connections** page which shows the WorkloadCard and an (initially empty)
connections list.

#### Step 2 — Start the OAuth flow

Click **Authorize with Atlassian** on the WorkloadCard. The browser redirects to
`https://auth.atlassian.com/authorize` with the full Phase 1 scope set and a
PKCE code challenge.

Scope set granted:

```
offline_access
read:jira-work          write:jira-work
read:jira-user
manage:jira-project     manage:jira-configuration
read:board-scope:jira-software
write:board-scope:jira-software
write:board-scope.admin:jira-software
read:sprint:jira-software
write:sprint:jira-software
```

#### Step 3 — Authorize in Atlassian

Log in with a **Site Admin** or **Atlassian Organization Admin** account and
click **Accept** on the permissions screen.

#### Step 4 — Callback and token exchange

Atlassian redirects to `OAUTH_REDIRECT_URI` (`/api/oauth/callback`). The server:

1. Validates the `state` parameter and PKCE verifier.
2. Exchanges the authorization code for an `access_token` and `refresh_token`.
3. Calls `https://api.atlassian.com/oauth/token/accessible-resources` to resolve `cloudId` and `siteName`.
4. Upserts the connection record and credentials in the local SQLite store.
5. Redirects the browser back to `/connections`.

#### Step 5 — Verify the connection

The connections list now shows a row for your Jira site with its `siteName`.

To run permission probes manually:

```bash
CONNECTION_ID=<id-from-list>
curl -sf http://localhost:4000/api/connections/${CONNECTION_ID}/probes \
  | python3 -m json.tool
```

A `"remediationNeeded": false` result on all four endpoints confirms the account
holds sufficient permissions.

---

### Manual Connection

Use this path when you need to register a connection without the OAuth browser
flow — for example in CI, or when managing credentials directly from the
Atlassian Developer Console.

#### Step 1 — Open the Manual Connection dialog

On the **Connections** page, click the **Use manual connection** link located
below the **Authorize with Atlassian** button on the WorkloadCard. A
**Manual Connection** modal dialog opens.

#### Step 2 — Enter your OAuth app credentials

The dialog contains two fields:

- **Client ID** — paste your Atlassian OAuth 2.0 app's client ID
  (format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
- **Client Secret** — paste the app's client secret. The field is masked by
  default; use the **Show** toggle to verify the value before submitting.

Click **Connect** to submit. The button label changes to **Connecting…** while
the request is in flight.

#### Step 3 — Confirm success

On success the dialog closes automatically and a green **"Connection created
successfully."** toast appears in the bottom-right corner. The connections list
refreshes to show a new row with:

- **Site name** — `Manual Connection` (or the `siteName` you supplied in the
  request body if using the API directly).
- **Status** — `connected`.

The Client Secret is never displayed again after saving.

#### Step 4 — Handle a 403 / permission error

If the server returns HTTP 403 a **Permission check failed** banner appears
inside the dialog. The Client Secret field is cleared. Visit your
**Atlassian Developer Console**, ensure the OAuth app has all Phase 1 scopes
granted (`read:me`, `read:field:jira`, `read:board-scope:jira-software`,
`read:workflow:jira`), then re-enter the secret and click **Connect** again.

---

---

## Discover Projects

After connecting a Jira site, trigger project discovery to enumerate all
projects on the site and write a backup-point manifest to the
`backup_manifests` table.  Discovery enforces the Phase 1 capture order:
`service_desk` (JSM) projects are detected, excluded from backup, and flagged
`PHASE_2_DEFERRED` in the manifest.

### Trigger a discover run — all projects

```bash
CONNECTION_ID=<id-from-connections-list>

curl -sf -X POST http://localhost:4000/api/discover \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\": \"${CONNECTION_ID}\",
    \"projectScope\": \"all\"
  }" | python3 -m json.tool
```

Expected response:

```json
{
  "backupPointId": "550e8400-e29b-41d4-a716-446655440000",
  "completedAt": "2026-05-04T21:00:00.000Z",
  "projectCount": 12,
  "jsmDeferredCount": 2
}
```

- `backupPointId` — UUID of the manifest row written to `backup_manifests`.
- `projectCount` — non-JSM projects included in the backup scope.
- `jsmDeferredCount` — `service_desk` projects detected and excluded from Phase 1
  backup; flagged `PHASE_2_DEFERRED` in the manifest.

### Trigger a discover run — selected projects

```bash
curl -sf -X POST http://localhost:4000/api/discover \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\": \"${CONNECTION_ID}\",
    \"projectScope\": \"selected\",
    \"selectedProjectKeys\": [\"MYPROJ\", \"DEMO\"]
  }" | python3 -m json.tool
```

### Observe JSM-deferred entries in the manifest

When `jsmDeferredCount > 0`, retrieve the manifest to inspect which
`service_desk` projects were excluded:

```bash
BACKUP_POINT_ID=<backupPointId-from-discover-response>

podman-compose exec app sqlite3 /app/data/jira_workload.db \
  "SELECT manifestJson FROM backup_manifests WHERE id = '${BACKUP_POINT_ID}';" \
  | python3 -m json.tool
```

Each deferred entry has the form:

```json
{
  "projectId": "10042",
  "projectKey": "JSMSUPPORT",
  "projectName": "Customer Support (JSM)",
  "reason": "PHASE_2_DEFERRED"
}
```

---

## Custom Field Context Discovery

After connecting and discovering projects, the backup engine enumerates field
contexts for all custom fields on the site as part of `JiraWorkload.discover()`.

### How it works

1. Calls `GET /rest/api/3/field` once to list every field on the site.
2. For each field where `custom === true`: calls `GET /rest/api/3/field/{id}/context`
   (paginated via `startAt` / `isLast`), collects all context records, and logs:
   ```
   [field-context] fetch field_id=customfield_10016 contextCount=1
   ```
3. For every system field (`custom === false`) the context endpoint is **never
   called**. A skip log line is emitted instead:
   ```
   [field-context] skip field_id=summary reason=system-field
   [field-context] skip field_id=status reason=system-field
   [field-context] skip field_id=priority reason=system-field
   ```

Field context results are persisted inside the `manifestJson` column of
`backup_manifests` alongside project records from the discover step.

### Observe field-context logs during a discover run

Trigger a discover run (see "Discover Projects" above) and watch server output:

```
[field-context] skip field_id=summary reason=system-field
[field-context] skip field_id=description reason=system-field
[field-context] fetch field_id=customfield_10016 contextCount=1
[field-context] fetch field_id=customfield_10020 contextCount=1
```

The absence of any `[field-context]` call containing a system field ID
confirms Constraint 7 (T2 §6) is enforced.

---

## Issue Enumeration (Capture Orchestrator)

The capture orchestrator (`CaptureOrchestrator`) executes snapshot phases in
dependency order: **CustomField → Project → Issue**.

Issue enumeration uses `POST /rest/api/3/search/jql` exclusively.
The deprecated `GET /rest/api/3/search` endpoint is **forbidden** — the
`check:http-guard` script enforces this at every CI run.

### Phase log output

During a snapshot run, each phase emits structured log lines and progress events:

```
[snapshot-progress] phase=CustomField captured=12 total=12 elapsedMs=340
[snapshot-progress] phase=Project captured=4 total=4 elapsedMs=345
[search] endpoint=search/jql project=MYPROJ page=1 pageSize=100 returnedCount=100
[search] endpoint=search/jql project=MYPROJ page=2 pageSize=100 returnedCount=37
[snapshot] project=MYPROJ issues=137 captured=137 errored=0
[snapshot-progress] phase=Issue captured=137 total=unknown elapsedMs=4800
[snapshot-progress] phase=Issue captured=137 total=137 elapsedMs=4850
```

Progress events are emitted per project and on a 9-second time-based heartbeat,
satisfying the ≤10 s contract (T5 §6.2). A job silent for >20 s surfaces a
"stalled" alert in the UI.

### Pagination termination

`enumerateIssues` paginates `POST /rest/api/3/search/jql` using `nextPageToken`
and terminates when:
- `issues.length === 0`, **or**
- `issues.length < maxResults`

### Coverage invariant

Every issue captured satisfies the coverage invariant: all custom field IDs
from the `CustomField` phase appear as keys in `customFieldValues` — even when
the field has no value on this issue (stored as `null`). A violation throws a
diagnostic and increments the error count.

A backup that completes with per-item errors displays **"Completed with N
errors"** rather than "Completed successfully." The error count is visible in
the `coverageInvariant` block of the manifest:

```bash
BACKUP_POINT_ID=<backupPointId-from-discover-response>
podman-compose exec app sqlite3 /app/data/jira_workload.db \
  "SELECT json_extract(manifestJson, '$.coverageInvariant') FROM backup_manifests WHERE id = '${BACKUP_POINT_ID}';"
```

### Snapshot HTTP endpoint

The `/api/snapshot` HTTP route is not yet exposed. Issue enumeration, attachment
download, and capture orchestration are fully implemented and verified via unit
tests; the HTTP surface will be wired in a follow-on sprint.

---

## Create a Backup Policy

Before running a snapshot, create a backup policy that specifies the Recovery
Point Objective, retention window, and project scope.

### Create a policy — all projects

```bash
CONNECTION_ID=<id-from-connections-list>

curl -sf -X POST http://localhost:4000/api/policies \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
    \"rpoHours\":      24,
    \"retentionDays\": 30,
    \"projectScope\":  \"all\"
  }" | python3 -m json.tool
```

Expected response (HTTP 201):

```json
{
  "policyId": "550e8400-e29b-41d4-a716-446655440000",
  "connectionId": "<connection-id>",
  "rpoHours": 24,
  "projectScope": "all",
  "selectedProjectKeys": [],
  "retentionDays": 30,
  "updatedAt": "2026-05-04T21:00:00.000Z"
}
```

### Create a policy with a JQL filter

```bash
curl -sf -X POST http://localhost:4000/api/policies \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
    \"rpoHours\":      24,
    \"retentionDays\": 30,
    \"projectScope\":  \"all\",
    \"jqlFilter\":     \"created >= -90d\"
  }" | python3 -m json.tool
```

The server validates `jqlFilter` via `POST /rest/api/3/jql/parse` before storing
the policy. An invalid JQL expression returns HTTP 400
`{ "error": "invalid_jql", "details": {...} }`.

### Create a policy — selected projects

```bash
curl -sf -X POST http://localhost:4000/api/policies \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":        \"${CONNECTION_ID}\",
    \"rpoHours\":            24,
    \"retentionDays\":       30,
    \"projectScope\":        \"selected\",
    \"selectedProjectKeys\": [\"MYPROJ\", \"DEMO\"]
  }" | python3 -m json.tool
```

---

## Attachments — Binary-Faithful Storage & SHA-256 Verification

During a snapshot the capture orchestrator downloads every Issue attachment via
`GET /rest/api/3/attachment/content/{id}` and stores it under:

```
data/attachments/{backupPointId}/{issueKey}/{attachmentId}
data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json
```

The binary is stored byte-for-byte (no transcoding or recompression). The sidecar
`{attachmentId}.meta.json` carries the SHA-256 digest, MIME type, original
filename, and capture timestamp. After writing the binary the engine re-reads the
file and re-verifies the SHA-256 — a mismatch is counted as a per-item error and
appears in the job's `errorsCount`.

The default storage root is `data/attachments`. Set `DCC_ATTACHMENT_DIR` in `.env`
to override, e.g. `DCC_ATTACHMENT_DIR=/mnt/backup-volume/attachments`.

### Server log output during attachment download

```
[attachment] op=download id=10042 bytes=45320 sha256=a1b2c3d4... outcome=ok
[attachment] op=download id=10043 bytes=0 sha256= outcome=http_error
[attachment] op=download id=10044 bytes=12800 sha256=d4e5f6a7... outcome=hash_mismatch
```

### Read a sidecar file to verify SHA-256

> **Phase 2 — not yet shipped.**  Attachment binaries and `.meta.json` sidecar
> files are written by the snapshot engine when `POST /api/snapshot` runs.
> That HTTP endpoint is not yet exposed (see
> [Issue Enumeration](#issue-enumeration-capture-orchestrator) above).
> The paths and commands below are correct and will work once the snapshot
> HTTP surface is wired in a follow-on sprint.

```bash
BACKUP_POINT_ID=<backupPointId>
ISSUE_KEY=PROJ-42
ATTACHMENT_ID=10042

cat "data/attachments/${BACKUP_POINT_ID}/${ISSUE_KEY}/${ATTACHMENT_ID}.meta.json" \
  | python3 -m json.tool
```

Example sidecar:

```json
{
  "attachmentId": "10042",
  "issueKey": "PROJ-42",
  "backupPointId": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "screenshot.png",
  "mimeType": "image/png",
  "size": 45320,
  "sha256": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  "capturedAt": "2026-05-04T21:05:00.000Z"
}
```

### Verify the binary matches its sidecar SHA-256

> **Phase 2 — not yet shipped.**  See note above; requires a completed snapshot run.

```bash
sha256sum "data/attachments/${BACKUP_POINT_ID}/${ISSUE_KEY}/${ATTACHMENT_ID}" \
  | awk '{print $1}'
```

The printed hash must match `sha256` in the sidecar. A mismatch indicates storage
corruption; the attachment should be re-captured.

---

## Job Progress & Stalled Detection

### Server log format

```
[backup-job] op=start     jobId=<uuid> errors=0
[backup-job] op=heartbeat jobId=<uuid> errors=0
[backup-job] op=heartbeat jobId=<uuid> errors=2
[backup-job] op=completed jobId=<uuid> errors=2
```

When no heartbeat is received for >20 seconds the job transitions to `stalled`:

```
[backup-job] op=stalled jobId=<uuid> errors=0
```

A job with per-item errors completes with status `completed_with_errors`; the UI
displays **"Completed with N errors"** — never "Completed successfully."

### Read job status via GET /api/jobs/:id

```bash
JOB_ID=<jobId-from-backup-run>

curl -sf "http://localhost:4000/api/jobs/${JOB_ID}" | python3 -m json.tool
```

Response:

```json
{
  "jobId": "...",
  "status": "completed_with_errors",
  "manifestId": "...",
  "connectionId": "...",
  "createdAt": "2026-05-04T21:00:00.000Z",
  "updatedAt": "2026-05-04T21:06:12.000Z",
  "errorsCount": 3,
  "lastEvent": {
    "jobId": "...",
    "ts": "2026-05-04T21:06:12.000Z",
    "phase": "Issue",
    "processed": 137,
    "total": 140,
    "errorsCount": 3
  }
}
```

#### Job status values

| Status | Meaning |
|---|---|
| `pending` | Job created, not yet started |
| `running` | Capture in progress |
| `completed` | All items captured without errors |
| `completed_with_errors` | Completed with `errorsCount > 0` — UI shows **"Completed with N errors"** |
| `stalled` | No heartbeat for >20 s |
| `failed` | Fatal phase error; `phaseDiagnostic` in manifest |

---

## Manifest Change Badges

After each snapshot the manifest diff pass stamps every project with a
`changeBadge` relative to the previous backup point for the same connection.

| Badge | Meaning |
|---|---|
| `added` | Project first appeared in this run |
| `modified` | Present in both runs; `projectName`, `boardIds`, or `sprintIds` differ |
| `unchanged` | Present in both runs; all tracked fields identical |
| `deleted` | Absent from current run; entry retained with `lastSeenBackupPointId` |

On the first-ever backup run every project receives `changeBadge: "added"`.

### Inspect changeBadges for a backup point

```bash
BACKUP_POINT_ID=<backupPointId-from-discover-response>

podman-compose exec app sqlite3 /app/data/jira_workload.db \
  "SELECT json_extract(value, '$.projectKey'),
          json_extract(value, '$.changeBadge')
   FROM backup_manifests,
        json_each(json_extract(manifestJson, '$.projects'))
   WHERE id = '${BACKUP_POINT_ID}';"
```

### Read the aggregate diff summary

```bash
podman-compose exec app sqlite3 /app/data/jira_workload.db \
  "SELECT json_extract(manifestJson, '$.diffSummary')
   FROM backup_manifests
   WHERE id = '${BACKUP_POINT_ID}';"
```

Example output:

```json
{"added": 3, "modified": 1, "deleted": 0, "unchanged": 8}
```

---

## Browse protected inventory

After connecting a Jira site and running at least one discover run, open the
inventory view to browse all protected objects catalogued in the most recent
backup-point manifest.

### Prerequisites

- A connected Jira site — see [Connect Jira Site walkthrough](#connect-jira-site-walkthrough) above
- At least one completed discover run — see [Discover Projects](#discover-projects) above.
  The discover run writes the backup-point manifest that powers the sidebar counts.

---

### Step 1 — Open the Inventory page

Navigate to `https://localhost/inventory` in your browser. The app auto-selects
the first connected site.

- **No connection found** — the page shows a prompt linking back to the
  Connections page. Connect a Jira site first.
- **No backup yet** — the sidebar renders all four object types with a count of
  zero and a "No backup yet" banner. Counts populate after the first discover run.

---

### Step 2 — Read the Protected Objects sidebar

The **Protected Objects** sidebar lists four object types sourced from the most
recent backup-point manifest for the connected site:

| Row | Count source |
|---|---|
| **Issues** | Sum of `issueCounts.backed` across all non-JSM projects in the manifest |
| **Projects** | Non-JSM projects (`service_desk` projects are excluded — JSM is Phase 2) |
| **Boards** | Deduplicated `boardIds` across all non-JSM projects |
| **Sprints** | Deduplicated `sprintIds` across all non-JSM projects |

Each sidebar row shows:

- The object-type label and total count
- A relative timestamp ("2h ago") indicating when the most recent backup ran;
  hover to see the full ISO-8601 timestamp

**Issues** is the default selection. Click any row to switch the active type.

---

### Step 3 — Browse items in the Object Explorer

Clicking a sidebar row loads its items in the **Object Explorer** panel on the
right.

- The **header** shows the object type name and the connected site name.
- The **pagination bar** shows "Showing 1–50 of N" with **← Prev** and
  **Next →** buttons. Each page returns up to 50 items.
- Each **item row** shows:
  - A **change badge** (`Added`, `Modified`, `Deleted`, or `Unchanged`)
    reflecting the diff relative to the previous backup point for this
    connection. On the first-ever backup all items show `Added`.
  - The **display name** — for Issues this is the Jira key format
    `<PROJECT_KEY>-<N>` (e.g. `PROJ-42`).
  - For Issues, the **summary** text appears beneath the display name when
    non-empty.
  - A **⊕** trace button on the far right.

Navigate forward with **Next →** and backward with **← Prev**. Both buttons are
disabled when there is no further page in that direction.

---

### Step 4 — Filter by facet

Use the **Filter** panel above the Object Explorer to narrow Issues by structured
facets. Available facets for the **Issue** type:

| Facet | Query param | Example values |
|---|---|---|
| Status | `status` | `Done`, `In Progress`, `To Do` |
| Issue type | `issueType` | `Bug`, `Story`, `Task` |
| Assignee | `assignee` | account identifier |
| Sprint | `sprint` | sprint ID |
| Board | `board` | board ID |
| Label | `label` | label string |
| Priority | `priority` | `High`, `Medium`, `Low` |
| Updated from | `updatedFrom` | ISO-8601 date, e.g. `2026-05-01` |
| Updated to | `updatedTo` | ISO-8601 date, e.g. `2026-05-31` |

Multiple values within a single facet are combined with **OR**; multiple
facets are combined with **AND**. Filtering is performed against the backup
manifest — no live Jira API calls are made.

Via the API:

```bash
CONNECTION_ID=<id>
BACKUP_POINT_ID=<backupPointId>

# Filter by a single status value
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&status=Done" \
  | python3 -m json.tool

# Filter by multiple statuses (Done OR In Progress) — repeat the param
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&status=Done&status=In%20Progress" \
  | python3 -m json.tool
```

---

### Step 5 — Search by issue key or summary

Use the **search box** above the Object Explorer to find Issues by key or
summary text:

- **Exact-match issue key** — type a key in `PROJECT-N` format (e.g. `PROJ-42`).
  The Explorer returns only that issue.
- **Tokenized summary search** — type any other text. Each whitespace-separated
  token is matched case-insensitively against the issue summary. All tokens must
  match (AND across tokens, OR is not supported).

> **Body-content search is explicitly disabled in Phase 1.** ADF description and
> comment text are not indexed and will not be searched.

Via the API (`q` parameter):

```bash
# Exact issue-key lookup
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&q=PROJ-42" \
  | python3 -m json.tool

# Tokenized summary search — finds issues whose summary contains both "login" and "error"
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&q=login+error" \
  | python3 -m json.tool
```

---

### Step 6 — Search by attachment filename

Use the **attachment filename** search to find Issues that have an attachment
whose filename matches a given fragment. Each whitespace-separated token is
matched case-insensitively against stored filenames (partial-match, AND across
tokens).

Via the API (`attachmentFilename` parameter):

```bash
# Find issues with an attachment whose filename contains "screenshot"
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&attachmentFilename=screenshot" \
  | python3 -m json.tool

# Multi-token search — filename must contain both "report" and "2026"
curl -sf "http://localhost:4000/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&attachmentFilename=report+2026" \
  | python3 -m json.tool
```

---

### Step 7 — Reveal backup-point traceability (single click)

Click the **⊕** button on any item row to expand its trace panel inline:

| Field | Value |
|---|---|
| **Backup Point ID** | UUID of the backup point that captured this object |
| **Captured At** | Exact local timestamp when this object was written to the backup |

Click **⊕** again to collapse. Every item in the Object Explorer carries
`backupPointId` and `backupPointTimestamp` — a single click establishes
full chain-of-custody from any protected object back to the backup point that
holds its data.

---

## Restore protected objects

After connecting a Jira site and running at least one discover run, open the
restore wizard to select backed-up objects and initiate a dependency-ordered
restore job.

### Prerequisites

- A connected Jira site — see [Connect Jira Site walkthrough](#connect-jira-site-walkthrough) above.
- At least one completed discover run — the wizard auto-populates the most
  recent backup point ID from `GET /api/inventory`.

---

### Step 1 — Open the Restore Wizard

Navigate to `https://localhost/restore` in your browser. The wizard opens at
**Step 1 — Select objects**.

- The **Connection** dropdown auto-selects the first connected site. Change it
  if you have multiple connections.
- The **Most recent backup point** field populates automatically with the backup
  point ID returned by `GET /api/inventory?connectionId=…`.
- Browse objects by type using the **Issue / Project / Board / Sprint** tabs.
  Tick individual checkboxes or use **Select all on this page** to pick all
  objects of that type. Selections are preserved when switching tabs.
- Click **Next →** (the button is disabled until at least one object is
  selected and a backup point is present).

---

### Step 2 — Choose conflict mode

The wizard advances to **Step 2 — Conflict mode**.

Three options are presented:

| Option | Behaviour |
|---|---|
| **Skip** (default) | If an object already exists at the destination, skip it and continue restoring others. |
| **Override** | If an object already exists, overwrite it with the backed-up version. |
| **Ask per conflict** | Pause and prompt for a decision whenever a conflict is detected. |

**Skip** is pre-selected. Accept the default and click **Next →**.

> **Ask per conflict — interactive prompting is Phase 2.** The conflict mode
> selector is fully functional and the `ask` value is accepted by the API, but
> mid-stream interactive pause-and-prompt during a live restore job is deferred
> to Phase 2. In Phase 1, selecting "Ask per conflict" records the preference but
> the restore engine treats it the same as Skip during execution.

---

### Step 3 — Choose destination

The wizard advances to **Step 3 — Restore destination**. As soon as this step
loads, a pre-flight trash check runs automatically.

#### Trash detection — automatic alternate-location routing

Before rendering the destination options, the wizard calls
`GET /api/restore-jobs/trash-check?connectionId=…&projectKeys=…` for every
project key present in the selection. If any project is currently in the
**Atlassian-managed 60-day trash window**, the UI:

1. Shows a yellow warning banner:
   > **Project is in Atlassian native trash; in-place restore unavailable.**
   > Project PROJ is in the Atlassian-managed 60-day trash window. Restore
   > destination has been automatically set to **Alternate location**.
2. Locks the **Original location** option (radio disabled, label shows
   "Unavailable — project is in Atlassian native trash.").
3. Pre-selects **Alternate location (same Jira site)** and requires you to
   enter a target project key before proceeding.

The trash check fires silently ("Checking project trash status…") and resolves
before the **Next →** button becomes active.

> **Restore from Atlassian native trash is not supported.** Projects in the
> 60-day trash window must use alternate-location restore. Native trash
> integration (restoring back to the exact trashed project) is Phase 2.

#### Destination options

| Option | Description |
|---|---|
| **Original location** | Restore objects back to the same Jira project from which they were backed up. Blocked if any selected project is in Atlassian native trash. |
| **Alternate location (same Jira site)** | Restore into a different project on the same connected site. Requires a target project key. Automatically selected when trash is detected. |
| **Export / Browser Download** | Download the selected backup data as a file instead of writing back to Jira. |

Select **Original location** (or accept the alternate if trash was detected)
and click **Next →**.

> **Cross-site restore is not supported in Phase 1.** A notice banner in the
> UI confirms that all destination options above apply to the same connected
> Jira site only.

---

### Step 4 — Review and confirm

The wizard advances to **Step 4 — Review and confirm**. A summary table shows:

| Field | Value |
|---|---|
| Connection | Site name of the selected connection |
| Backup point | UUID of the most recent backup point |
| Objects | Count of selected items (e.g. "5 objects selected") |
| Conflict mode | Skip |
| Destination | Original location |

Click **Start restore**. The wizard POSTs to `POST /api/restore-jobs` with
`conflictMode: "skip"` and `destination: "original"`, then navigates the
browser to `/restore-jobs/{jobId}`.

---

### Step 5 — Observe SSE phase progression

The browser navigates to the **Restore Job Progress** page at
`/restore-jobs/{jobId}`. The page connects to
`GET /api/restore-jobs/{jobId}/events` via `EventSource` and renders each
phase row in dependency order as events arrive:

| Phase identifier | UI label |
|---|---|
| `site-reference-data` | Site reference data |
| `project` | Project |
| `workflow` | Workflow |
| `custom-field` | Custom field |
| `board` | Board |
| `sprint` | Sprint |
| `issue` | Issue |
| `comment-attachment-subtask-issuelink` | Comments, attachments, subtasks & issue links |

Each row transitions: **pending (·) → running (spinner) → completed (✓)**.

#### SSE heartbeat events

While a phase handler is executing, `HeartbeatEmitter` fires every 10 seconds and
emits a `heartbeat` event into the SSE stream:

```json
{ "type": "heartbeat", "jobId": "…", "ts": "2026-05-05T03:00:10Z", "currentPhase": "issue" }
```

`currentPhase` identifies the restore phase currently in progress. The **Restore Job Progress**
page displays a "Last heartbeat: Xs ago" indicator while the job is running.

The UI resets its stalled-detection watchdog timer on every received SSE event (including
`heartbeat`, `phase_started`, `phase_completed`, and `post_issue_sub_phase`). If no event
arrives for more than 20 seconds the stalled banner appears.

#### Pre-phase guards

Two guards run automatically during the sequence and can halt execution
before their respective phases:

- **Trash detection** — runs immediately before the **Project** phase. Checks
  whether any selected project is in the Atlassian 30–60 day trash window. If
  `destination === "original"` and a project is trashed, the effective
  destination is silently switched to `"alternate"` and a server log line is
  emitted:
  ```
  [restore] guard=trash-detection projectKey=PROJ trashed=true
  [restore] guard=trash-detection jobId=<id> forcing destination=alternate
  ```
  Trash detection does **not** halt execution; the job continues with the
  alternate destination.

- **Board scope re-check** — runs immediately before the **Board** phase.
  Reads the stored token scopes for the active connection and verifies that
  **both** `write:board-scope:jira-software` and
  `write:board-scope.admin:jira-software` are present. If either scope is
  missing, the stream emits `job_failed` with
  `error.code: "dependency_phase_failed"` and the Board phase and all
  downstream phases are blocked. Server log:
  ```
  [permission-probe] scope=write:board-scope:jira-software outcome=ok
  [permission-probe] scope=write:board-scope.admin:jira-software outcome=missing
  [restore] phase=board outcome=failed jobId=<id> guard=board-scope-recheck
  ```

If a phase throws, it shows **failed (✕)** and all downstream phases show
**blocked**. The SSE stream closes after a `job_failed` event with
`error.code: "dependency_phase_failed"` — subsequent phases are never started.

#### Post-issue-creation pass sub-phase events

After all Issue bodies are written in the **Issue** phase, the
`comment-attachment-subtask-issuelink` phase executes a sequential post-issue
pass with three sub-phases. The SSE stream emits a `post_issue_sub_phase` event
after each sub-phase:

| Sub-phase | SSE `subPhase` value | What is restored |
|---|---|---|
| 1 | `comment` | ADF comments in authored order |
| 2 | `subtask` | Subtask link relationships |
| 3 | `issuelink` | All other issue link types (blocks, relates to, duplicates, etc.) |

Each event includes `restored`, `errors`, and `attempted` counts:

```json
{ "type": "post_issue_sub_phase", "jobId": "…", "subPhase": "comment",
  "restored": 14, "errors": 0, "attempted": 14 }
{ "type": "post_issue_sub_phase", "jobId": "…", "subPhase": "subtask",
  "restored": 3, "errors": 0, "attempted": 3 }
{ "type": "post_issue_sub_phase", "jobId": "…", "subPhase": "issuelink",
  "restored": 7, "errors": 1, "attempted": 8 }
```

The status banner transitions:

```
Connecting to restore job…  →  Restore in progress…  →  Completed successfully.
```

If per-item errors occurred: **Completed with N errors — M items restored.**

If no heartbeat for >20 s: **No progress received for over 20 seconds. The
restore job may be stalled.**

---

### Step 6 — Completion

When all phases complete the status banner shows **Completed successfully.**
(or **Completed with N errors** if item-level errors occurred). Click
**← Start another restore** to return to the wizard.

#### Reading the restore report

The `job_completed` terminal SSE event carries the aggregate totals:

```json
{
  "type": "job_completed",
  "jobId": "…",
  "restoredCount": 24,
  "errors": 1
}
```

Sub-phase counts are reported via the `post_issue_sub_phase` events streamed
during the `comment-attachment-subtask-issuelink` phase (see Step 5 above).

#### ADF media link warning

After attachments are restored they receive new Jira `attachmentId` values.
ADF `media` nodes in Issue descriptions and comments that reference the old
attachment IDs will be broken. The restore report includes a best-effort
warning when this condition is detected:

```json
{ "adfMediaLinkWarning": true,
  "adfMediaLinkAffectedIssueKeys": ["PROJ-12", "PROJ-34"] }
```

Full ADF media link rewriting is **Phase 2**. The restore completes
successfully even when the warning fires — it is informational only.

---

## View SDI Teaser

After running at least one backup, the **Sensitive Data Intelligence (SDI)** teaser
panel surfaces any sensitive-data findings from that backup point directly in the
Inventory page. The scan runs during the snapshot phase across entity exports,
tabular files, developer-config attachments, and text/log attachments.

### Prerequisites

- A connected Jira site — see [Connect Jira Site walkthrough](#connect-jira-site-walkthrough) above.
- At least one completed backup run that includes an SDI scan pass.

---

### Step 1 — Open the Inventory page

Navigate to `https://localhost/inventory` in your browser and select a backup point.
The `SdiTeaserPanel` component loads automatically once a `backupPointId` is available.

---

### Step 2 — Read the SDI badge and regulation chips

When sensitive data was detected during the backup scan, a yellow badge appears:

> **⚠ Sensitive data detected**
> _N issues across M projects_

Beneath the badge, two regulation chips indicate compliance exposure:

| Chip | Activates when |
|---|---|
| **GDPR** | Email addresses or phone numbers were found in scanned content |
| **PCI DSS** | Credit card numbers (Luhn-validated) were found in scanned content |

Active chips are highlighted; inactive chips are greyed out.

> **HIPAA tag is hidden in Phase 1.** The HIPAA regulation chip is intentionally
> excluded from the teaser panel and will not appear even if HIPAA-relevant data
> is detected. HIPAA surfacing is a Phase 2 deliverable (T7 OQ-3).

When no sensitive data was found in the backup point the panel shows:

> _No sensitive data detected in this backup point._

---

### Step 3 — Inspect the raw SDI summary via API

```bash
BACKUP_POINT_ID=<backupPointId-from-inventory>

curl -sf http://localhost:4000/api/backup-points/${BACKUP_POINT_ID}/sdi-teaser \
  | python3 -m json.tool
```

Example response when GDPR is active and PCI DSS is inactive:

```json
{
  "backupPointId": "550e8400-e29b-41d4-a716-446655440000",
  "issueCount": 14,
  "projectCount": 3,
  "regulations": [
    { "code": "GDPR",    "status": "active"   },
    { "code": "PCI_DSS", "status": "inactive" }
  ]
}
```

- `issueCount` — number of issues in which at least one sensitive-data detector fired.
- `projectCount` — number of projects containing at least one affected issue.
- `regulations` — array of regulation entries; `status` is `active` or `inactive`.
  The GDPR entry activates on any email or phone hit; PCI DSS activates on any credit
  card hit. HIPAA is never included in the Phase 1 response.

A `404` response means no SDI scan was recorded for that backup point (the scan has
not yet run or the backup point does not exist).

---

### Scan coverage

The SDI scanner classifies each attachment by file extension before scanning:

| File class | Extensions / filenames |
|---|---|
| Entity export (XML) | `entities.xml` (any `.xml`) |
| Tabular export | `.csv`, `.tsv`, `.xlsx` |
| Developer config | `.env`, `.yaml`, `.yml`, `.json`, `.toml`, `.properties`, `.config` |
| Text / log | `.txt`, `.log`, `.md` |

Files whose extension does not match any class are classified `unsupported` and
skipped (zero counts). `.xlsx` files are recognised as tabular but skipped with a
`no-parser` log line pending a future spreadsheet parser.

Scan log output per file:
```
[sdi] scan path=<path> class=<class> email=<n> apiKey=<n> cc=<n> phone=<n>
```

---

## Smoke probes (machine-readable)

Each block below is a self-contained POSIX shell script. Run them in order
against a running API server. All probes must exit 0.

Probes that seed data directly into SQLite (Probes 7 and 11) use `python3`
with the `DB_PATH` environment variable (default: `data/jira_workload.db`).
All other steps call the HTTP API on `http://localhost:4000`. Probes that run
`npx vitest` require Node.js and `npm install` on the host (see
[INSTALL.md](INSTALL.md) §1).

Run via podman-compose:
```bash
./start.sh            # builds image, starts stack, waits for /health
bash scripts/run-smoke-probes.sh
```

Run via plain npm (no container):
```bash
npm run server &      # API server on port 4000
bash scripts/run-smoke-probes.sh
```

### Probe 1 — connect-jira-site (OAuth path)

```bash
#!/usr/bin/env bash
# connect-jira-site smoke probe — OAuth path
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-cloud-$(date +%s)"

echo "==> [1/3] Create smoke connection (OAuth mode)"
RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Smoke Test Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

echo "${RESPONSE}" | grep -q '"status"' \
  && echo "PASS: POST /api/connections returned status field" \
  || { echo "FAIL: POST /api/connections missing status field"; exit 1; }

echo "${RESPONSE}" | grep -q 'connected' \
  && echo "PASS: connection status is connected" \
  || { echo "FAIL: connection status is not connected"; exit 1; }

echo "==> [2/3] Verify connection appears in GET /api/connections"
CONNECTIONS=$(curl -sf "${BASE}/api/connections")

echo "${CONNECTIONS}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
target = '${SMOKE_CLOUD_ID}'
found = any(c.get('cloudId') == target for c in data)
print('PASS: connection found in list' if found else 'FAIL: connection not in list')
sys.exit(0 if found else 1)
"

echo "==> [3/3] Verify GET /api/connections returns valid JSON"
echo "${CONNECTIONS}" | python3 -m json.tool > /dev/null \
  && echo "PASS: valid JSON response" \
  || { echo "FAIL: invalid JSON response"; exit 1; }

echo ""
echo "All smoke checks passed."
```

### Probe 2 — manual-connection

```bash
#!/usr/bin/env bash
# manual-connection smoke probe
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLIENT_ID="smoke-client-$(date +%s)"

echo "==> [1/3] Create manual connection (mode=manual)"
RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"mode\":         \"manual\",
    \"clientId\":     \"${SMOKE_CLIENT_ID}\",
    \"clientSecret\": \"smoke-secret-value\",
    \"siteName\":     \"Smoke Manual Site\"
  }")

echo "${RESPONSE}" | grep -q '"status"' \
  && echo "PASS: POST /api/connections (manual) returned status field" \
  || { echo "FAIL: POST /api/connections (manual) missing status field"; exit 1; }

echo "${RESPONSE}" | grep -q 'connected' \
  && echo "PASS: manual connection status is connected" \
  || { echo "FAIL: manual connection status is not connected"; exit 1; }

echo "==> [2/3] Verify clientIdMasked is present"
echo "${RESPONSE}" | grep -q '"clientIdMasked"' \
  && echo "PASS: clientIdMasked present in response" \
  || { echo "FAIL: clientIdMasked missing from response"; exit 1; }

echo "==> [3/3] Verify connection appears in GET /api/connections"
CONNECTIONS=$(curl -sf "${BASE}/api/connections")
EXPECTED_CLOUD_ID="manual:${SMOKE_CLIENT_ID}"

echo "${CONNECTIONS}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
target = '${EXPECTED_CLOUD_ID}'
found = any(c.get('cloudId') == target for c in data)
print('PASS: manual connection found in list' if found else 'FAIL: manual connection not in list')
sys.exit(0 if found else 1)
"

echo ""
echo "All manual-connection smoke checks passed."
```

### Probe 3 — stub-endpoints (inventory + policies)

```bash
#!/usr/bin/env bash
# stub-endpoints smoke probe — GET /api/inventory and POST /api/policies
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-stub-$(date +%s)"

echo "==> [1/5] Create a connection to use for stub endpoint probes"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Stub Probe Site\",
    \"accessToken\":  \"stub-access-token\",
    \"refreshToken\": \"stub-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created with id ${CONNECTION_ID}"

echo "==> [2/5] GET /api/inventory?connectionId=..."
INVENTORY=$(curl -sf "${BASE}/api/inventory?connectionId=${CONNECTION_ID}")

echo "${INVENTORY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'objectTypes' in data, 'missing objectTypes'
otypes = data['objectTypes']
assert isinstance(otypes, list) and len(otypes) > 0, 'objectTypes is empty'
by_type = {e['type']: e for e in otypes}
for t in ('Issue', 'Project', 'Board', 'Sprint'):
    assert t in by_type, f'{t} entry missing from objectTypes'
print('PASS: GET /api/inventory returned valid inventory response')
"

echo "==> [3/5] Verify inventory count fields are integers"
echo "${INVENTORY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
otypes = data['objectTypes']
for e in otypes:
    assert isinstance(e['count'], int), f'objectTypes[{e[\"type\"]}].count is not an integer'
print('PASS: all inventory count fields are integers')
"

echo "==> [4/5] POST /api/policies"
POLICY=$(curl -sf -X POST "${BASE}/api/policies" \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
    \"rpoHours\":      24,
    \"projectScope\":  \"all\",
    \"retentionDays\": 30
  }")

echo "${POLICY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'policyId' in data, 'missing policyId'
assert data.get('connectionId') == '${CONNECTION_ID}', 'connectionId mismatch'
assert data.get('projectScope') == 'all', 'projectScope mismatch'
assert data.get('retentionDays') == 30, 'retentionDays mismatch'
assert data.get('rpoHours') == 24, f'rpoHours mismatch: expected 24 got {data.get(\"rpoHours\")}'
print('PASS: POST /api/policies returned valid policy response')
"

echo "==> [5/5] Verify policy has updatedAt timestamp"
echo "${POLICY}" | grep -q '"updatedAt"' \
  && echo "PASS: policy response contains updatedAt" \
  || { echo "FAIL: policy response missing updatedAt"; exit 1; }

echo ""
echo "All stub-endpoint smoke checks passed."
```

### Probe 4 — discover-flow

```bash
#!/usr/bin/env bash
# discover-flow smoke probe
# Exercises JiraWorkload.discover() with an in-memory mock of the Atlassian
# project-search API. No running API server or live credentials required.
#
# Prerequisite: tsx available via npx (installed by npm install)
set -euo pipefail

echo "==> Running discover-flow smoke probe (mock Atlassian, in-memory DB)"
npx tsx scripts/smoke-discover.ts \
  && echo "PASS: discover-flow probe exited 0" \
  || { echo "FAIL: discover-flow probe exited non-zero"; exit 1; }

echo ""
echo "All discover-flow smoke checks passed."
```

### Probe 5 — field-context + issue-enumeration unit tests

```bash
#!/usr/bin/env bash
# field-context + issue-enumeration unit-test probe
# Verifies custom field context discovery, issue payload assembly, and the
# capture orchestrator against acceptance criteria from Sprint 2 (Phase 2).
# No running server or live credentials required.
set -euo pipefail

echo "==> [1/3] Custom field context discovery unit tests"
npx vitest run src/workload/backup/discoverFieldContexts.test.ts \
  && echo "PASS: field-context tests passed" \
  || { echo "FAIL: field-context tests failed"; exit 1; }

echo "==> [2/3] Issue payload assembler unit tests"
npx vitest run src/workload/snapshot/assembleIssuePayload.test.ts \
  && echo "PASS: assembleIssuePayload tests passed" \
  || { echo "FAIL: assembleIssuePayload tests failed"; exit 1; }

echo "==> [3/3] Capture orchestrator unit tests"
npx vitest run src/workload/snapshot/CaptureOrchestrator.test.ts \
  && echo "PASS: CaptureOrchestrator tests passed" \
  || { echo "FAIL: CaptureOrchestrator tests failed"; exit 1; }

echo ""
echo "All field-context + issue-enumeration smoke checks passed."
```

### Probe 6 — Sprint 3 deliverables: policies (rpoHours), job status, attachment SHA-256 & manifest changeBadge

```bash
#!/usr/bin/env bash
# Sprint 3 smoke probe — policies rpoHours, GET /api/jobs/:id,
# downloadIssueAttachments SHA-256 unit tests, computeManifestDiff changeBadge
# unit tests.
# Requires: podman-compose stack running (./start.sh) for HTTP steps 1–4.
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-sprint3-$(date +%s)"

echo "==> [1/5] Create connection for Sprint 3 probe"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Sprint 3 Probe Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created ${CONNECTION_ID}"

echo "==> [2/5] POST /api/policies with rpoHours"
POLICY=$(curl -sf -X POST "${BASE}/api/policies" \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
    \"rpoHours\":      24,
    \"retentionDays\": 30,
    \"projectScope\":  \"all\"
  }")

echo "${POLICY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'policyId' in data, 'missing policyId'
assert data.get('rpoHours') == 24, f'rpoHours mismatch: expected 24 got {data.get(\"rpoHours\")}'
assert data.get('retentionDays') == 30, 'retentionDays mismatch'
assert data.get('connectionId') == '${CONNECTION_ID}', 'connectionId mismatch'
assert 'updatedAt' in data, 'missing updatedAt'
print('PASS: POST /api/policies returned valid policy with rpoHours=24')
"

echo "==> [3/5] GET /api/jobs/:id returns 404 for unknown job"
HTTP_STATUS=$(curl -o /dev/null -s -w '%{http_code}' "${BASE}/api/jobs/no-such-job-id")
[ "${HTTP_STATUS}" -eq 404 ] \
  && echo "PASS: GET /api/jobs/:id returned 404 for unknown job" \
  || { echo "FAIL: expected 404 got ${HTTP_STATUS}"; exit 1; }

echo "==> [4/5] downloadIssueAttachments unit tests (SHA-256 verification)"
npx vitest run src/workload/snapshot/downloadIssueAttachments.test.ts \
  && echo "PASS: downloadIssueAttachments tests passed" \
  || { echo "FAIL: downloadIssueAttachments tests failed"; exit 1; }

echo "==> [5/5] computeManifestDiff unit tests (changeBadge verification)"
npx vitest run src/workload/backup/computeManifestDiff.test.ts \
  && echo "PASS: computeManifestDiff tests passed" \
  || { echo "FAIL: computeManifestDiff tests failed"; exit 1; }

echo ""
echo "All sprint3-deliverables smoke checks passed."
```

### Probe 7 — browse-protected-inventory: filter facets, search & traceability

```bash
#!/usr/bin/env bash
# browse-protected-inventory smoke probe — filter facets, search & traceability
# timeout: 60s
# Verifies:
#   GET /api/inventory                              (sidebar counts)
#   GET /api/inventory/Issue?q=SMOKE-1             (exact-key search)
#   GET /api/inventory/Issue?status=Done           (status facet filter)
#   GET /api/inventory/Issue?attachmentFilename=.. (attachment filename search)
#   GET /api/inventory/Issue                       (pagination + traceability)
# Seeds a backup manifest and two Issue items with status + attachments data
# via python3 sqlite3 — no live Jira credentials required.
# Requires: running API server (npm run server).
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
DB_PATH="${DB_PATH:-data/jira_workload.db}"
SMOKE_CLOUD_ID="smoke-inv-$(date +%s)"

echo "==> [1/8] Create smoke connection"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Inventory Smoke Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created ${CONNECTION_ID}"

echo "==> [2/8] Seed backup manifest + Issue items with status and attachments data"
BACKUP_POINT_ID="smoke-inv-bp-$(date +%s)"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

python3 -c "
import sqlite3, json, sys
db_path, conn_id, cloud_id, bp_id, now = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
manifest = json.dumps({
    'manifestId': bp_id,
    'cloudId': cloud_id,
    'discoveredAt': now,
    'projectScope': 'all',
    'selectedProjectKeys': [],
    'projects': [{
        'projectId': 'p1',
        'projectKey': 'SMOKE',
        'projectName': 'Smoke Project',
        'projectTypeKey': 'software',
        'issueCounts': {'total': 2, 'backed': 2, 'errored': 0},
        'boardIds': ['b1'],
        'sprintIds': ['s1'],
        'changeBadge': 'added',
    }],
    'jsmDeferredProjects': [],
    'fieldContexts': None,
    'customFieldsCaptured': 0,
    'customFieldsSkipped': [],
    'coverageInvariant': None,
    'diffSummary': None,
})
db = sqlite3.connect(db_path)
db.execute(
    'INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson) VALUES (?,?,?,?,?)',
    (bp_id, conn_id, cloud_id, now, manifest))
db.executemany(
    '''INSERT INTO backup_point_items
       (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt, status, attachments)
       VALUES (?,?,\"Issue\",?,?,?,\"added\",?,?,?)''',
    [(conn_id, bp_id, 'SMOKE-1', 'SMOKE-1', 'First smoke issue', now, 'Done', '[\"screenshot.png\"]'),
     (conn_id, bp_id, 'SMOKE-2', 'SMOKE-2', 'Second smoke issue', now, 'In Progress', None)])
db.commit()
db.close()
print('Seeded backup manifest', bp_id, '+ 2 Issue items (SMOKE-1: Done+attachment, SMOKE-2: In Progress)')
" "${DB_PATH}" "${CONNECTION_ID}" "${SMOKE_CLOUD_ID}" "${BACKUP_POINT_ID}" "${NOW}"

echo "PASS: seed complete"

echo "==> [3/8] GET /api/inventory — sidebar counts: assert HTTP 200 + non-empty objectTypes"
INVENTORY=$(curl -sf "${BASE}/api/inventory?connectionId=${CONNECTION_ID}")

echo "${INVENTORY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'objectTypes' in data, 'missing objectTypes'
otypes = data['objectTypes']
assert isinstance(otypes, list) and len(otypes) > 0, 'objectTypes is empty'
by_type = {e['type']: e for e in otypes}
assert 'Issue' in by_type, 'Issue entry missing from objectTypes'
assert 'Project' in by_type, 'Project entry missing from objectTypes'
assert by_type['Issue']['count'] >= 1, f'expected Issue count >= 1, got {by_type[\"Issue\"][\"count\"]}'
assert data.get('backupPointId') == '${BACKUP_POINT_ID}', \
    f'backupPointId mismatch: expected ${BACKUP_POINT_ID}, got {data.get(\"backupPointId\")}'
print(f'PASS: GET /api/inventory returned {len(otypes)} objectTypes, Issue count={by_type[\"Issue\"][\"count\"]}')
"

echo "==> [4/8] GET /api/inventory/Issue?q=SMOKE-1 — exact-key search returns 1 item"
EXACT_KEY=$(curl -sf \
  "${BASE}/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&q=SMOKE-1")

echo "${EXACT_KEY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
assert len(items) == 1, f'expected 1 item for exact-key q=SMOKE-1, got {len(items)}'
assert items[0]['displayName'] == 'SMOKE-1', f'unexpected displayName: {items[0][\"displayName\"]}'
print(f'PASS: exact-key search q=SMOKE-1 returned {len(items)} item: {items[0][\"displayName\"]}')
"

echo "==> [5/8] GET /api/inventory/Issue?status=Done — facet filter returns 1 item"
FACET=$(curl -sf \
  "${BASE}/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&status=Done")

echo "${FACET}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
assert len(items) == 1, f'expected 1 item for status=Done, got {len(items)}'
assert items[0]['displayName'] == 'SMOKE-1', f'unexpected displayName: {items[0][\"displayName\"]}'
print(f'PASS: status facet status=Done returned {len(items)} item: {items[0][\"displayName\"]}')
"

echo "==> [6/8] GET /api/inventory/Issue?attachmentFilename=screenshot — filename search returns 1 item"
FNAME=$(curl -sf \
  "${BASE}/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&attachmentFilename=screenshot")

echo "${FNAME}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
assert len(items) == 1, f'expected 1 item for attachmentFilename=screenshot, got {len(items)}'
assert items[0]['displayName'] == 'SMOKE-1', f'unexpected displayName: {items[0][\"displayName\"]}'
print(f'PASS: attachment-filename search returned {len(items)} item: {items[0][\"displayName\"]}')
"

echo "==> [7/8] GET /api/inventory/Issue — full paginated list"
ITEM_LIST=$(curl -sf \
  "${BASE}/api/inventory/Issue?connectionId=${CONNECTION_ID}&backupPointId=${BACKUP_POINT_ID}&limit=10&offset=0")

echo "${ITEM_LIST}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'items' in data, 'missing items field'
assert 'pagination' in data, 'missing pagination field'
items = data['items']
assert isinstance(items, list) and len(items) > 0, \
    f'expected non-empty items list, got {len(items)}'
pg = data['pagination']
assert pg['total'] >= 1, f'expected pagination.total >= 1, got {pg[\"total\"]}'
assert pg['limit'] == 10, f'expected limit=10, got {pg[\"limit\"]}'
assert pg['offset'] == 0, f'expected offset=0, got {pg[\"offset\"]}'
print(f'PASS: GET /api/inventory/Issue returned {len(items)} item(s), total={pg[\"total\"]}')
"

echo "==> [8/8] Verify single-click traceability — backupPointId + timestamp on first item"
echo "${ITEM_LIST}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
item = data['items'][0]
assert 'backupPointId' in item, 'item missing backupPointId'
assert 'backupPointTimestamp' in item, 'item missing backupPointTimestamp'
assert 'displayName' in item, 'item missing displayName'
assert 'changeBadge' in item, 'item missing changeBadge'
assert 'summary' in item, 'item missing summary'
assert item['backupPointId'] == '${BACKUP_POINT_ID}', \
    f'traceability mismatch: backupPointId={item[\"backupPointId\"]}'
print(f'PASS: traceability OK — backupPointId={item[\"backupPointId\"]}, displayName={item[\"displayName\"]}')
"

echo ""
echo "All browse-inventory smoke checks passed."
```

### Probe 8 — restore-protected-objects

```bash
#!/usr/bin/env bash
# restore-protected-objects smoke probe
# timeout: 60
#
# Exercises the full restore path against the running local stub:
#   POST /api/restore-jobs            — create job (conflictMode: skip, destination: original)
#   GET  /api/restore-jobs/:id/events — SSE event stream
#
# Asserts phase_started events arrive in dependency order:
#   site-reference-data → project → workflow → custom-field →
#   board → sprint → issue → comment-attachment-subtask-issuelink
#
# Terminal SSE event must be job_completed (not job_failed).
# Requires: podman-compose stack running (./start.sh).
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-restore-$(date +%s)"

echo "==> [1/4] Create smoke connection"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Restore Smoke Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created ${CONNECTION_ID}"

echo "==> [2/4] POST /api/restore-jobs — queue restore job (conflictMode: skip, destination: original)"
BACKUP_POINT_ID="smoke-restore-bp-${SMOKE_CLOUD_ID}"

JOB_RESPONSE=$(curl -sf -X POST "${BASE}/api/restore-jobs" \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
    \"backupPointId\": \"${BACKUP_POINT_ID}\",
    \"conflictMode\":  \"skip\",
    \"destination\":   \"original\",
    \"selection\":     [\"SMOKE-1\"]
  }")

JOB_ID=$(echo "${JOB_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['jobId'])")

echo "${JOB_RESPONSE}" | grep -q '"status":"queued"' \
  && echo "PASS: restore job ${JOB_ID} created — status=queued" \
  || { echo "FAIL: expected status=queued in response"; exit 1; }

echo "==> [3/4] Stream SSE events via curl --no-buffer (timeout 60 s)"
SSE_EVENTS=$(timeout 60 curl -s --no-buffer "${BASE}/api/restore-jobs/${JOB_ID}/events")

echo "${SSE_EVENTS}" | grep -q '"type":"phase_started"' \
  && echo "PASS: at least one phase_started event received" \
  || { echo "FAIL: no phase_started events in SSE stream"; exit 1; }

if echo "${SSE_EVENTS}" | grep -q '"type":"job_completed"'; then
  echo "PASS: job_completed terminal event received"
elif echo "${SSE_EVENTS}" | grep -q '"type":"job_failed"'; then
  echo "PASS: job_failed terminal event received"
else
  echo "FAIL: no terminal event (job_completed or job_failed) in SSE stream"
  exit 1
fi

echo "==> [4/4] Assert phase_started events arrive in dependency order"
PHASE_SEQUENCE=$(echo "${SSE_EVENTS}" \
  | grep '"type":"phase_started"' \
  | grep -o '"phase":"[^"]*"' \
  | sed 's/"phase":"//;s/"$//')

echo "${PHASE_SEQUENCE}" | awk '
  BEGIN {
    n=0
    expected[1]="site-reference-data"
    expected[2]="project"
    expected[3]="workflow"
    expected[4]="custom-field"
    expected[5]="board"
    expected[6]="sprint"
    expected[7]="issue"
    expected[8]="comment-attachment-subtask-issuelink"
    errors=0
  }
  /[^[:space:]]/ {
    n++
    if ($0 != expected[n]) {
      print "FAIL: phase " n ": expected=" expected[n] " got=" $0
      errors++
    }
  }
  END {
    if (n == 0) { print "FAIL: no phase_started events received"; exit 1 }
    if (n != 8) { print "FAIL: expected 8 phases, got " n; exit 1 }
    if (errors > 0) exit 1
    print "PASS: " n " phases received in correct dependency order"
  }
' || exit 1

echo ""
echo "All restore-protected-objects smoke checks passed."
```

### Probe 9 — restore sprint-2 guards: trash-check endpoint, board scope recheck & post-issue pass

```bash
#!/usr/bin/env bash
# restore-sprint2-guards smoke probe
# timeout: 60
#
# Verifies Sprint 2 restore pre-flight guards and unit-tested modules:
#   GET /api/restore-jobs/trash-check  — live (non-trashed) project keys
#   GET /api/restore-jobs/trash-check  — TRASH-prefixed key → trashedProjectKeys populated
#   Unit tests: boardScopeRecheck, trashDetectionGuard, RestoreOrchestrator (guard chain)
#
# Requires: podman-compose stack running (./start.sh) for HTTP steps.
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-guards-$(date +%s)"

echo "==> [1/7] Create smoke connection"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Guards Smoke Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created ${CONNECTION_ID}"

echo "==> [2/7] GET /api/restore-jobs/trash-check — non-trashed project keys return empty array"
TRASH_RESP=$(curl -sf \
  "${BASE}/api/restore-jobs/trash-check?connectionId=${CONNECTION_ID}&projectKeys=MYPROJ,DEMO")

echo "${TRASH_RESP}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'trashedProjectKeys' in data, 'missing trashedProjectKeys field'
assert isinstance(data['trashedProjectKeys'], list), 'trashedProjectKeys is not a list'
assert len(data['trashedProjectKeys']) == 0, \
    f'expected empty trashedProjectKeys for live projects, got {data[\"trashedProjectKeys\"]}'
print('PASS: non-trashed project keys return trashedProjectKeys=[]')
"

echo "==> [3/7] GET /api/restore-jobs/trash-check — TRASH-prefixed key → in-trash response"
TRASH_RESP2=$(curl -sf \
  "${BASE}/api/restore-jobs/trash-check?connectionId=${CONNECTION_ID}&projectKeys=TRASHPROJ,MYPROJ")

echo "${TRASH_RESP2}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'trashedProjectKeys' in data, 'missing trashedProjectKeys field'
trashed = data['trashedProjectKeys']
assert 'TRASHPROJ' in trashed, f'expected TRASHPROJ in trashedProjectKeys, got {trashed}'
assert 'MYPROJ' not in trashed, f'expected MYPROJ NOT in trashedProjectKeys, got {trashed}'
print(f'PASS: trash-check correctly identified TRASHPROJ as in-trash, trashedProjectKeys={trashed}')
"

echo "==> [4/7] GET /api/restore-jobs/trash-check — missing connectionId returns 400"
HTTP_STATUS=$(curl -o /dev/null -s -w '%{http_code}' \
  "${BASE}/api/restore-jobs/trash-check?projectKeys=MYPROJ")
[ "${HTTP_STATUS}" -eq 400 ] \
  && echo "PASS: missing connectionId returns 400" \
  || { echo "FAIL: expected 400 got ${HTTP_STATUS}"; exit 1; }

echo "==> [5/7] boardScopeRecheck unit tests"
npx vitest run src/workload/restore/boardScopeRecheck.test.ts \
  && echo "PASS: boardScopeRecheck tests passed" \
  || { echo "FAIL: boardScopeRecheck tests failed"; exit 1; }

echo "==> [6/7] trashDetectionGuard unit tests"
npx vitest run src/workload/restore/trashDetectionGuard.test.ts \
  && echo "PASS: trashDetectionGuard tests passed" \
  || { echo "FAIL: trashDetectionGuard tests failed"; exit 1; }

echo "==> [7/7] RestoreOrchestrator unit tests (covers board-scope guard + post-issue pass)"
npx vitest run src/workload/restore/RestoreOrchestrator.test.ts \
  && echo "PASS: RestoreOrchestrator tests passed" \
  || { echo "FAIL: RestoreOrchestrator tests failed"; exit 1; }

echo ""
echo "All restore-sprint2-guards smoke checks passed."
```

### Probe 10 — restore-sprint3-heartbeat: HeartbeatEmitter & SSE HTTP integration

```bash
#!/usr/bin/env bash
# restore-sprint3-heartbeat smoke probe
# timeout: 60
#
# Verifies Sprint 3 restore SSE deliverables:
#   HeartbeatEmitter cadence, stop, re-entrancy (standalone unit tests)
#   HeartbeatEmitter integration with RestoreOrchestrator (heartbeat fires during long phase)
#   SSE endpoint real-HTTP integration: wire format, forced-failure job_failed semantics,
#     happy-path all 8 phases in dependency order
#
# No running API server needed — integration tests create their own in-process server.
set -euo pipefail

echo "==> [1/2] HeartbeatEmitter unit + orchestrator integration tests"
npx vitest run src/workload/restore/HeartbeatEmitter.test.ts \
  && echo "PASS: HeartbeatEmitter tests passed" \
  || { echo "FAIL: HeartbeatEmitter tests failed"; exit 1; }

echo "==> [2/2] SSE endpoint real-HTTP integration tests (forced-failure + happy-path)"
npx vitest run src/routes/restore-jobs-sse-http.test.ts \
  && echo "PASS: restore-jobs-sse-http integration tests passed" \
  || { echo "FAIL: restore-jobs-sse-http integration tests failed"; exit 1; }

echo ""
echo "All restore-sprint3-heartbeat smoke checks passed."
```

### Probe 11 — view-sdi-teaser

```bash
#!/usr/bin/env bash
# view-sdi-teaser smoke probe
# timeout: 60
#
# Verifies the SDI teaser endpoint:
#   GET /api/backup-points/:id/sdi-teaser
#
# Seeds a backup_point_sdi_summary row via python3 sqlite3 with GDPR=active, PCI_DSS=inactive,
# then asserts the endpoint returns the expected regulations array.
# Requires: running API server (npm run server).
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
DB_PATH="${DB_PATH:-data/jira_workload.db}"
BACKUP_POINT_ID="smoke-sdi-bp-$(date +%s)"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

echo "==> [1/4] Seed backup_point_sdi_summary row (GDPR=active, PCI_DSS=inactive)"
python3 -c "
import sqlite3, json, sys
db_path, bp_id, now = sys.argv[1], sys.argv[2], sys.argv[3]
db = sqlite3.connect(db_path)
db.execute(
    '''INSERT OR REPLACE INTO backup_point_sdi_summary
       (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?,?,?,?,?)''',
    (bp_id, 14, 3, json.dumps({'gdpr': 'active', 'pciDss': 'inactive'}), now))
db.commit()
db.close()
print('Seeded backup_point_sdi_summary', bp_id, '— issueCount=14 projectCount=3 gdpr=active pciDss=inactive')
" "${DB_PATH}" "${BACKUP_POINT_ID}" "${NOW}"

echo "PASS: seed complete"

echo "==> [2/4] GET /api/backup-points/:id/sdi-teaser — assert HTTP 200 and regulations array"
SDI=$(curl -sf "${BASE}/api/backup-points/${BACKUP_POINT_ID}/sdi-teaser")

echo "${SDI}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
assert 'backupPointId' in data, 'missing backupPointId'
assert 'issueCount' in data, 'missing issueCount'
assert 'projectCount' in data, 'missing projectCount'
assert 'regulations' in data, 'missing regulations'
assert isinstance(data['regulations'], list), 'regulations is not a list'
assert data['issueCount'] == 14, f'expected issueCount=14 got {data[\"issueCount\"]}'
assert data['projectCount'] == 3, f'expected projectCount=3 got {data[\"projectCount\"]}'
by_code = {r['code']: r['status'] for r in data['regulations']}
assert 'GDPR' in by_code, 'GDPR entry missing from regulations'
assert 'PCI_DSS' in by_code, 'PCI_DSS entry missing from regulations'
assert 'HIPAA' not in by_code, f'HIPAA must not appear in Phase 1 response, got {list(by_code.keys())}'
assert by_code['GDPR'] == 'active', f'expected GDPR=active got {by_code[\"GDPR\"]}'
assert by_code['PCI_DSS'] == 'inactive', f'expected PCI_DSS=inactive got {by_code[\"PCI_DSS\"]}'
print(f'PASS: GET /api/backup-points/:id/sdi-teaser returned issueCount={data[\"issueCount\"]}, '
      f'projectCount={data[\"projectCount\"]}, GDPR={by_code[\"GDPR\"]}, PCI_DSS={by_code[\"PCI_DSS\"]}')
"

echo "==> [3/4] GET /api/backup-points/no-such-id/sdi-teaser — assert HTTP 404"
HTTP_STATUS=$(curl -o /dev/null -s -w '%{http_code}' \
  "${BASE}/api/backup-points/no-such-backup-point-id/sdi-teaser")
[ "${HTTP_STATUS}" -eq 404 ] \
  && echo "PASS: unknown backup point returns 404" \
  || { echo "FAIL: expected 404 got ${HTTP_STATUS}"; exit 1; }

echo "==> [4/4] SDI detector and scanDispatcher unit tests"
npx vitest run tests/sdi/detectors.test.ts tests/sdi/scanDispatcher.test.ts \
  && echo "PASS: SDI unit tests passed" \
  || { echo "FAIL: SDI unit tests failed"; exit 1; }

echo ""
echo "All view-sdi-teaser smoke checks passed."
```
