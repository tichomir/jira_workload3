#!/usr/bin/env bash
# name: run-first-backup
# timeout: 120
#
# Exercises the run-first-backup operator flow:
#   POST /api/connections        — setup smoke connection
#   GET  /api/inventory          — stub inventory endpoint returns objectTypes
#   POST /api/policies           — create policy with rpoHours + retentionDays
#   GET  /api/jobs/:id           — unknown job returns 404
#   discover-flow                — JiraWorkload.discover() via scripts/smoke-discover.ts
#   field-context unit tests     — discoverFieldContexts system-field skip guard
#   issue-enumeration unit tests — assembleIssuePayload + CaptureOrchestrator
#   SHA-256 unit tests           — downloadIssueAttachments binary-faithful verification
#   changeBadge unit tests       — computeManifestDiff deletion-diff
#
# HTTP steps require a running API server (npm run server).
# Unit-test steps use vitest and do not require a live server.
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-backup-$(date +%s)"

echo "==> [1/9] Create smoke connection"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Backup Probe Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created with id ${CONNECTION_ID}"

echo "==> [2/9] GET /api/inventory — assert objectTypes includes Issue, Project, Board, Sprint"
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
for e in otypes:
    assert isinstance(e['count'], int), f'objectTypes[{e[\"type\"]}].count is not an integer'
print('PASS: GET /api/inventory returned valid objectTypes with integer counts')
"

echo "==> [3/9] POST /api/policies — create policy with rpoHours=24 retentionDays=30"
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
assert data.get('connectionId') == '${CONNECTION_ID}', 'connectionId mismatch'
assert data.get('projectScope') == 'all', 'projectScope mismatch'
assert data.get('retentionDays') == 30, 'retentionDays mismatch'
assert data.get('rpoHours') == 24, f'rpoHours mismatch: expected 24 got {data.get(\"rpoHours\")}'
assert 'updatedAt' in data, 'missing updatedAt'
print('PASS: POST /api/policies returned valid policy with rpoHours=24')
"

echo "==> [4/9] GET /api/jobs/:id — unknown job returns 404"
HTTP_STATUS=$(curl -o /dev/null -s -w '%{http_code}' "${BASE}/api/jobs/no-such-job-id")
[ "${HTTP_STATUS}" -eq 404 ] \
  && echo "PASS: GET /api/jobs/:id returned 404 for unknown job" \
  || { echo "FAIL: expected 404 got ${HTTP_STATUS}"; exit 1; }

echo "==> [5/9] discover-flow — JiraWorkload.discover() (mock Atlassian, in-memory DB)"
npx tsx scripts/smoke-discover.ts \
  && echo "PASS: discover-flow probe exited 0" \
  || { echo "FAIL: discover-flow probe exited non-zero"; exit 1; }

echo "==> [6/9] Custom field context discovery unit tests"
npx vitest run src/workload/backup/discoverFieldContexts.test.ts \
  && echo "PASS: field-context tests passed" \
  || { echo "FAIL: field-context tests failed"; exit 1; }

echo "==> [7/9] Issue payload assembler + CaptureOrchestrator unit tests"
npx vitest run src/workload/snapshot/assembleIssuePayload.test.ts \
                src/workload/snapshot/CaptureOrchestrator.test.ts \
  && echo "PASS: issue-enumeration tests passed" \
  || { echo "FAIL: issue-enumeration tests failed"; exit 1; }

echo "==> [8/9] downloadIssueAttachments unit tests (SHA-256 binary-faithful verification)"
npx vitest run src/workload/snapshot/downloadIssueAttachments.test.ts \
  && echo "PASS: downloadIssueAttachments tests passed" \
  || { echo "FAIL: downloadIssueAttachments tests failed"; exit 1; }

echo "==> [9/9] computeManifestDiff unit tests (changeBadge deletion-diff)"
npx vitest run src/workload/backup/computeManifestDiff.test.ts \
  && echo "PASS: computeManifestDiff tests passed" \
  || { echo "FAIL: computeManifestDiff tests failed"; exit 1; }

echo ""
echo "All run-first-backup smoke checks passed."
