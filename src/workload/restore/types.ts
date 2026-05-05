/**
 * Restore Subsystem — type contracts for Sprint 1 of Phase 4.
 *
 * Defines the boundary contracts for the restore orchestrator:
 *   - RestoreJob: the job record shape (jobId, conflictMode, destination,
 *     backupPointId, selection)
 *   - RestorePhase enum: dependency-ordered write phases (strictly ordered)
 *   - RESTORE_PHASE_ORDER: canonical, immutable phase sequence
 *   - RestoreSseEvent: discriminated union for SSE event stream
 *       (phase_started, phase_completed, phase_progress, job_failed,
 *        job_completed)
 *   - IRestoreOrchestrator: orchestrator interface
 *
 * This file is the contract every other restore task in the sprint codes against.
 * Source: T1 §1, T5 §5.1, §5.2, §6.2, §6.2b
 */

// ---------------------------------------------------------------------------
// RestoreJob Shape
// ---------------------------------------------------------------------------

/** Conflict resolution mode for restore. Default is 'skip'. Source: T5 §5.1. */
export type ConflictMode = 'override' | 'skip' | 'ask';

/** Restore destination type. Cross-site restore is not supported in Phase 1. Source: T5 §5.2. */
export type RestoreDestinationType = 'original' | 'alternate' | 'export';

/** Job lifecycle status values — mirrors JobStatus in ProgressEvent.ts. */
export type RestoreJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'stalled';

/**
 * Restore job record — the authoritative in-flight and stored representation
 * of a restore job.
 *
 * jobId:         opaque restore job identifier (UUID)
 * connectionId:  the connection on which the restore runs
 * conflictMode:  conflict resolution strategy (default: 'skip', T5 §5.1)
 * destination:   where to restore to (default: 'original', T5 §5.2)
 * backupPointId: the backup point from which items are restored
 * selection:     item IDs selected for restore (Issue keys, project IDs, etc.)
 *
 * Source: T5 §5.1, §5.2
 */
export interface RestoreJob {
  /** Opaque restore job identifier (UUID). */
  jobId: string;
  /** connectionId of the Jira site connection this job runs against. */
  connectionId: string;
  /** Conflict resolution strategy. Default is 'skip'. Source: T5 §5.1. */
  conflictMode: ConflictMode;
  /** Destination type for restored objects. Source: T5 §5.2. */
  destination: RestoreDestinationType;
  /**
   * Additional destination context — present only when destination === 'alternate'.
   * cloudId and projectKey identify the alternate location on the same Jira site.
   * Cross-site restore (different cloudId) is not supported in Phase 1.
   * Source: T5 §5.2.
   */
  alternateDestination?: { cloudId: string; projectKey: string };
  /** UUID of the backup point from which items are restored. */
  backupPointId: string;
  /**
   * Item IDs selected for restore.
   * Issue keys (e.g. "PROJ-42"), project IDs, board IDs, or sprint IDs.
   */
  selection: string[];
  /** Current lifecycle status of this job. */
  status: RestoreJobStatus;
  /** ISO-8601 timestamp when the job was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the job completed (null while running or pending). */
  completedAt: string | null;
  /** Count of items successfully restored across all completed phases. */
  restoredCount: number;
  /**
   * Count of item-level errors accumulated across all phases.
   * When > 0, the UI MUST display "Completed with N errors" (T5 §6.2b).
   */
  errorCount: number;
  /**
   * Human-readable diagnostic emitted when a phase fails and halts execution.
   * Format: "<phase-name> phase: <reason>".
   * Present only when status === 'failed'. Source: T5 §5.2.
   */
  phaseDiagnostic?: string;
}

// ---------------------------------------------------------------------------
// RestorePhase Enum — mandatory write-dependency order
// ---------------------------------------------------------------------------

