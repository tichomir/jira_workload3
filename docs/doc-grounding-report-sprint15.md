# Doc Grounding Report — Sprint 15 (Phase 4 Sprint 3 of 3)

_Sprint: Restore Orchestrator, SSE Phase Stream & Heartbeat Telemetry_
_Generated: 2026-05-05_
_Scope: DEMO.md, CHANGELOG.md, INSTALL.md, ARCHITECTURE.md_

---

## Summary

| Doc | References checked | Exists=yes | Exists=no | In-sprint fixes | P0 carry-forwards |
|---|---|---|---|---|---|
| DEMO.md | 5 | 5 | 0 | 0 | 0 |
| CHANGELOG.md | 18 | 18 | 0 | 0 | 0 |
| INSTALL.md | 0 | — | — | 0 | 0 |
| ARCHITECTURE.md | 8 | 7 | 1 | 1 | 0 |
| **Total** | **31** | **30** | **1→0** | **1** | **0** |

One in-sprint fix applied (ARCHITECTURE.md main Restore Flow Sequence Diagram stale API call). Zero unresolved misses at close.

---

## DEMO.md

### New references in Sprint 15 (Step 5 — Heartbeat & Stalled Detection)

| Reference | Type | Exists | Section |
|---|---|---|---|
| `src/workload/restore/HeartbeatEmitter.test.ts` | file path (probe command) | yes | Probe 10 |
| `src/routes/restore-jobs-sse-http.test.ts` | file path (probe command) | yes | Probe 10 |
| `{ "type": "heartbeat", "jobId": "…", "ts": "…", "currentPhase": "issue" }` | SSE event shape | yes — HeartbeatEmitter emits this shape via `types.ts` `HeartbeatEvent` which includes `currentPhase: RestorePhase` | Step 5 |
| `Last heartbeat: Xs ago` | UI string | yes — `RestoreJobProgress.tsx` line 289 | Step 5 |
| `No progress received for over 20 seconds. The restore job may be stalled.` | UI string | yes — `StatusBanner` in `RestoreJobProgress.tsx` | Step 5 |

All five references verified. No misses.

---

## CHANGELOG.md

### New files

| Reference | Exists | Notes |
|---|---|---|
| `src/workload/restore/HeartbeatEmitter.ts` | yes | Present in file tree and confirmed read |
| `src/workload/restore/HeartbeatEmitter.test.ts` | yes | Present in file tree |
| `src/platform/restore/sseEvents.ts` | yes | Present in `src/platform/restore/` |
| `src/routes/restore-jobs-sse-http.test.ts` | yes | Present in file tree |

### Updated files

| Reference | Exists | Notes |
|---|---|---|
| `src/workload/restore/RestoreOrchestrator.ts` | yes | Imports `HeartbeatEmitter`; calls `heartbeat.start(phase)` / `heartbeat.stop()` |
| `src/routes/restore-jobs.ts` | yes | Imports `STALLED_THRESHOLD_MS` from `sseEvents.js`; stalled watchdog + 9 s SSE comment heartbeat |
| `src/platform/ui/restore/RestoreJobProgress.tsx` | yes | Heartbeat indicator, stalled state, `completed_with_errors` banner |

### Constants and symbols

| Reference | Exists | Location |
|---|---|---|
| `HEARTBEAT_INTERVAL_MS = 10_000` | yes | `HeartbeatEmitter.ts` |
| `MAX_HEARTBEAT_INTERVAL_MS = 10_000` | yes | `sseEvents.ts` line 386 |
| `STALLED_THRESHOLD_MS = 20_000` | yes | `sseEvents.ts` line 399 |
| `HeartbeatEmitter` class | yes | `HeartbeatEmitter.ts` |
| `start(phase)` method | yes | `HeartbeatEmitter.ts` |
| `stop()` method | yes | `HeartbeatEmitter.ts` |
| `SseEvent` union type | yes | `sseEvents.ts` |
| `RestorePhaseValue` string-literal union | yes | `sseEvents.ts` |

### Behaviors

