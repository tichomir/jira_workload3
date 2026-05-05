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

// ---------------------------------------------------------------------------
// Post-Issue-Creation Pass — sub-phase SSE events
// ---------------------------------------------------------------------------

/** The three sequential sub-phases within the post-issue-creation pass. */
export type PostIssueSubPhase = 'comment' | 'subtask' | 'issuelink';

/**
 * Emitted once per sub-phase within the comment-attachment-subtask-issuelink
 * phase, after that sub-phase finishes processing all items.
 *
 * Ordering guarantee: comment event precedes subtask, subtask precedes
 * issuelink. All three appear after the phase_completed event for the Issue
 * phase and inside the phase_started / phase_completed envelope of the
 * CommentAttachmentSubtaskIssuelink phase.
 */
export interface PostIssueSubPhaseEvent extends RestoreSseEventBase {
  type: 'post_issue_sub_phase';
  /** Which sub-phase within the post-issue pass completed. */
  subPhase: PostIssueSubPhase;
  /** Items successfully restored in this sub-phase. */
  restored: number;
  /** Item-level errors in this sub-phase. */
  errors: number;
  /** Total items attempted in this sub-phase. */
  attempted: number;
}

/**
 * Discriminated union of all restore SSE event types.
 *
 * Events are always emitted in phase order; no event is ever emitted out of
 * the sequence defined by RESTORE_PHASE_ORDER. The stream always ends with
 * either job_failed or job_completed.
 *
 * When conflictMode === 'ask', the stream may include conflict_pause /
 * conflict_resumed pairs mid-phase. The stream remains open during the pause;
 * execution is blocked until the operator submits a ConflictDecision via
 * POST /api/restore-jobs/{id}/conflict-decision.
 */
export type RestoreSseEvent =
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | PhaseProgressEvent
  | JobFailedEvent
  | JobCompletedEvent
  | ConflictPauseEvent
  | ConflictResumedEvent
  | PostIssueSubPhaseEvent;

// ---------------------------------------------------------------------------
// Pre-Restore Guard Contracts
// ---------------------------------------------------------------------------

/**
 * Identifies which pre-restore guard produced a result.
 *
 * 'board-scope-recheck' — verifies write:board-scope:jira-software AND
 *   write:board-scope.admin:jira-software are present in the token's scope
 *   list before the Board phase begins.
 *
 * 'trash-detection' — checks each selected project's Atlassian trash status
 *   during the Project phase. Forces alternate-location when a project is in
 *   the 30–60 d trash window and destination === 'original'.
 */
export type RestoreGuardName = 'board-scope-recheck' | 'trash-detection';

/**
 * Result of a pre-restore guard check.
 *
 * passed:          true when the guard condition is satisfied; the phase proceeds.
 * guardName:       identifies which guard produced this result.
 * failureCode:     machine-readable code set when passed === false.
 *   'scope_missing'    — one or more required board scopes absent from the token.
 *   'project_in_trash' — project is in Atlassian native trash AND destination
 *                        === 'original'. NOT a fatal failure; forces alternate-location.
 * failureMessage:  human-readable explanation for the operator; present when
 *                  passed === false.
 * missingScopes:   (board-scope-recheck only) exact scope strings absent from
 *                  the token. Always contains at least one entry when
 *                  failureCode === 'scope_missing'.
 *
 * NOTE: 'board-scope-recheck' with passed === false triggers job_failed and
 * halts execution. 'trash-detection' with passed === false forces
 * alternate-location but does NOT halt execution.
 */
export interface GuardResult {
  passed: boolean;
  guardName: RestoreGuardName;
  failureCode?: 'scope_missing' | 'project_in_trash';
  failureMessage?: string;
  missingScopes?: string[];
}