/**
 * Dependency-ordered write phases for the restore orchestrator.
 *
 * Phases MUST execute in exactly this order. A failure in any phase halts
 * execution immediately; subsequent phases are not started. A named diagnostic
 * is surfaced before the next phase would have begun. Source: T1 §1, T5 §5.2.
 *
 * Restore write order (mirror of capture order):
 *
 *   site-reference-data
 *     → project
 *     → workflow
 *     → custom-field
 *     → board                ← pre-restore scope re-check here (both
 *     → sprint                  write:board-scope:jira-software variants)
 *     → issue
 *     → comment-attachment-subtask-issuelink  (post-issue-creation pass)
 *
 * The comment-attachment-subtask-issuelink phase is a single combined pass that
 * restores comments, attachment binaries, subtask linkages, and issue links in
 * the correct order to avoid forward-reference failures.
 *
 * Use RESTORE_PHASE_ORDER to iterate in the required sequence.
 * The enum form enables runtime iteration via Object.values(RestorePhase)
 * and exhaustive switch checking at compile time.
 */
export enum RestorePhase {
  SiteReferenceData               = 'site-reference-data',
  Project                         = 'project',
  Workflow                        = 'workflow',
  CustomField                     = 'custom-field',
  Board                           = 'board',
  Sprint                          = 'sprint',
  Issue                           = 'issue',
  CommentAttachmentSubtaskIssuelink = 'comment-attachment-subtask-issuelink',
}

/**
 * Canonical, immutable restore phase execution order.
 * Implementations MUST iterate phases in exactly this sequence.
 * Source: T1 §1, T5 §5.2.
 */
export const RESTORE_PHASE_ORDER: readonly RestorePhase[] = [
  RestorePhase.SiteReferenceData,
  RestorePhase.Project,
  RestorePhase.Workflow,
  RestorePhase.CustomField,
  RestorePhase.Board,
  RestorePhase.Sprint,
  RestorePhase.Issue,
  RestorePhase.CommentAttachmentSubtaskIssuelink,
] as const;

// ---------------------------------------------------------------------------
// SSE Event Schema — RestoreSseEvent discriminated union
// ---------------------------------------------------------------------------

/** Base fields present in every SSE event emitted by the restore orchestrator. */
export interface RestoreSseEventBase {
  /** Restore job ID this event belongs to. */
  jobId: string;
  /** ISO-8601 timestamp of event emission. */
  ts: string;
}

/**
 * Emitted once when a restore phase begins execution.
 * Always precedes the first phase_progress event for that phase.
 */
export interface PhaseStartedEvent extends RestoreSseEventBase {
  type: 'phase_started';
  phase: RestorePhase;
}

/**
 * Emitted once when a restore phase completes successfully.
 * Always follows the last phase_progress event for that phase.
 */
export interface PhaseCompletedEvent extends RestoreSseEventBase {
  type: 'phase_completed';
  phase: RestorePhase;
  /** Items successfully restored in this phase. */
  restoredCount: number;
  /** Item-level errors encountered in this phase. */
  errorCount: number;
}

/**
 * Heartbeat progress event, emitted at most every 10 seconds within a phase.
 *
 * The orchestrator MUST emit at least one event every 10 s (MAX_HEARTBEAT_INTERVAL_MS).
 * A gap of >20 s surfaces a 'stalled' alert in the UI (STALLED_THRESHOLD_MS, T5 §6.2).
 */
export interface PhaseProgressEvent extends RestoreSseEventBase {
  type: 'phase_progress';
  phase: RestorePhase;
  /** Items processed so far in this phase. */
  processed: number;
  /** Total items to process in this phase; null when not yet known. */
  total: number | null;
}

/**
 * Emitted when a phase fails and execution halts immediately.
 *
 * error.code is always 'dependency_phase_failed'.
 * error.phase identifies the phase whose failure halted the restore.
 * error.message is a human-readable diagnostic surfaced to the operator.
 *
 * Subsequent phases in RESTORE_PHASE_ORDER are NOT started after this event.
 * Source: T5 §5.2.
 */
export interface JobFailedEvent extends RestoreSseEventBase {
  type: 'job_failed';
  error: {
    /** Always 'dependency_phase_failed'. Source: T5 §5.2. */
    code: 'dependency_phase_failed';
    /** The phase whose failure halted the restore. */
    phase: RestorePhase;
    /** Human-readable diagnostic. */
    message: string;
  };
}

/**
 * Emitted once when all phases have completed (whether with or without errors).
 *
 * errors > 0 ⇒ job status is 'completed_with_errors' and the UI MUST display
 * "Completed with N errors", never "Completed successfully" (T5 §6.2b).
 *
 * This event is NOT emitted when a phase fails — job_failed is terminal in that case.
 */
