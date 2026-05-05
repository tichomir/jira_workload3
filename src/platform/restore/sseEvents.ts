/**
 * Platform-level SSE event contract for the Restore Orchestrator phase stream.
 *
 * This file is the platform boundary for the restore SSE protocol. Every event
 * type below is emitted by `RestoreOrchestrator.runRestore()` (via the `onEvent`
 * callback) and forwarded by the Express route layer to connected SSE clients.
 *
 * ## Wire format
 *
 * Each event is serialised as a single `data:` line carrying the JSON-encoded
 * `SseEvent`, followed by a blank line:
 *
 * ```
 * data: {"type":"phase_started","jobId":"rj-...","ts":"2026-05-05T03:00:01Z","phase":"project"}
 *
 * ```
 *
 * ## Ordering guarantee
 *
 * Events are emitted strictly in phase order (defined by `RESTORE_PHASES` in
 * `src/workload/restore/RestoreOrchestrator.ts`). A `phase_started` event for
 * phase N is never emitted before `phase_completed` for phase N−1.
 *
 * ## Terminal events
 *
 * The stream always ends with exactly one terminal event:
 *  - `job_failed`   — emitted when any phase fails; subsequent phases are not started.
 *  - `job_completed` — emitted when all phases run to completion (possibly with errors).
 *
 * Both events are never emitted together in one job run.
 *
 * Source: T5 §5.2, §6.2, §6.2b.
 */

// ---------------------------------------------------------------------------
// Shared base
// ---------------------------------------------------------------------------

/**
 * Fields present in every SSE event.
 *
 * Inputs:  jobId — restore job UUID; ts — ISO-8601 emission timestamp
 * Outputs: base type for all discriminated union members
 * Failure: n/a — purely a structural type
 */
export interface SseEventBase {
  /** Restore job UUID this event belongs to. */
  jobId: string;
  /** ISO-8601 timestamp of event emission (local server clock). */
  ts: string;
}

// ---------------------------------------------------------------------------
// Phase lifecycle events
// ---------------------------------------------------------------------------

/**
 * Emitted once when a restore phase begins execution.
 *
 * Always precedes the first `phase_progress` or `phase_completed` event for
 * that phase. Never emitted for phases that are skipped after a `job_failed`.
 *
 * Inputs:  jobId, ts (from base); phase — the starting phase name
 * Outputs: signals UI to display phase N as "running"
 * Failure: n/a — purely observational
 */
export interface PhaseStartedEvent extends SseEventBase {
  type: 'phase_started';
  /** The phase that just began. */
  phase: RestorePhaseValue;
}

/**
 * Heartbeat progress event.
 *
 * Emitted at most once every `MAX_HEARTBEAT_INTERVAL_MS` (10 000 ms) within a
 * running phase. A silence gap of >20 s (`STALLED_THRESHOLD_MS`) triggers a
 * stalled alert in the UI (T5 §6.2).
 *
 * Inputs:  jobId, ts (from base); phase, processed, total
 * Outputs: drives progress-bar rendering in the UI
 * Failure: n/a — if the orchestrator stalls, the platform detects via 20 s silence
 */
export interface PhaseProgressEvent extends SseEventBase {
  type: 'phase_progress';
  /** Phase currently being processed. */
  phase: RestorePhaseValue;
  /** Items successfully processed in this phase so far. */
  processed: number;
  /** Total items to process; null when the count is not yet known. */
  total: number | null;
}

/**
 * Emitted once when a restore phase completes (all items attempted).
 *
 * Always follows the last `phase_progress` event for that phase. Never emitted
 * for a phase that fails — `job_failed` is emitted instead when a phase throws.
 *
 * Inputs:  jobId, ts (from base); phase, restoredCount, errorCount
 * Outputs: signals UI to mark phase N as "done"; feeds cumulative error count
 * Failure: n/a — a failed phase emits job_failed instead of phase_completed
 */
export interface PhaseCompletedEvent extends SseEventBase {
  type: 'phase_completed';
  /** The phase that just completed. */
  phase: RestorePhaseValue;
  /** Items successfully restored in this phase. */
  restoredCount: number;
  /** Item-level errors in this phase (≥0; does not halt the run). */
  errorCount: number;
}

// ---------------------------------------------------------------------------
// Heartbeat sentinel (no-op keep-alive)
// ---------------------------------------------------------------------------

/**
 * Optional keep-alive heartbeat emitted by the transport layer.
 *
 * The orchestrator itself emits `phase_progress` on the 10 s cadence. When the
 * transport needs an additional keep-alive between progress events (e.g. during
 * a conflict pause), it may inject a `heartbeat` comment line instead:
 *
 * ```
 * : heartbeat
 * ```
 *
 * Typed here for completeness; not emitted by the orchestrator directly.
 *
 * Inputs:  jobId, ts (from base)
 * Outputs: prevents connection from timing out during long pauses
 * Failure: n/a
 */
