#!/usr/bin/env bash
set -euo pipefail

[ -d node_modules ] || npm install --silent

npx tsx src/db/database.ts
