/**
 * Snapshot Orchestrator — type contracts for Sprint 2 of Phase 2.
 *
 * Defines Snapshot-phase-specific contracts:
 *   - SnapshotPhase enum: dependency-ordered capture phases as a TypeScript enum
 *   - SNAPSHOT_PHASE_ORDER: canonical, immutable phase sequence
 *   - PhaseEmitBoundary / PHASE_EMIT_BOUNDARIES: per-phase emit and persist checkpoints
 *   - IssuePayload: full Issue capture contract satisfying the coverage invariant
 *   - SearchLogLine: structured-log shape for [search] lines
 *   - FieldContextLogLine: structured-log shape for [field-context] lines
 *   - PAGINATION_TERMINATION_CONTRACT: verbatim termination rule for POST /rest/api/3/search/jql
 *
 * Source: T1 §1, T2 §6 Constraints 6–7, T3 §3.3–§3.5, T5 §6.2
 */

import type {
  AdfNode,
  IssueComment,
  IssueLink,
  AttachmentRecord,
  WorklogEntry,
} from '../backup/types.js';

export type { AdfNode, IssueComment, IssueLink, AttachmentRecord, WorklogEntry };

// ---------------------------------------------------------------------------
// Snapshot Phase Enum
// ---------------------------------------------------------------------------

/**
 * Dependency-ordered capture phases for the Snapshot orchestrator.
 *
 * Context nodes (IssueType through WorkflowScheme) are captured before
 * Protected Objects (Project through Issue) in every backup job.
 * The sequence is mandatory; no phase may be skipped or reordered.
 * Source: T1 §1, T3 §3.4.
 *
 * Use SNAPSHOT_PHASE_ORDER to iterate in the required sequence.
 * The enum form (vs CapturePhase string union in backup/types.ts) enables
 * runtime iteration via Object.values(SnapshotPhase) and exhaustive switch
 * checking at compile time.
 */
export enum SnapshotPhase {
  IssueType          = 'IssueType',
  CustomField        = 'CustomField',
  FieldConfiguration = 'FieldConfiguration',
  Workflow           = 'Workflow',
  WorkflowScheme     = 'WorkflowScheme',
  Project            = 'Project',
  Board              = 'Board',
  Sprint             = 'Sprint',
  Issue              = 'Issue',
}

/**
 * Canonical, immutable phase execution order.
 * Implementations MUST iterate phases in exactly this sequence.
 * Source: T1 §1, T3 §3.4.
 */
export const SNAPSHOT_PHASE_ORDER: readonly SnapshotPhase[] = [
  SnapshotPhase.IssueType,
  SnapshotPhase.CustomField,
  SnapshotPhase.FieldConfiguration,
  SnapshotPhase.Workflow,
  SnapshotPhase.WorkflowScheme,
  SnapshotPhase.Project,
  SnapshotPhase.Board,
  SnapshotPhase.Sprint,
  SnapshotPhase.Issue,
] as const;

// ---------------------------------------------------------------------------
// Per-Phase Emit/Persist Boundaries
// ---------------------------------------------------------------------------

/**
 * Describes when a phase emits progress events and when it persists results.
 * Documents and enforces phase-level checkpointing behaviour (T5 §6.2).
 */
export interface PhaseEmitBoundary {
  phase: SnapshotPhase;
  /**
   * Maximum interval in seconds between emitted progress events.
   * Contract: ≤10 s. A gap of >20 s surfaces a 'stalled' alert (T5 §6.2).
   */
  maxEmitIntervalSeconds: 10;
  /**
   * True when all phase items are persisted atomically at phase completion.
   * False when items are persisted incrementally (e.g. paginated Issue writes).
   */
  persistsAtPhaseEnd: boolean;
  /**
   * All phases are sequential — a phase must complete before the next begins.
   * This field is always true; it is present to make the invariant explicit.
   */
  blocksNextPhase: true;
}

/**
 * Per-phase emit/persist boundary table.
 *
 * All phases: maxEmitIntervalSeconds=10, blocksNextPhase=true.
 * Issue is the only phase that persists incrementally (one page at a time)
 * rather than waiting for all items to be fetched first.
 */
export const PHASE_EMIT_BOUNDARIES: Record<SnapshotPhase, PhaseEmitBoundary> = {
  [SnapshotPhase.IssueType]:          { phase: SnapshotPhase.IssueType,          maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.CustomField]:        { phase: SnapshotPhase.CustomField,        maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.FieldConfiguration]: { phase: SnapshotPhase.FieldConfiguration, maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.Workflow]:           { phase: SnapshotPhase.Workflow,           maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.WorkflowScheme]:     { phase: SnapshotPhase.WorkflowScheme,     maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.Project]:            { phase: SnapshotPhase.Project,            maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.Board]:              { phase: SnapshotPhase.Board,              maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.Sprint]:             { phase: SnapshotPhase.Sprint,             maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: true,  blocksNextPhase: true },
  [SnapshotPhase.Issue]:              { phase: SnapshotPhase.Issue,              maxEmitIntervalSeconds: 10, persistsAtPhaseEnd: false, blocksNextPhase: true },
};

// ---------------------------------------------------------------------------
// IssuePayload — Full Issue capture shape (Coverage Invariant)
// ---------------------------------------------------------------------------

/**
 * Full Issue payload captured during the Snapshot Issue phase.
 *
 * Every field defined in T3 §3.3 must be present; no field is silently skipped.
 * customFieldValues must contain every custom field (custom: true) returned by
 * the API — the map must not drop any entry. This is the coverage invariant
 * (T3 §3.5).
 *
 * Relationship to IssueRecord (src/workload/backup/types.ts):
 *   IssuePayload is the in-flight Snapshot-phase contract produced by the
 *   orchestrator. IssueRecord is the persisted DB artifact that adds
 *   backupPointId and capturedAt. They share the same field set.
 */
