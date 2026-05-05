#!/usr/bin/env bash
# name: view-sdi-teaser
# timeout: 60
#
# Exercises the view-sdi-teaser operator flow:
#   GET /api/backup-points/:id/sdi-teaser — HTTP 200 with issueCount, projectCount, regulations
#   GET /api/backup-points/no-such-id/sdi-teaser — HTTP 404
#   SDI detector + scanDispatcher unit tests
#
# Seeds a backup_point_sdi_summary row via Python sqlite3 with GDPR=active, PCI_DSS=inactive.
# HTTP steps require a running API server (npm run server).
# Unit-test steps use vitest and do not require a live server.
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

echo "==> [2/4] GET /api/backup-points/:id/sdi-teaser — HTTP 200, regulations array, no HIPAA"
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
print(f'PASS: sdi-teaser issueCount={data[\"issueCount\"]}, projectCount={data[\"projectCount\"]}, '
      f'GDPR={by_code[\"GDPR\"]}, PCI_DSS={by_code[\"PCI_DSS\"]}')
"

echo "==> [3/4] GET /api/backup-points/no-such-id/sdi-teaser — HTTP 404 for unknown backup point"
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