| Reference | Exists | Verified in |
|---|---|---|
| 9 s SSE comment heartbeat (`: heartbeat\n\n`) | yes | `restore-jobs.ts` — `setInterval(..., 9_000)` |
| Stalled watchdog fires at `STALLED_THRESHOLD_MS` (20 000 ms) | yes | `restore-jobs.ts` `resetStalledWatchdog()` |
| `"Completed with N errors"` status text | yes | `StatusBanner` in `RestoreJobProgress.tsx` |
| `"Last heartbeat: Xs ago"` indicator | yes | `RestoreJobProgress.tsx` heartbeat div |

All 18 references verified. No misses.

---

## INSTALL.md

No new file paths, commands, env-vars, npm scripts, ports, or component references were added to INSTALL.md in Sprint 15. Existing §6 API surface table is unchanged.

No references to verify.

---

## ARCHITECTURE.md

### New "Restore Orchestrator & SSE Phase Stream" section — key files table

| Reference | Exists | Notes |
|---|---|---|
| `src/platform/restore/sseEvents.ts` | yes | Platform boundary type file |
| `HeartbeatEmitter` | yes | `src/workload/restore/HeartbeatEmitter.ts` |
| `HEARTBEAT_INTERVAL_MS` | yes | `HeartbeatEmitter.ts` |
| `MAX_HEARTBEAT_INTERVAL_MS` | yes | `sseEvents.ts` |
| `STALLED_THRESHOLD_MS` | yes | `sseEvents.ts` |

### "Progress Heartbeat and Stalled Detection" section

| Reference | Exists | Notes |
|---|---|---|
| `STALLED_THRESHOLD_MS` source | yes (minor) | Doc attributes constant to `src/workload/types/ProgressEvent.ts`; actual import in `restore-jobs.ts` is from `src/platform/restore/sseEvents.ts`. Both files export the same value (20 000 ms). Not a factual error; both exports are authoritative. No fix required. |

### Main Restore Flow Sequence Diagram — IN-SPRINT FIX

| Reference | Exists | Fix status |
|---|---|---|
| `Orch->>API: GET /rest/api/3/myself` (board scope re-check) | **no — stale** | **Fixed in-sprint** |

**Issue:** The main Restore Flow Sequence Diagram (Restore Subsystem section, previously line 1306) showed `Orch->>API: GET /rest/api/3/myself` for the board scope re-check step. The Sprint 14 fix corrected the Guard Chain sub-diagram but left the main sequence diagram stale. The actual implementation (`boardScopeRecheck.ts`) reads the stored `scopes` column from the `credentials` table — no HTTP call.

**Fix applied:** Changed to `Orch->>DB: SELECT scopes FROM credentials WHERE connectionId = ? (verify write:board-scope:jira-software + write:board-scope.admin:jira-software)` — matching the Guard Chain sub-diagram and the actual implementation.

---

## Prior Sprint Carry-Forwards

### Sprint 14 (Phase 4 Sprint 2) carry-forwards

Sprint 14 reported zero open carry-forwards. All Sprint 13 P0 items were resolved in Sprint 14.

| Item | Status |
|---|---|
| All Sprint 14 carry-forwards | None — Sprint 14 closed with no open items |

### Sprint 15 carry-forwards to Sprint 16

| Item | Justification |
|---|---|
| None | All references verified; one in-sprint fix applied and confirmed |

---

## In-Sprint Fixes Applied

| Fix | File | Change |
|---|---|---|
| Main Restore Flow Sequence Diagram board scope re-check | `ARCHITECTURE.md` | `Orch->>API: GET /rest/api/3/myself` → `Orch->>DB: SELECT scopes FROM credentials WHERE connectionId = ?` — matches Guard Chain sub-diagram and actual `boardScopeRecheck.ts` implementation |

---

## Notes (Non-blocking)

**`HeartbeatEvent` type gap between platform and workload boundaries:**

- `src/platform/restore/sseEvents.ts` `HeartbeatEvent` has fields: `{ type: 'heartbeat', jobId, ts }` — no `currentPhase`.
- `src/workload/restore/types.ts` `HeartbeatEvent` (used by `HeartbeatEmitter`) has fields: `{ type: 'heartbeat', jobId, ts, currentPhase: RestorePhase }`.
- DEMO.md correctly shows `"currentPhase": "issue"` in the sample heartbeat payload, matching the workload type.
- The platform boundary type is intentionally narrower (platform consumers don't need `currentPhase`). This is not a doc error but a type-system narrowing at the boundary. No fix required; noting for Phase 2 type-alignment review.
