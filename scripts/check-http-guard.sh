#!/usr/bin/env bash
# CI guard: enforce that JiraHttpClient.ts is the sole file that calls
# fetch() against atlassian.com URLs and that axios.create() is never used.
set -euo pipefail

ERRORS=0
SRC="src"
CLIENT="src/http/JiraHttpClient.ts"

# 1. No axios.create() anywhere in the codebase
AXIOS=$(grep -rEn --include="*.ts" --include="*.tsx" "axios\.create" "$SRC" || true)
if [ -n "$AXIOS" ]; then
  echo "HTTP guard FAIL: axios.create() found (use JiraHttpClient instead):"
  echo "$AXIOS"
  ERRORS=$((ERRORS + 1))
fi

# 2. fetch() calls against atlassian.com must be confined to JiraHttpClient.ts
FETCH_VIOLATIONS=$(
  grep -rEn --include="*.ts" --include="*.tsx" "fetch\(.*atlassian\.com" "$SRC" \
  | grep -v "$(basename "$CLIENT")" \
  || true
)
if [ -n "$FETCH_VIOLATIONS" ]; then
  echo "HTTP guard FAIL: fetch() against atlassian.com found outside $CLIENT:"
  echo "$FETCH_VIOLATIONS"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "HTTP guard failed with $ERRORS violation(s). Route all Atlassian HTTP calls through JiraHttpClient."
  exit 1
fi

echo "HTTP guard passed."