export interface IssuePayload {
  /** Atlassian Issue ID (numeric string). */
  id: string;
  /** Issue key, e.g. "PROJ-42". */
  key: string;
  /** Atlassian numeric project ID (string form). */
  projectId: string;

  // System fields — all required; none may be omitted (T3 §3.3)
  summary: string;
  description: AdfNode | null;
  issueType: { id: string; name: string };
  status: { id: string; name: string };
  priority: { id: string; name: string } | null;
  assignee: { accountId: string; displayName: string } | null;
  reporter: { accountId: string; displayName: string } | null;
  created: string;
  updated: string;
  resolutionDate: string | null;
  labels: string[];

  /**
   * All custom field values keyed by Atlassian field ID (e.g. "customfield_10016").
   * Coverage invariant: every custom field (custom: true) returned by the API for
   * this Issue must appear here — no entry may be dropped (T3 §3.5).
   * System fields (custom: false) must not appear in this map.
   */
  customFieldValues: Record<string, unknown>;

  /** All comments — ADF body, author accountId + displayName, timestamps (T3 §3.3). */
  comments: IssueComment[];

  /**
   * All issue links, both inward and outward directions, all link types.
   * Source: T3 §3.3.
   */
  issueLinks: IssueLink[];

  /** Keys of direct subtask Issues. */
  subtaskKeys: string[];

  /** Sprint IDs this Issue belongs to. An Issue may belong to multiple sprints. */
  sprintIds: string[];

  /** accountIds of all Issue watchers. */
  watcherAccountIds: string[];

  /** Worklog entries recorded against this Issue. */
  worklogs: WorklogEntry[];

  /**
   * Attachment references. Binaries are stored separately via
   * IJiraHttpClient.downloadAttachment() and verified by contentHash.
   * Source: T3 §3.2, §3.3, §4.4.
   */
  attachments: AttachmentRecord[];
}

// ---------------------------------------------------------------------------
// Structured-Log Line Shapes
// ---------------------------------------------------------------------------

/**
 * Structured-log line emitted once per pagination request to POST /rest/api/3/search/jql.
 *
 * Verbatim serialised format:
 *   [search] project=<projectKey> jql="<jql>" startAt=<startAt> maxResults=<maxResults> returned=<returned> total=<total>
 *
 * Example (3-page run, PROJ, 243 issues, maxResults=100):
 *   [search] project=PROJ jql="project = PROJ ORDER BY created ASC" startAt=0 maxResults=100 returned=100 total=243
 *   [search] project=PROJ jql="project = PROJ ORDER BY created ASC" startAt=100 maxResults=100 returned=100 total=243
 *   [search] project=PROJ jql="project = PROJ ORDER BY created ASC" startAt=200 maxResults=100 returned=43 total=243
 *   — pagination terminates because returned(43) < maxResults(100)
 *
 * Source: T2 §6 Constraint 6.
 */
export interface SearchLogLine {
  /** Fixed prefix tag — always the literal string "[search]". */
  tag: '[search]';
  projectKey: string;
  jql: string;
  startAt: number;
  maxResults: number;
  /** Number of issues actually returned in this page (issues.length). */
  returned: number;
  /** total field from JqlSearchResponse. */
  total: number;
}

/**
 * Structured-log line emitted once per field during custom-field context discovery.
 *
 * Two mutually exclusive variants — skip (system field) and fetch (custom field).
 *
 * Verbatim format — skip (custom: false, system field):
 *   [field-context] skip field_id=<id> reason=system-field
 *
 * Verbatim format — fetch (custom: true, custom field):
 *   [field-context] fetch field_id=<id> contextCount=<n>
 *
 * Constraint: GET /rest/api/3/field/{id}/context is called ONLY for fields
 * where custom: true. Every system field (custom: false) produces a skip line
 * and is never passed to the context endpoint (T2 §6 Constraint 7, T3 §4.2).
 */
export type FieldContextLogLine =
  | {
      tag: '[field-context]';
      action: 'skip';
      fieldId: string;
      /** Always 'system-field' — the only valid skip reason in Phase 1. */
      reason: 'system-field';
    }
  | {
      tag: '[field-context]';
      action: 'fetch';
      fieldId: string;
      /** Number of contexts returned by GET /rest/api/3/field/{id}/context. */
      contextCount: number;
    };

// ---------------------------------------------------------------------------
// Pagination Termination Contract
// ---------------------------------------------------------------------------

/**
 * Verbatim pagination termination rule for POST /rest/api/3/search/jql.
 *
 * The paginator MUST stop requesting new pages when either condition is true:
 *
 *   issues.length === 0         — empty page; no more results exist.
 *   issues.length < maxResults  — partial page; this is the final page.
 *
 * Combined: terminate when (issues.length === 0 || issues.length < maxResults).
 *
 * The deprecated GET /rest/api/3/search endpoint must NOT appear anywhere in
 * backup-engine code (T2 §6 Constraint 6).
 *
 * Source: T2 §6 Constraint 6, CLAUDE.md Goals §8.
 */
export const PAGINATION_TERMINATION_CONTRACT = {
  endpoint: 'POST /rest/api/3/search/jql',
  terminateWhen: 'issues.length === 0 || issues.length < maxResults',
  forbiddenEndpoint: 'GET /rest/api/3/search',
  source: 'T2 §6 Constraint 6',
} as const;