export interface JobCompletedEvent extends RestoreSseEventBase {
  type: 'job_completed';
  /** Total item-level errors accumulated across all phases. */
  errors: number;
  /** Total items successfully restored across all phases. */
  restoredCount: number;
}

/**
 * Discriminated union of all restore SSE event types.
 *
 * Events are always emitted in phase order; no event is ever emitted out of
 * the sequence defined by RESTORE_PHASE_ORDER. The stream always ends with
 * either job_failed or job_completed.
 */
export type RestoreSseEvent =
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | PhaseProgressEvent
  | JobFailedEvent
  | JobCompletedEvent;

// ---------------------------------------------------------------------------
// Restore Orchestrator Interface
// ---------------------------------------------------------------------------

/** Phase result record produced by the restore orchestrator per phase. */
export interface RestorePhaseResult {
  phase: RestorePhase;
  status: 'ok' | 'partial' | 'failed';
  /** Items successfully restored in this phase. */
  restoredCount: number;
  /** Item-level errors in this phase. */
  errorCount: number;
  /** Human-readable diagnostic; present when status === 'failed'. */
  diagnostic?: string;
}

/** Options consumed by IRestoreOrchestrator.runRestore(). */
export interface RestoreRunOptions {
  jobId: string;
  connectionId: string;
  /** Atlassian site cloudId (stable site identifier). */
  cloudId: string;
  /** Base URL for the site, e.g. https://api.atlassian.com/ex/jira/{cloudId} */
  cloudBaseUrl: string;
  backupPointId: string;
  selection: string[];
  conflictMode: ConflictMode;
  destination: RestoreDestinationType;
  /** Required when destination === 'alternate'. Source: T5 §5.2. */
  alternateDestination?: { cloudId: string; projectKey: string };
}

/** Result returned by IRestoreOrchestrator.runRestore(). */
export interface RestoreRunResult {
  jobId: string;
  /** ISO-8601 timestamp when the job completed. */
  completedAt: string;
  phaseResults: RestorePhaseResult[];
  /** Total items successfully restored across all phases. */
  restoredCount: number;
  /** Total item-level errors accumulated across all phases. */
  errorCount: number;
  /**
   * Set when any phase halts with status 'failed'. Subsequent phases are not
   * executed. Format: "<phase-name> phase: <reason>". Source: T5 §5.2.
   */
  phaseDiagnostic?: string;
}

/**
 * Restore orchestrator interface.
 *
 * Implementations MUST:
 *   1. Execute phases in RESTORE_PHASE_ORDER; no phase may be skipped or
 *      reordered.
 *   2. Halt on the first phase failure, set phaseDiagnostic, and emit
 *      job_failed before returning. Subsequent phases are not started.
 *   3. Emit SSE events strictly in dependency order — never out of sequence.
 *   4. Call onEvent with a phase_progress event at most every 10 seconds.
 *      A gap of >20 s surfaces a 'stalled' alert in the UI (T5 §6.2).
 *   5. Return errorCount > 0 when any item-level error occurs. The UI MUST
 *      display "Completed with N errors", not "Completed successfully"
 *      (T5 §6.2b).
 *   6. Perform a pre-restore scope re-check (including both
 *      write:board-scope:jira-software variants) before the Board phase begins.
 *      Emit job_failed with code 'dependency_phase_failed' if scopes are
 *      insufficient.
 *   7. Detect Atlassian native trash: if a selected project is in the 30–60 d
 *      trash window, block in-place restore and force the alternate-location
 *      path. Emit a diagnostic in RestoreRunResult.
 *   8. After the comment-attachment-subtask-issuelink phase, emit a best-effort
 *      ADF media-link rewrite warning in the restore report when attachment IDs
 *      have changed (T5 OQ-5).
 *
 * Source: T1 §1, T5 §5.2, §6.2.
 */
export interface IRestoreOrchestrator {
  runRestore(
    options: RestoreRunOptions,
    onEvent: (event: RestoreSseEvent) => void
  ): Promise<RestoreRunResult>;
}
