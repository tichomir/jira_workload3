#!/usr/bin/env bash
# Smoke-probe runner.
#
# Usage:
#   bash scripts/run-smoke-probes.sh [probe-dir]
#
# Discovers all probe-*.sh files in [probe-dir] (default: scripts/smoke/) and
# runs them in alphabetical order.  For each probe it:
#   1. Extracts the "# name:" comment from the probe header and uses it as the
#      display name (falls back to the filename stem).
#   2. Extracts the "# timeout:" comment (numeric seconds; trailing 's' is
#      stripped) and enforces it via the system `timeout` command (default 120 s).
#   3. Records PASS / FAIL / TIMEOUT per probe.
#   4. Writes a Markdown summary table to $GITHUB_STEP_SUMMARY when running in
#      a GitHub Actions environment.
#   5. Exits 1 if any probe failed or timed out, and prints the failing probe
#      names to stdout so they appear in the CI log.
set -uo pipefail

SMOKE_DIR="${1:-$(dirname "$0")/smoke}"

# Collect probe files in sorted order.
mapfile -t PROBE_FILES < <(ls "${SMOKE_DIR}"/probe-*.sh 2>/dev/null | sort)

if [[ ${#PROBE_FILES[@]} -eq 0 ]]; then
  echo "ERROR: no probe scripts found in ${SMOKE_DIR}"
  exit 1
fi

# Parallel arrays: result status and display name per probe.
STATUSES=()
NAMES=()
FAILURES=()

for probe in "${PROBE_FILES[@]}"; do
  # Extract # name: directive (first match only).
  PROBE_NAME=$(grep -m1 '^# name:' "${probe}" | sed 's/^# name:[[:space:]]*//' | tr -d '\r')
  PROBE_NAME="${PROBE_NAME:-$(basename "${probe}" .sh)}"

  # Extract # timeout: directive; strip trailing 's' to get plain seconds.
  TIMEOUT_RAW=$(grep -m1 '^# timeout:' "${probe}" | sed 's/^# timeout:[[:space:]]*//' | tr -d '\r')
  TIMEOUT="${TIMEOUT_RAW%s}"
  TIMEOUT="${TIMEOUT:-120}"

  echo ""
  echo "========================================================"
  echo "  Probe : ${PROBE_NAME}"
  echo "  File  : $(basename "${probe}")"
  echo "  Limit : ${TIMEOUT}s"
  echo "========================================================"

  set +e
  timeout "${TIMEOUT}" bash "${probe}"
  EXIT_CODE=$?
  set -e

  if [[ ${EXIT_CODE} -eq 0 ]]; then
    STATUSES+=("PASS")
    echo "[smoke-runner] PASS: ${PROBE_NAME}"
  elif [[ ${EXIT_CODE} -eq 124 ]]; then
    STATUSES+=("TIMEOUT")
    echo "[smoke-runner] TIMEOUT: ${PROBE_NAME} exceeded ${TIMEOUT}s"
    FAILURES+=("${PROBE_NAME} (timed out after ${TIMEOUT}s)")
  else
    STATUSES+=("FAIL")
    echo "[smoke-runner] FAIL: ${PROBE_NAME} (exit ${EXIT_CODE})"
    FAILURES+=("${PROBE_NAME}")
  fi

  NAMES+=("${PROBE_NAME}")
done

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "========================================================"
echo "  Smoke Probe Results"
echo "========================================================"

for i in "${!NAMES[@]}"; do
  case "${STATUSES[$i]}" in
    PASS)    echo "  PASS    ${NAMES[$i]}" ;;
    FAIL)    echo "  FAIL    ${NAMES[$i]}" ;;
    TIMEOUT) echo "  TIMEOUT ${NAMES[$i]}" ;;
  esac
done

# Write GitHub Actions step summary if the variable is set.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Smoke Probe Results"
    echo ""
    echo "| Probe | Status |"
    echo "|---|---|"
    for i in "${!NAMES[@]}"; do
      case "${STATUSES[$i]}" in
        PASS)    echo "| \`${NAMES[$i]}\` | ✅ Pass |" ;;
        FAIL)    echo "| \`${NAMES[$i]}\` | ❌ Fail |" ;;
        TIMEOUT) echo "| \`${NAMES[$i]}\` | ⏱️ Timeout |" ;;
      esac
    done
    if [[ ${#FAILURES[@]} -gt 0 ]]; then
      echo ""
      echo "### Failed probes"
      echo ""
      for name in "${FAILURES[@]}"; do
        echo "- \`${name}\`"
      done
    fi
  } >> "${GITHUB_STEP_SUMMARY}"
fi

# ── Exit ──────────────────────────────────────────────────────────────────────

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo ""
  echo "FAILED: ${FAILURES[*]}"
  exit 1
fi

echo ""
echo "All ${#NAMES[@]} smoke probes passed."
exit 0
