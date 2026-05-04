/**
 * Backup Engine — type contracts for Sprint 1 of Phase 2.
 *
 * Defines the canonical interfaces and types for:
 *   - IJiraHttpClient: authenticated HTTP client used by the backup engine
 *   - CapturePhase / CAPTURE_PHASE_ORDER: dependency-ordered capture sequence
 *   - ICaptureOrchestrator: orchestrator interface with phase progress events
 *   - BackupManifest, ProjectRecord, JsmDeferredProject: manifest schema
 *   - IssueRecord and embedded sub-types: full Issue payload (coverage invariant)
 *   - DiscoverRunResult, SnapshotRunResult: internal operation result shapes
 *
 * Source: T1 §1, T2 §4.5, T2 §6, T3 §3.2–§3.5, T4 §6, T5 §5.2
 */

// ---------------------------------------------------------------------------
// HTTP Client Interface
// ---------------------------------------------------------------------------

/** Raw JQL search request body for POST /rest/api/3/search/jql. */
export interface JqlSearchRequest {
  jql: string;
  startAt?: number;
  maxResults?: number;
  fields?: string[];
  expand?: string[];
  /** Cursor token for nextPageToken-based pagination. Omit on the first page. */
  nextPageToken?: string;
}

/** Paginated response from POST /rest/api/3/search/jql. */
export interface JqlSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: RawIssue[];
  /** Cursor for the next page; absent on the final page. */
  nextPageToken?: string;
}

/** Minimal Issue shape returned by the JQL search endpoint. */
export interface RawIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

/** Result of downloading an attachment binary. */
export interface AttachmentDownload {
  /** Raw bytes of the attachment — binary-faithful, no transcoding. */
  data: Buffer;
  /** MIME type from the Content-Type response header. */
  contentType: string;
  /** SHA-256 hex digest of data, computed immediately after download. */
  contentHash: string;
}

/**
 * Canonical authenticated HTTP client interface used by the backup engine.
 *
 * The concrete implementation is JiraHttpClient (src/workload/http/JiraHttpClient.ts).
 * This interface decouples the backup engine from transport and credential-store
 * concerns, and allows test doubles to be injected without touching the DB.
 *
 * Constraint: POST /rest/api/3/search/jql is the ONLY permitted Issue search
 * path. The deprecated GET /rest/api/3/search must not appear anywhere in
 * backup-engine code (T2 §6 Constraint 6).
 */
export interface IJiraHttpClient {
  /**
   * Perform an authenticated GET against a Jira Cloud REST path.
   * Returns the parsed JSON response body typed as T.
   * Caller is responsible for following pagination (startAt / maxResults / total).
   *
   * @param cloudBaseUrl  Base URL for the site, e.g. https://api.atlassian.com/ex/jira/{cloudId}
   * @param path          REST path, e.g. /rest/api/3/project/search
   * @param params        Optional query string parameters.
   */
  getJson<T>(cloudBaseUrl: string, path: string, params?: Record<string, string>): Promise<T>;

  /**
   * POST /rest/api/3/search/jql — the exclusive Issue enumeration endpoint.
   * Pagination must terminate when issues.length === 0 or issues.length < maxResults.
   * System fields (custom: false) must not be passed to context discovery after
   * this call returns (T2 §6 Constraint 7).
   *
   * @param cloudBaseUrl  Base URL for the site.
   * @param body          JQL search request body.
   */
  searchJql(cloudBaseUrl: string, body: JqlSearchRequest): Promise<JqlSearchResponse>;

  /**
   * Download an attachment binary via GET /rest/api/3/attachment/content/{id}.
   * Storage must be byte-for-byte identical to the source — no transcoding or
   * recompression. Returns raw bytes with a SHA-256 contentHash for integrity
   * verification (T3 §3.2, §4.4).
   *
   * @param cloudBaseUrl   Base URL for the site.
   * @param attachmentId   Jira attachment ID.
   */
  downloadAttachment(cloudBaseUrl: string, attachmentId: string): Promise<AttachmentDownload>;

