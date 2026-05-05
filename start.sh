#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL="http://localhost:4000/health"
TIMEOUT=60

if [ ! -f .env ]; then
  echo "WARNING: .env not found — copying from .env.example. Edit it before use."
  cp .env.example .env
fi

echo "Starting stack with podman-compose..."
podman-compose up -d

echo "Waiting for $HEALTH_URL (up to ${TIMEOUT}s)..."
elapsed=0
until curl -sf "$HEALTH_URL" > /dev/null 2>&1; do
  if [ "$elapsed" -ge "$TIMEOUT" ]; then
    echo "ERROR: /health did not respond within ${TIMEOUT}s"
    exit 1
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done

echo "Stack is healthy."
echo "Open: https://localhost"
exit 0
