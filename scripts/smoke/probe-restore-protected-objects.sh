#!/usr/bin/env bash
# name: restore-protected-objects
# timeout: 120
#
# Exercises the restore-protected-objects operator flow:
#   POST /api/restore-jobs                        — create job (conflictMode: skip)
#   GET  /api/restore-jobs/:id/events             — SSE stream, 8-phase dependency order
#   GET  /api/restore-jobs/trash-check            — live and TRASH-prefixed project keys
#   Unit tests: boardScopeRecheck, trashDetectionGuard, RestoreOrchestrator
#   Unit tests: HeartbeatEmitter cadence + SSE HTTP integration
#
# HTTP steps require a running API server (npm run server).
# Unit-test steps use vitest and do not require a live server.
set -euo pipefail

PORT=${PORT:-4000}
BASE="http://localhost:${PORT}"
SMOKE_CLOUD_ID="smoke-restore-$(date +%s)"

echo "==> [1/10] Create smoke connection"
CONN_RESPONSE=$(curl -sf -X POST "${BASE}/api/connections" \
  -H 'Content-Type: application/json' \
  -d "{
    \"cloudId\":      \"${SMOKE_CLOUD_ID}\",
    \"siteName\":     \"Restore Smoke Site\",
    \"accessToken\":  \"smoke-access-token\",
    \"refreshToken\": \"smoke-refresh-token\",
    \"expiresAt\":    9999999999,
    \"scopes\":       \"write:board-scope:jira-software write:board-scope.admin:jira-software\"
  }")

CONNECTION_ID=$(echo "${CONN_RESPONSE}" | python3 -c "import json,sys; print(json.load(sys.stdin)['connectionId'])")
echo "PASS: connection created ${CONNECTION_ID}"

echo "==> [2/10] POST /api/restore-jobs — queue restore job (conflictMode: skip, destination: original)"
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

echo "==> [3/10] Stream SSE events and assert 8-phase dependency order (timeout 60 s)"
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

echo "${SSE_EVENTS}" \
  | grep '"type":"phase_started"' \
  | grep -o '"phase":"[^"]*"' \
  | sed 's/"phase":"//;s/"$//' \
  | awk '
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

echo "==> [4/10] GET /api/restore-jobs/trash-check — non-trashed keys return empty array"
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

echo "==> [5/10] GET /api/restore-jobs/trash-check — TRASH-prefixed key → in-trash response"
TRASH_RESP2=$(curl -sf \
  "${BASE}/api/restore-jobs/trash-check?connectionId=${CONNECTION_ID}&projectKeys=TRASHPROJ,MYPROJ")

echo "${TRASH_RESP2}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
trashed = data.get('trashedProjectKeys', [])
assert 'TRASHPROJ' in trashed, f'expected TRASHPROJ in trashedProjectKeys, got {trashed}'
assert 'MYPROJ' not in trashed, f'expected MYPROJ NOT in trashedProjectKeys, got {trashed}'
print(f'PASS: TRASHPROJ correctly identified as in-trash, trashedProjectKeys={trashed}')
"

echo "==> [6/10] GET /api/restore-jobs/trash-check — missing connectionId returns 400"
HTTP_STATUS=$(curl -o /dev/null -s -w '%{http_code}' \
  "${BASE}/api/restore-jobs/trash-check?projectKeys=MYPROJ")
[ "${HTTP_STATUS}" -eq 400 ] \
  && echo "PASS: missing connectionId returns 400" \
  || { echo "FAIL: expected 400 got ${HTTP_STATUS}"; exit 1; }

echo "==> [7/10] boardScopeRecheck unit tests"
npx vitest run src/workload/restore/boardScopeRecheck.test.ts \
  && echo "PASS: boardScopeRecheck tests passed" \
  || { echo "FAIL: boardScopeRecheck tests failed"; exit 1; }

echo "==> [8/10] trashDetectionGuard unit tests"
npx vitest run src/workload/restore/trashDetectionGuard.test.ts \
  && echo "PASS: trashDetectionGuard tests passed" \
  || { echo "FAIL: trashDetectionGuard tests failed"; exit 1; }

echo "==> [9/10] RestoreOrchestrator unit tests (guard chain + post-issue pass)"
npx vitest run src/workload/restore/RestoreOrchestrator.test.ts \
  && echo "PASS: RestoreOrchestrator tests passed" \
  || { echo "FAIL: RestoreOrchestrator tests failed"; exit 1; }

echo "==> [10/10] HeartbeatEmitter + SSE HTTP integration tests"
npx vitest run src/workload/restore/HeartbeatEmitter.test.ts \
                src/routes/restore-jobs-sse-http.test.ts \
  && echo "PASS: heartbeat + SSE integration tests passed" \
  || { echo "FAIL: heartbeat + SSE integration tests failed"; exit 1; }

echo ""
echo "All restore-protected-objects smoke checks passed."