  /**
   * Enumerate all Issues matching a JQL query across all pages using
   * POST /rest/api/3/search/jql with nextPageToken-based pagination.
   *
   * Termination condition (both checked per page):
   *   issues.length === 0   — empty page; no further results.
   *   issues.length < maxResults — partial page; this is the final page.
   *
   * The `total` field in the response is NEVER accessed or used for pagination.
   * The deprecated GET /rest/api/3/search endpoint must not appear anywhere
   * in backup-engine code (T2 §6 Constraint 6).
   *
   * Emits one structured log line per page:
   *   [search] endpoint=search/jql project=<projectKey> page=<n> count=<n>
   *
   * @param cloudBaseUrl  Base URL for the site.
   * @param projectKey    Jira project key — used only for structured logging.
   * @param jql           JQL query string.
   * @param fields        Field IDs to include in each Issue payload.
   * @param opts          Optional: maxResults per page (default 100).
   */
  enumerateIssues(
    cloudBaseUrl: string,
    projectKey: string,
    jql: string,
    fields: string[],
    opts?: { maxResults?: number }
  ): Promise<RawIssue[]>;
}

// ---------------------------------------------------------------------------
// Capture Phase Enum
// ---------------------------------------------------------------------------

/**
 * Dependency-ordered capture phases for the backup engine orchestrator.
 *
 * Context nodes are captured before Protected Objects in every backup job.
 * The order below is mandatory; no phase may be skipped or reordered.
 * Source: T1 §1, T3 §3.4.
 *
 * IssueType → CustomField + FieldConfiguration →
 * Workflow + WorkflowScheme → Project → Board → Sprint → Issue
 */
export type CapturePhase =
  | 'IssueType'
  | 'CustomField'
  | 'FieldConfiguration'
  | 'Workflow'
  | 'WorkflowScheme'
  | 'Project'
  | 'Board'
  | 'Sprint'
  | 'Issue';

/** Canonical, immutable phase sequence. Implementations must iterate in this order. */
export const CAPTURE_PHASE_ORDER: readonly CapturePhase[] = [
  'IssueType',
  'CustomField',
  'FieldConfiguration',
  'Workflow',
  'WorkflowScheme',
  'Project',
  'Board',
  'Sprint',
  'Issue',
] as const;

// ---------------------------------------------------------------------------
// Orchestrator Interface
// ---------------------------------------------------------------------------

/** Result record for a single completed or failed phase. */
export interface PhaseResult {
  phase: CapturePhase;
  status: 'ok' | 'partial' | 'failed';
  itemCount: number;
  errorCount: number;
  /** Human-readable diagnostic, present when status is 'failed'. */
  diagnostic?: string;
}

/** Progress event emitted at most every 10 seconds during a capture run (T5 §6.2). */
export interface CaptureProgressEvent {
  phase: CapturePhase;
  itemsCaptured: number;
  /** null when the total is not yet known (e.g. during pagination). */
  itemsTotal: number | null;
  elapsedMs: number;
}

/** Input options for ICaptureOrchestrator.runCapture(). */
export interface CaptureRunOptions {
  connectionId: string;
  cloudId: string;
  /** Base URL for the site, e.g. https://api.atlassian.com/ex/jira/{cloudId} */
  cloudBaseUrl: string;
  manifestId: string;
  projectScope: ProjectScope;
  /** Required when projectScope === 'selected'. */
  selectedProjectKeys?: string[];
}

/** Result returned by ICaptureOrchestrator.runCapture(). */
export interface CaptureRunResult {
  backupPointId: string;
  completedAt: string;
  phaseResults: PhaseResult[];
  itemCount: number;
  errorCount: number;
  /**
   * Field contexts discovered during the CustomField phase.
   * Empty array when the CustomField phase failed before completing.
   */
  fieldContexts: FieldContextRecord[];
  /**
   * Set when any phase halts with status 'failed'.
   * Format: "<PhaseName> phase: <reason>".
   * Subsequent phases are not executed after a failure (T5 §5.2).
   */
  phaseDiagnostic?: string;
}

/**
 * Capture-order orchestrator interface.
 *
 * Implementations must:
 *   1. Execute phases in CAPTURE_PHASE_ORDER.
 *   2. Halt on the first phase failure and populate phaseDiagnostic.
 *   3. Call onProgress at most every 10 seconds; a gap of >20 s surfaces a
 *      'stalled' alert in the UI (T5 §6.2).
 *   4. Return CaptureRunResult with errorCount > 0 when any item fails —
 *      never synthesise a "Completed successfully" status in that case (T5 §6.2b).
 */
export interface ICaptureOrchestrator {
  runCapture(
    options: CaptureRunOptions,
    onProgress: (event: CaptureProgressEvent) => void
  ): Promise<CaptureRunResult>;
}

// ---------------------------------------------------------------------------
// Manifest Schema
// ---------------------------------------------------------------------------

