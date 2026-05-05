#!/usr/bin/env bash
# name: connect-jira-site
# timeout: 30
#
# Exercises the connect-jira-site operator flow:
#   POST /api/connections (OAuth mode)   — creates connection, asserts status=connected
#   GET  /api/connections                — asserts created cloudId is present in list
#   POST /api/connections (manual mode)  — creates manual connection, asserts clientIdMasked
#   GET  /api/connections                — asserts manual connection appears in list
#
# Requires: running API server (npm run server).
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

echo "${CONNECTIONS}" | python3 -m json.tool > /dev/null \
  && echo "PASS: valid JSON response" \
  || { echo "FAIL: invalid JSON response"; exit 1; }

echo "==> [3/3] Create manual connection and verify clientIdMasked"
SMOKE_CLIENT_ID="smoke-client-$(date +%s)"
MANUAL=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"mode\":         \"manual\",
    \"clientId\":     \"${SMOKE_CLIENT_ID}\",
    \"clientSecret\": \"smoke-secret-value\",
    \"siteName\":     \"Smoke Manual Site\"
  }")

echo "${MANUAL}" | grep -q '"clientIdMasked"' \
  && echo "PASS: clientIdMasked present in manual connection response" \
  || { echo "FAIL: clientIdMasked missing from manual connection response"; exit 1; }

echo "${MANUAL}" | grep -q 'connected' \
  && echo "PASS: manual connection status is connected" \
  || { echo "FAIL: manual connection status is not connected"; exit 1; }

EXPECTED_CLOUD_ID="manual:${SMOKE_CLIENT_ID}"
curl -sf "${BASE}/api/connections" | python3 -c "
import json, sys
data = json.load(sys.stdin)
target = '${EXPECTED_CLOUD_ID}'
found = any(c.get('cloudId') == target for c in data)
print('PASS: manual connection found in list' if found else 'FAIL: manual connection not in list')
sys.exit(0 if found else 1)
"

echo ""
echo "All connect-jira-site smoke checks passed."
