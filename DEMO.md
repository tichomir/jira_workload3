# Demo — Connect Jira Site

## Prerequisites

- API server running on `http://localhost:3000` (see [INSTALL.md](INSTALL.md))
- Atlassian OAuth app configured with `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, and `OAUTH_REDIRECT_URI` set in `.env`
- Caddy (or any HTTPS proxy) terminating TLS at `https://localhost` and forwarding `/api/*` to port 3000

---

## Connect Jira Site walkthrough

### Step 1 — Open the Connections page

Navigate to `https://localhost` in your browser. You will land on the
**Connections** page which shows the WorkloadCard and an (initially empty)
connections list.

### Step 2 — Start the OAuth flow

Click **Authorize Jira Cloud** on the WorkloadCard. The browser redirects to
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

### Step 3 — Authorize in Atlassian

Log in with a **Site Admin** or **Atlassian Organization Admin** account and
click **Accept** on the permissions screen.

### Step 4 — Callback and token exchange

Atlassian redirects to `OAUTH_REDIRECT_URI` (`/api/oauth/callback`). The server:

1. Validates the `state` parameter and PKCE verifier.
2. Exchanges the authorization code for an `access_token` and `refresh_token`.
3. Calls `https://api.atlassian.com/oauth/token/accessible-resources` to resolve `cloudId` and `siteName`.
4. Upserts the connection record and credentials in the local SQLite store.
5. Redirects the browser back to `/connections`.

### Step 5 — Verify the connection

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

## Manual connection (Client Credentials path)

If you need to register a connection without the OAuth browser flow (e.g. in CI),
post directly to the connections endpoint:

```bash
curl -sf -X POST http://localhost:3000/api/connections \
  -H 'Content-Type: application/json' \
  -d '{
    "cloudId":      "<your-cloud-id>",
    "siteName":     "<your-site-name>",
    "accessToken":  "<access-token>",
    "refreshToken": "<refresh-token>",
    "expiresAt":    <unix-epoch-seconds>,
    "clientId":     "<client-id>",
    "clientSecret": "<client-secret>"
  }' | python3 -m json.tool
```

---

## Smoke probes (machine-readable)

The block below can be run as-is in a POSIX shell. It requires `curl` and
`python3`; it does **not** require `jq`.

```bash
#!/usr/bin/env bash
# connect-jira-site smoke probe
set -euo pipefail

PORT=${PORT:-3000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-cloud-$(date +%s)"

echo "==> [1/3] Create smoke connection"
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