/**
 * Atlassian native trash-window status for a project.
 *
 * Atlassian manages a 60-day project trash window. A project can be either
 * live (inTrash: false) or in the trash (inTrash: true, daysInTrash 1–60).
 *
 * When inTrash === true AND destination === 'original':
 *   - In-place restore is BLOCKED.
 *   - The orchestrator MUST force destination === 'alternate' (same site).
 *   - A diagnostic is written to RestoreRunResult.trashDetectionResults[].
 *   - Execution continues (not a job_failed condition).
 *
 * Restoring from the Atlassian trash UI is out of scope in Phase 1 (T5 §4.2,
 * CLAUDE.md Non-Goals).
 *
 * Source: T5 §4.2.
 */
export interface TrashStatus {
  /** Atlassian numeric project ID (string form). */
  projectId: string;
  /** Jira project key, e.g. "PROJ". */
  projectKey: string;
  /** true when the project is in the Atlassian-managed trash. */
  inTrash: boolean;
  /** ISO-8601 timestamp when the project was moved to trash. Present when inTrash === true. */
  trashedAt?: string;
  /**
   * Days the project has been in trash (1–60). Present when inTrash === true.
   * At 61 days Atlassian permanently deletes the project; only 1–60 is observable.
   */
  daysInTrash?: number;
  /**
   * true when inTrash === true AND the restore destination was 'original'.
   * The orchestrator reads this flag to decide whether to force alternate-location.
   */
  alternateLocationRequired: boolean;
}

// ---------------------------------------------------------------------------
// Post-Issue-Creation Pass Contract
// ---------------------------------------------------------------------------

/**
 * Counts produced by the comment-attachment-subtask-issuelink phase.
 *
 * Present in RestoreRunResult.postIssuePassReport after the phase completes.
 * All counts are per-item (comment, attachment, link), not per-issue.
 *
 * Ordering within the pass (per issue, strictly sequential):
 *   1. Comments   — POST /rest/api/3/issue/{id}/comment (preserves authored order)
 *   2. Attachments — POST /rest/api/3/issue/{id}/attachments (multipart upload)
 *   3. Subtask links — POST /rest/api/3/issueLink (type=subtask, inward direction)
 *   4. Issue links  — POST /rest/api/3/issueLink (all other link types)
 *
 * An error in any individual item is recorded and counted; it does NOT halt
 * the pass. The pass continues with the next item. Total errors accumulate in
 * RestoreRunResult.errorCount (T5 §6.2b).
 *
 * adfMediaLinkWarning is true when ≥1 restored attachment received a new
 * Atlassian-assigned attachmentId (i.e. the ID differs from the backed-up ID).
 * When true, ADF media node references in Issue descriptions and comments may
 * be broken. Full rewrite is a Phase 2 item (T5 OQ-5).
 *
 * Source: T5 §5.2, §6.2b, OQ-5.
 */
export interface PostIssuePassReport {
  /** Comments successfully written via POST /rest/api/3/issue/{id}/comment. */
  commentsRestored: number;
  /** Comment-level errors (per comment, not per issue). */
  commentErrors: number;
  /** Attachments successfully uploaded via POST /rest/api/3/issue/{id}/attachments. */
  attachmentsRestored: number;
  /** Attachment-level errors (per attachment). */
  attachmentErrors: number;
  /** Subtask linkages successfully created via POST /rest/api/3/issueLink. */
  subtaskLinksRestored: number;
  /** Subtask link errors. */
  subtaskLinkErrors: number;
  /** Issue links (non-subtask) successfully created via POST /rest/api/3/issueLink. */
  issueLinksRestored: number;
  /** Issue-link errors. */
  issueLinkErrors: number;
  /**
   * true when ≥1 restored attachment received a new Atlassian-assigned attachmentId.
   * Triggers best-effort ADF media-link warning in the restore report (T5 OQ-5).
   */
  adfMediaLinkWarning: boolean;
  /**
   * Issue keys where at least one attachment ID changed post-restore.
   * Populated when adfMediaLinkWarning === true; empty array otherwise.
   */
  adfMediaLinkAffectedIssueKeys: string[];
}

// ---------------------------------------------------------------------------
// Conflict Mode — 'ask' per-conflict SSE Events and Decision Contract
// ---------------------------------------------------------------------------