/** Project discovery scope — mirrors PolicyRequest.projectScope. */
export type ProjectScope = 'all' | 'selected';

/**
 * Deletion-diff change badge relative to the previous backup point.
 * Every project in the manifest carries one of these four values (T4 §6).
 */
export type ChangeBadge = 'added' | 'modified' | 'deleted' | 'unchanged';

/**
 * Per-project record in the backup manifest.
 *
 * Every project returned by paginated GET /rest/api/3/project/search appears
 * in either projects[] or jsmDeferredProjects[] — never silently omitted
 * (zero-omissions invariant, T3 §4.3, T4 §6).
 */
export interface ProjectRecord {
  /** Atlassian numeric project ID (string form). */
  projectId: string;
  /** Jira project key, e.g. "PROJ". */
  projectKey: string;
  projectName: string;
  /**
   * Atlassian project type key.
   * Typical values: "software", "business", "service_desk".
   */
  projectTypeKey: string;
  issueCounts: {
    total: number;
    backed: number;
    errored: number;
  };
  /** IDs of boards discovered under this project. */
  boardIds: string[];
  /** IDs of sprints discovered under this project's boards. */
  sprintIds: string[];
  /** Change relative to the previous backup point. */
  changeBadge: ChangeBadge;
}

/**
 * Represents a project excluded from backup because projectTypeKey === 'service_desk'.
 * JSM objects are deferred to Phase 2. The onboarding wizard surfaces an
 * out-of-scope notice when this list is non-empty (T1 §1, T2 §6 Constraint 11, T3 §3.2).
 */
export interface JsmDeferredProject {
  projectId: string;
  projectKey: string;
  projectName: string;
  reason: 'PHASE_2_DEFERRED';
}

/**
 * A single context entry returned by GET /rest/api/3/field/{id}/context.
 * Source: T2 §6 Constraint 7, T3 §4.2.
 */
export interface FieldContext {
  id: string;
  name: string;
  isGlobalContext: boolean;
  isAnyIssueType: boolean;
}

/**
 * Field context record persisted in the manifest for each custom field.
 * System fields (custom: false) never produce a FieldContextRecord — they are
 * skipped with a [field-context] skip log line and never passed to the context
 * endpoint (T2 §6 Constraint 7).
 */
export interface FieldContextRecord {
  fieldId: string;
  fieldName: string;
  /** Always true — system fields are never stored here. */
  custom: true;
  contexts: FieldContext[];
}

/**
 * Coverage invariant record — asserts that all system and custom fields were
 * captured for each backed-up Issue. Populated by the Issue capture phase.
 * Source: T3 §3.5.
 */
export interface CoverageInvariant {
  /** Total Issues enumerated across all non-deferred projects. */
  totalIssuesEnumerated: number;
  /** Issues for which all fields (system + custom) were successfully captured. */
  issuesFullyCaptured: number;
  /** Issues with one or more field capture errors. */
  issuesWithErrors: number;
  /**
   * Field IDs skipped because custom === false (system fields).
   * These are never passed to GET /rest/api/3/field/{id}/context
   * (T2 §6 Constraint 7).
   */
  systemFieldsSkipped: string[];
}

/**
 * Top-level backup manifest produced by the Discover operation.
 *
 * Invariant: every project returned by GET /rest/api/3/project/search is
 * represented in either `projects` or `jsmDeferredProjects` — never silently
 * omitted. Source: T3 §4.3, T4 §6.
 */
export interface BackupManifest {
  /** Opaque manifest identifier (UUID). */
  manifestId: string;
  /** The Atlassian cloudId of the site that was discovered. */
  cloudId: string;
  /** ISO-8601 timestamp when discovery completed. */
  discoveredAt: string;
  /** Project scope from the active backup policy. */
  projectScope: ProjectScope;
  /**
   * Project keys selected when projectScope === 'selected'.
   * Empty array when projectScope === 'all'.
   */
  selectedProjectKeys: string[];
  /** All non-JSM projects discovered in this run. */
  projects: ProjectRecord[];
  /**
   * Projects excluded from backup because projectTypeKey === 'service_desk'.
   * Surfaced to the UI as PHASE_2_DEFERRED notices.
   */
  jsmDeferredProjects: JsmDeferredProject[];
  /**
   * Custom field contexts discovered during the CustomField capture phase.
   * Populated by discoverFieldContexts() — GET /rest/api/3/field/{id}/context
   * is called only for fields where custom: true (T2 §6 Constraint 7, T3 §4.2).
   * null when field context discovery has not yet run.
   */
  fieldContexts: FieldContextRecord[] | null;
  /**
   * Number of custom fields (custom: true) whose contexts were successfully
   * captured during the Snapshot CustomField phase.
   * null before snapshot runs; equals fieldContexts.length on success.
   */
  customFieldsCaptured: number | null;
  /**
   * Field IDs of custom fields that errored during context discovery.
   * Empty array in the success case (T2 §6 Constraint 7, T3 §4.2).
   */
  customFieldsSkipped: string[];
  /**
   * Populated after the Issue capture phase completes.
   * null when only discovery (not snapshot) has run.
   */
  coverageInvariant: CoverageInvariant | null;
}