export interface HeartbeatEvent extends SseEventBase {
  type: 'heartbeat';
}

// ---------------------------------------------------------------------------
// Terminal events
// ---------------------------------------------------------------------------

/**
 * Emitted when a phase failure halts the restore job.
 *
 * This event is always terminal — the SSE stream closes after it. No further
 * phases are started. The `error.code` is always `'dependency_phase_failed'`.
 *
 * ## Failure invariant
 *
 * - `error.code` is the literal string `'dependency_phase_failed'` (never varies).
 * - `error.phase` identifies the phase whose failure halted the job.
 * - `error.message` is a human-readable diagnostic surfaced to the operator.
 *
 * ## Triggers
 *
 * | Condition | error.phase |
 * |-----------|-------------|
 * | Phase handler throws | the throwing phase |
 * | Board scope re-check fails | `'board'` |
 *
 * NOTE: Trash detection (Project phase) is NOT a `job_failed` trigger — it
 * silently forces `destination='alternate'` and continues.
 *
 * Inputs:  jobId, ts (from base); error.code, error.phase, error.message
 * Outputs: terminal event — SSE stream closes; UI shows failure banner
 * Failure: this event IS the failure notification
 *
 * Source: T5 §5.2.
 */
export interface JobFailedEvent extends SseEventBase {
  type: 'job_failed';
  error: {
    /**
     * Always `'dependency_phase_failed'`.
     *
     * This literal is stable and machine-readable. Clients MUST NOT pattern-match
     * on the human-readable `message` field for programmatic decisions.
     */
    code: 'dependency_phase_failed';
    /** The phase whose failure halted the restore. */
    phase: RestorePhaseValue;
    /** Human-readable diagnostic for operator display. */
    message: string;
  };
}

/**
 * Emitted when all phases have run to completion.
 *
 * This event is always terminal — the SSE stream closes after it. It is emitted
 * even when `errors > 0`; the UI MUST then display "Completed with N errors",
 * never "Completed successfully" (T5 §6.2b).
 *
 * Inputs:  jobId, ts (from base); errors, restoredCount
 * Outputs: terminal event — SSE stream closes; UI shows completion status
 * Failure: not applicable — job_failed is emitted instead of job_completed when
 *          a phase halts execution
 *
 * Source: T5 §6.2, §6.2b.
 */
export interface JobCompletedEvent extends SseEventBase {
  type: 'job_completed';
  /**
   * Total item-level errors accumulated across all phases.
   *
   * When `errors > 0` the job status is `'completed_with_errors'` and the UI
   * MUST display "Completed with N errors", never "Completed successfully".
   */
  errors: number;
  /** Total items successfully restored across all completed phases. */
  restoredCount: number;
}

// ---------------------------------------------------------------------------
// Conflict-mode events (conflictMode === 'ask')
// ---------------------------------------------------------------------------

/**
 * Emitted when `conflictMode === 'ask'` and a conflict is detected.
 *
 * The orchestrator BLOCKS execution for the conflicting item and awaits a
 * `ConflictDecision` delivered via `POST /api/restore-jobs/{id}/conflict-decision`.
 * The SSE stream stays open during the pause.
 *
 * Inputs:  jobId, ts (from base); conflictId, phase, itemId, conflictType, existingItemSummary
 * Outputs: pauses execution; prompts the UI to show a conflict resolution dialog
 * Failure: if no decision arrives, the job remains paused indefinitely (stalled-alert
 *          timer is suspended during an active conflict pause)
 */
export interface ConflictPauseEvent extends SseEventBase {
  type: 'conflict_pause';
  /** UUID identifying this conflict instance. Referenced in the conflict-decision POST body. */
  conflictId: string;
  /** Phase in which the conflict was detected. */
  phase: RestorePhaseValue;
  /** ID of the conflicting item (Issue key, project ID, board ID, sprint ID). */
  itemId: string;
  /** Structured conflict kind — drives the UI conflict resolution dialog. */
  conflictType: 'item_exists' | 'project_exists' | 'board_exists' | 'sprint_exists';
  /**
   * Lightweight snapshot of the existing item on the target Jira site.
   * Used for operator display only — not schema-bound.
   */
  existingItemSummary: Record<string, unknown>;
}

/**
 * Emitted after a `ConflictDecision` is received and applied.
 *
 * Always follows a `conflict_pause` event with the same `conflictId`. After
 * this event the orchestrator resumes normal phase execution.
 *
 * Inputs:  jobId, ts (from base); conflictId, phase, itemId, decision
 * Outputs: signals UI to close the conflict dialog and resume the progress view
 * Failure: n/a
 */
export interface ConflictResumedEvent extends SseEventBase {
  type: 'conflict_resumed';
  /** UUID matching the corresponding `conflict_pause` event. */
  conflictId: string;
  /** Phase in which the conflict was resolved. */
  phase: RestorePhaseValue;
  /** Item ID that was involved in the conflict. */
  itemId: string;
  /** The resolution applied by the orchestrator. */
  decision: 'override' | 'skip';
}

