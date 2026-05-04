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
