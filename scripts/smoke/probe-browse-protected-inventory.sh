#!/usr/bin/env bash
# name: browse-protected-inventory
# timeout: 60
#
# Exercises the browse-protected-inventory operator flow:
#   GET /api/inventory                              — sidebar counts (objectTypes)
#   GET /api/inventory/Issue?q=SMOKE-1             — exact-key search
#   GET /api/inventory/Issue?status=Done           — status facet filter
#   GET /api/inventory/Issue?attachmentFilename=.. — attachment filename search
#   GET /api/inventory/Issue                       — pagination + traceability fields
#
# Seeds a backup manifest and two Issue items with status + attachment data via
# Python sqlite3 — no live Jira credentials required.
# Requires: running API server (npm run server).
set -euo pipefail

PORT=${PORT:-3000}
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

echo "==> [3/8] GET /api/inventory — sidebar counts: HTTP 200 + non-empty objectTypes"
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
echo "All browse-protected-inventory smoke checks passed."
