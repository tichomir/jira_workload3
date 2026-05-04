# Demo — Connect Jira Site

## Prerequisites

- API server running on `http://localhost:3000` (see [INSTALL.md](INSTALL.md))
- Atlassian OAuth app configured with `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, and `OAUTH_REDIRECT_URI` set in `.env`
- Caddy (or any HTTPS proxy) terminating TLS at `https://localhost` and forwarding `/api/*` to port 3000

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
curl -sf http://localhost:3000/api/connections/${CONNECTION_ID}/probes \
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

curl -sf -X POST http://localhost:3000/api/discover \
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
curl -sf -X POST http://localhost:3000/api/discover \
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

sqlite3 data/jira_workload.db \
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
[search] endpoint=search/jql project=MYPROJ page=1 count=100
[search] endpoint=search/jql project=MYPROJ page=2 count=37
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
sqlite3 data/jira_workload.db \
  "SELECT json_extract(manifestJson, '$.coverageInvariant') FROM backup_manifests WHERE id = '${BACKUP_POINT_ID}';"
```

### Snapshot HTTP endpoint — Phase 3 deliverable

The `/api/snapshot` HTTP route is not yet exposed in this sprint. Issue
enumeration and capture logic are fully implemented and verified via unit tests;
the HTTP surface is a Sprint 3 deliverable.

---

## Smoke probes (machine-readable)

Each block below is a self-contained POSIX shell script. Run them in order
against a running local stub (`npm run server`). All three must exit 0.

### Probe 1 — connect-jira-site (OAuth path)

```bash
#!/usr/bin/env bash
# connect-jira-site smoke probe — OAuth path
set -euo pipefail

PORT=${PORT:-3000}
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

PORT=${PORT:-3000}
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

PORT=${PORT:-3000}
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
assert 'manifestId' in data, 'missing manifestId'
assert 'completedAt' in data, 'missing completedAt'
assert 'counts' in data, 'missing counts'
counts = data['counts']
for key in ('projects', 'issues', 'boards', 'sprints'):
    assert key in counts, f'missing counts.{key}'
print('PASS: GET /api/inventory returned valid inventory response')
"

echo "==> [3/5] Verify inventory counts fields are numeric"
echo "${INVENTORY}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
counts = data['counts']
for key in ('projects', 'issues', 'boards', 'sprints'):
    assert isinstance(counts[key], int), f'counts.{key} is not an integer'
print('PASS: all inventory count fields are integers')
"

echo "==> [4/5] POST /api/policies"
POLICY=$(curl -sf -X POST "${BASE}/api/policies" \
  -H 'Content-Type: application/json' \
  -d "{
    \"connectionId\":  \"${CONNECTION_ID}\",
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