// ---------------------------------------------------------------------------
// Post-issue-creation pass sub-phase events
// ---------------------------------------------------------------------------

/**
 * Emitted once per sub-phase within the `comment-attachment-subtask-issuelink` phase.
 *
 * Ordering: `comment` → `subtask` → `issuelink`. Each appears inside the
 * `phase_started` / `phase_completed` envelope of the combined phase. Attachments
 * are emitted as part of the `comment` sub-phase sequence.
 *
 * Inputs:  jobId, ts (from base); subPhase, restored, errors, attempted
 * Outputs: feeds the per-category counts in the restore report
 * Failure: errors in a sub-phase are counted but do not halt the pass
 */
export interface PostIssueSubPhaseEvent extends SseEventBase {
  type: 'post_issue_sub_phase';
  /** Which sub-phase within the post-issue pass just completed. */
  subPhase: 'comment' | 'subtask' | 'issuelink';
  /** Items successfully restored in this sub-phase. */
  restored: number;
  /** Item-level errors in this sub-phase. */
  errors: number;
  /** Total items attempted in this sub-phase (restored + errors + skipped). */
  attempted: number;
}

// ---------------------------------------------------------------------------
// SseEvent — discriminated union (platform boundary type)
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every SSE event type emitted by the restore orchestrator.
 *
 * The `type` field is the discriminant. Clients MUST handle all members of this
 * union or explicitly ignore unknown types via a default branch.
 *
 * ## Event ordering invariants
 *
 * 1. `phase_started` for phase N is always emitted before any `phase_progress`
 *    or `phase_completed` for that phase.
 * 2. `phase_completed` for phase N is always emitted before `phase_started` for
 *    phase N+1.
 * 3. The stream ends with exactly one of: `job_failed` | `job_completed`.
 * 4. `conflict_pause` / `conflict_resumed` pairs appear inside the running phase
 *    envelope (between `phase_started` and `phase_completed`).
 * 5. `post_issue_sub_phase` events appear inside the
 *    `comment-attachment-subtask-issuelink` phase envelope.
 *
 * Inputs:  JSON-deserialized object from the SSE `data:` line
 * Outputs: typed discriminated union for exhaustive switch handling
 * Failure: unknown `type` values should be treated as no-ops (forward-compat)
 *
 * Source: T5 §5.2, §6.2, §6.2b.
 */
export type SseEvent =
  | PhaseStartedEvent
  | PhaseProgressEvent
  | PhaseCompletedEvent
  | HeartbeatEvent
  | JobFailedEvent
  | JobCompletedEvent
  | ConflictPauseEvent
  | ConflictResumedEvent
  | PostIssueSubPhaseEvent;

// ---------------------------------------------------------------------------
// RestorePhaseValue — string-literal union for SSE event phase fields
// ---------------------------------------------------------------------------

/**
 * String-literal union of all restore phase values as they appear in SSE events.
 *
 * These values correspond to the `RestorePhase` enum string values defined in
 * `src/workload/restore/types.ts`. They are reproduced here as a plain union
 * type so that platform-layer consumers (e.g. the SSE router and UI) can
 * reference the phase identifiers without depending on workload internals.
 *
 * **Dependency order** (must not be reordered):
 * ```
 * site-reference-data → project → workflow → custom-field
 *   → board (scope re-check here) → sprint → issue
 *   → comment-attachment-subtask-issuelink (post-issue pass)
 * ```
 *
 * Inputs:  n/a — purely a structural type
 * Outputs: type-safe phase identifier for SSE event fields
 * Failure: n/a
 *
 * Source: T1 §1, T5 §5.2.
 */
export type RestorePhaseValue =
  | 'site-reference-data'
  | 'project'
  | 'workflow'
  | 'custom-field'
  | 'board'
  | 'sprint'
  | 'issue'
  | 'comment-attachment-subtask-issuelink';

// ---------------------------------------------------------------------------
// Cadence constants (re-stated for platform consumers)
// ---------------------------------------------------------------------------

/**
 * Maximum milliseconds between consecutive SSE events during a running phase.
 *
 * The orchestrator MUST emit at least one event every 10 s. If it does not,
 * the platform transitions the job to `'stalled'` when `STALLED_THRESHOLD_MS`
 * elapses (T5 §6.2).
 *
 * Inputs:  n/a
 * Outputs: numeric constant consumed by the stalled-detection timer
 * Failure: n/a
 */
export const MAX_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Milliseconds of silence after which the platform transitions a job to `'stalled'`.
 *
 * This threshold is checked by the platform layer, not the orchestrator. The UI
 * must surface a stalled alert when no SSE event has been received for this
 * duration (T5 §6.2).
 *
 * Inputs:  n/a
 * Outputs: numeric constant consumed by the stalled-detection timer
 * Failure: n/a
 */
export const STALLED_THRESHOLD_MS = 20_000;
