/**
 * Progress event contracts — Sprint 3, Phase 2.
 *
 * Defines the ProgressEvent shape emitted by backup and restore jobs,
 * heartbeat cadence constants, the stalled-detection threshold, and
 * terminal JobStatus semantics.
 *
 * Contract summary:
 *   - One event emitted at most every MAX_HEARTBEAT_INTERVAL_MS (10 000 ms).
 *   - A gap of >STALLED_THRESHOLD_MS (20 000 ms) surfaces a 'stalled' alert.
 *   - When errorCount > 0 at completion, status = 'completed_with_errors'.
 *     The UI displays "Completed with N errors" — never "Completed successfully".
 *
 * Source: T5 §6.2, T5 §6.2b.
 */

/**
 * Error record attached to a ProgressEvent when an individual item fails.
 * Accumulated in the `errors` array across all phases of the same job.
 */
export interface ProgressError {
  /** Item identifier — Issue key ("PROJ-42"), project ID, attachment ID, etc. */
  itemId: string;
  /** Human-readable error message. */
  message: string;
  /** Capture or restore phase in which the error occurred (e.g. "Issue"). */
  phase: string;
}

/**
 * Progress event emitted by backup and restore jobs on the ≤10 s heartbeat.
 *
 * Both backup (CaptureOrchestrator) and restore jobs use this shape so the
 * platform layer can handle them uniformly. The `phase` field narrows which
 * capture/restore phase is currently active.
 *
 * Invariants:
 *   - `ts` is always an ISO-8601 string set at the moment of emission.
 *   - `total` is null while the orchestrator has not yet determined the
 *     total item count for the current phase (e.g. first pagination page).
 *   - `errors` accumulates across the full job lifetime; it is never reset
 *     between phases so the consumer always sees the running total.
 *
 * Source: T5 §6.2, T5 §6.2b.
 */
export interface ProgressEvent {
  /** Opaque job identifier (backup-point ID or restore job ID). */
  jobId: string;
  /** ISO-8601 timestamp at the moment this event was emitted. */
  ts: string;
  /** Current capture or restore phase name (e.g. "Issue", "Sprint"). */
  phase: string;
  /** Items successfully processed so far in the current phase. */
  processed: number;
  /** Total items expected in the current phase. null when not yet known. */
  total: number | null;
  /** All item-level errors accumulated across phases up to this event. */
  errors: ProgressError[];
}

/**
 * Terminal and non-terminal job status values.
 *
 * Transitions:
 *   pending → running → completed | completed_with_errors | failed
 *   running → stalled  (platform-set when no heartbeat for >STALLED_THRESHOLD_MS)
 *
 * 'completed_with_errors' is set when the job finishes but errors.length > 0.
 * The UI MUST display "Completed with N errors" — never "Completed successfully".
 *
 * Source: T5 §6.2, T5 §6.2b.
 */
export type JobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'stalled';

/** Maximum milliseconds between emitted heartbeat events (T5 §6.2). */
export const MAX_HEARTBEAT_INTERVAL_MS = 10_000 as const;

/** Milliseconds of silence after which the platform marks a job 'stalled' (T5 §6.2). */
export const STALLED_THRESHOLD_MS = 20_000 as const;