// ---------------------------------------------------------------------------
// Issue Payload — Coverage Invariant Types
// ---------------------------------------------------------------------------

/** Minimal ADF document node shape (Atlassian Document Format). */
export interface AdfNode {
  type: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  text?: string;
}

/** Single comment attached to an Issue. Source: T3 §3.3. */
export interface IssueComment {
  id: string;
  author: { accountId: string; displayName: string };
  body: AdfNode;
  created: string;
  updated: string;
}

/** Issue link (outward or inward). All link types, both directions. Source: T3 §3.3. */
export interface IssueLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string; id: string };
  outwardIssue?: { key: string; id: string };
}

/**
 * Attachment reference stored in the Issue record.
 * The binary is stored separately by IJiraHttpClient.downloadAttachment().
 * Source: T3 §3.2, §3.3, §4.4.
 */
export interface AttachmentRecord {
  id: string;
  filename: string;
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /**
   * Direct download URL from the Jira API (the `content` field on the raw
   * attachment object). Populated by the assembler; used by the binary
   * download step to fetch the attachment.
   */
  contentUrl?: string;
  /**
   * SHA-256 hex digest of the downloaded binary for integrity verification.
   * Empty string ('') until the binary download step completes.
   */
  contentHash: string;
  created: string;
  author: { accountId: string };
}

/** Single worklog entry. Source: T3 §3.3. */
export interface WorklogEntry {
  id: string;
  author: { accountId: string };
  timeSpentSeconds: number;
  started: string;
}

/**
 * Full Issue payload satisfying the coverage invariant.
 *
 * Every field defined in T3 §3.3 must be present; no field is silently skipped.
 * customFieldValues must contain every custom field returned by the API for
 * this Issue — the map must not drop any entry (coverage invariant, T3 §3.5).
 */
export interface IssueRecord {
  /** Atlassian Issue ID (numeric string). */
  id: string;
  /** Issue key, e.g. "PROJ-42". */
  key: string;
  projectId: string;

  // System fields
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
   * Every custom field returned by the API must appear here — no field is skipped.
   * System fields (custom: false) do not appear in this map.
   */
  customFieldValues: Record<string, unknown>;

  comments: IssueComment[];
  /** All issue links, both directions and all link types. */
  issueLinks: IssueLink[];
  /** Keys of subtask Issues. */
  subtaskKeys: string[];
  /** Sprint IDs this Issue belongs to. An Issue may appear in multiple sprints. */
  sprintIds: string[];
  /** accountIds of Issue watchers. */
  watcherAccountIds: string[];
  worklogs: WorklogEntry[];
  attachments: AttachmentRecord[];

  /** Backup-point ID under which this Issue was captured. */
  backupPointId: string;
  /** ISO-8601 timestamp when this Issue was captured. */
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// Discover / Snapshot Operation Contracts (internal)
// ---------------------------------------------------------------------------

/**
 * Internal Discover result carrying the full BackupManifest.
 *
 * At the PlatformWorkloadInterface boundary this is projected down to
 * DiscoverResult (src/platform_workload_iface.ts), which contains only the
 * opaque counts needed by the platform layer.
 */
export interface DiscoverRunResult {
  manifestId: string;
  discoveredAt: string;
  manifest: BackupManifest;
}

/**
 * Internal Snapshot result carrying the full CaptureRunResult.
 *
 * At the PlatformWorkloadInterface boundary this is projected down to
 * SnapshotResult. isFullyComplete is true only when errorCount === 0 across
 * all phases; the UI must never display "Completed successfully" otherwise.
 */
export interface SnapshotRunResult {
  backupPointId: string;
  completedAt: string;
  captureRun: CaptureRunResult;
  /** True only when errorCount === 0 across all capture phases. */
  isFullyComplete: boolean;
}