/**
 * Conflict kinds that can trigger a pause event in conflictMode === 'ask'.
 *
 * 'item_exists'    — an Issue with the same key already exists on the target site.
 * 'project_exists' — a Project with the same key already exists.
 * 'board_exists'   — a Board with the same name already exists in the target project.
 * 'sprint_exists'  — a Sprint with the same name already exists on the target board.
 */
export type ConflictType =
  | 'item_exists'
  | 'project_exists'
  | 'board_exists'
  | 'sprint_exists';

/**
 * SSE event emitted when conflictMode === 'ask' and the orchestrator
 * detects a conflict on the target Jira site.
 *
 * On emit, the orchestrator BLOCKS execution for the conflicting item and
 * awaits a ConflictDecision delivered via
 * POST /api/restore-jobs/{id}/conflict-decision.
 *
 * The SSE stream does NOT close during the pause — the client must remain
 * connected to receive the subsequent conflict_resumed event.
 *
 * Event ordering: always emitted inside the phase_started / phase_completed
 * envelope of the current phase. Never emitted after phase_completed.
 */
export interface ConflictPauseEvent extends RestoreSseEventBase {
  type: 'conflict_pause';
  /** UUID identifying this conflict instance. Referenced by ConflictDecision.conflictId. */
  conflictId: string;
  /** Phase in which the conflict was detected. */
  phase: RestorePhase;
  /** ID of the item with the conflict (Issue key, project ID, board ID, sprint ID). */
  itemId: string;
  /** Structured kind of conflict — drives the UI conflict resolution dialog. */
  conflictType: ConflictType;
  /**
   * Lightweight snapshot of the existing item on the Jira site.
   * Shape is type-specific; not schema-bound — used for operator display only.
   * Example for 'item_exists': { key: "PROJ-42", summary: "...", status: "Done" }
   */
  existingItemSummary: Record<string, unknown>;
}

/**
 * SSE event emitted after a ConflictDecision is received and applied.
 *
 * Always follows a conflict_pause event with the same conflictId.
 * After this event the orchestrator resumes normal phase execution.
 */
export interface ConflictResumedEvent extends RestoreSseEventBase {
  type: 'conflict_resumed';
  /** UUID matching the corresponding conflict_pause event. */
  conflictId: string;
  /** Phase in which the conflict was resolved. */
  phase: RestorePhase;
  /** Item ID that was involved in the conflict. */
  itemId: string;
  /** The decision applied by the orchestrator. */
  decision: 'override' | 'skip';
}

/**
 * Operator-supplied decision resolving a conflict_pause event.
 *
 * Submitted via POST /api/restore-jobs/{id}/conflict-decision.
 * The route handler delivers this to the orchestrator, which awaits a
 * Promise keyed on conflictId before resuming.
 *
 * decision:   'override' — overwrite the existing item on the Jira site.
 *             'skip'     — leave the existing item untouched; move to next.
 * applyToAll: when true, all subsequent conflicts of the same conflictType
 *             in this restore job use the same decision without pausing.
 *             No further conflict_pause events are emitted for those conflicts.
 */
export interface ConflictDecision {
  /** UUID matching ConflictPauseEvent.conflictId. */
  conflictId: string;
  /** Item ID that has the conflict — echoed for validation. */
  itemId: string;
  /** Operator's chosen resolution. */
  decision: 'override' | 'skip';
  /** ISO-8601 timestamp when the operator submitted the decision. */
  decidedAt: string;
  /**
   * When true, applies this decision to all remaining conflicts of the same
   * conflictType. No further conflict_pause events are emitted for those items.
   */
  applyToAll: boolean;
}

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
  /**
   * One entry per project found in Atlassian's native trash during the Project
   * phase. Present (non-empty) when ≥1 selected project was in the trash window
   * and forced to alternate-location restore. Absent when trash detection found
   * no trashed projects.
   */
  trashDetectionResults?: TrashStatus[];
  /**
   * Detailed counts from the comment-attachment-subtask-issuelink phase.
   * Present after that phase completes (may be absent when a prior phase failed
   * before the post-issue pass was reached).
   */
  postIssuePassReport?: PostIssuePassReport;
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
