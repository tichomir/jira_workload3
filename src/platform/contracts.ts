/**
 * Platform Stub — API surface (T0 §2) request/response contracts.
 *
 * Defines the JSON wire shapes for all four endpoint groups:
 * POST /api/connections, GET /api/inventory, POST /api/policies, and the
 * restore endpoints. Complements PlatformWorkloadInterface (transport-agnostic
 * method boundary) with the HTTP-layer request/response types.
 */

import type { ConflictMode, RestoreDestination } from "../platform_workload_iface";

// ---------------------------------------------------------------------------
// POST /api/connections
// ---------------------------------------------------------------------------

/** OAuth 3LO variant — tokens supplied by the 3LO callback handler. */
export interface OAuthConnectionCreateRequest {
  connectionType: "oauth";
  cloudId: string;
  siteName: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds at which accessToken expires. */
  expiresAt: number;
  /** Space-separated or pre-split scopes granted by Atlassian. */
  scopes: string | string[];
}

/**
 * Manual connection variant — operator supplies Client ID + Client Secret
 * directly. The platform resolves cloudId via GET /rest/api/3/myself before
 * persisting the connection.
 *
 * Credential masking rules:
 * - clientId is stored internally; only last 4 chars are returned in responses
 *   as clientIdMasked ("****XXXX").
 * - clientSecret is stored encrypted at rest and never returned in any response.
 */
export interface ManualConnectionCreateRequest {
  connectionType: "manual";
  cloudId: string;
  siteName: string;
  /** Full Client ID. Only the last 4 characters are included in any response. */
  clientId: string;
  /** Client Secret. Never returned in any response after creation. */
  clientSecret: string;
}

/** Discriminated union accepted by POST /api/connections. */
export type ConnectionCreateRequest =
  | OAuthConnectionCreateRequest
  | ManualConnectionCreateRequest;

/**
 * Successful response from POST /api/connections (HTTP 201).
 *
 * accessToken, refreshToken, clientId (plaintext), and clientSecret are
 * never included. clientIdMasked is present only for Manual connections.
 */
export interface ConnectionResponse {
  connectionId: string;
  cloudId: string;
  siteName: string;
  /** OAuth scopes granted at authorization time. Empty array for Manual connections. */
  scopes: string[];
  createdAt: string; // ISO-8601
  /**
   * Present only for Manual connections.
   * Format: "****" + last 4 characters of the original clientId (e.g. "****WXYZ").
   */
  clientIdMasked?: string;
}

/**
 * HTTP 409 error body returned when a re-authorization attempt supplies a
 * cloudId that differs from the one already stored for this connection.
 * Source: T2 §4.5.
 */
export interface CloudIdMismatchError {
  error: "cloudid_mismatch";
  message: string;
  storedCloudId: string;
  receivedCloudId: string;
}

// ---------------------------------------------------------------------------
// GET /api/inventory
// ---------------------------------------------------------------------------

/**
 * Response for GET /api/inventory?connectionId=<id> (HTTP 200).
 * Maps to DiscoverResult from PlatformWorkloadInterface.discover().
 */
export interface InventoryResponse {
  manifestId: string;
  completedAt: string; // ISO-8601
  counts: {
    projects: number;
    issues: number;
    boards: number;
    sprints: number;
  };
}

// ---------------------------------------------------------------------------
// POST /api/policies
// ---------------------------------------------------------------------------

/** Backup project-discovery scope. */
export type ProjectScope = "all" | "selected";

/**
 * Request body for POST /api/policies.
 * Creates or replaces the backup policy for the given connection.
 */
export interface PolicyRequest {
  connectionId: string;
  /**
   * "all" — back up every project on the site.
   * "selected" — back up only the projects listed in selectedProjectKeys.
   */
  projectScope: ProjectScope;
  /**
   * Required when projectScope is "selected"; ignored (treated as []) otherwise.
   * Each entry is a Jira project key, e.g. ["PROJ", "INFRA"].
   */
  selectedProjectKeys?: string[];
  /** Days to retain each backup point. */
  retentionDays: number;
}

/** Response for POST /api/policies (HTTP 200). */
export interface PolicyResponse {
  policyId: string;
  connectionId: string;
  projectScope: ProjectScope;
  selectedProjectKeys: string[];
  retentionDays: number;
  updatedAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// POST /api/restore  &  GET /api/restore/:jobId
// ---------------------------------------------------------------------------

/**
 * Request body for POST /api/restore.
 * Maps to RestoreOptions from PlatformWorkloadInterface.restore().
 */
export interface RestoreRequest {
  connectionId: string;
  backupPointId: string;
  /** IDs of the objects to restore. */
  itemIds: string[];
  /**
   * Conflict resolution strategy. Defaults to "skip" when omitted.
   * Possible values: "override" | "skip" | "ask"
   */
  conflictMode?: ConflictMode;
  destination: RestoreDestination;
}

/** Status values for a restore job. */
export type RestoreJobStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "stalled";

/**
 * Response for POST /api/restore (HTTP 202) — job accepted and running.
 */
export interface RestoreJobAcceptedResponse {
  jobId: string;
  status: "running";
  startedAt: string; // ISO-8601
}

/**
 * Response for GET /api/restore/:jobId (HTTP 200).
 *
 * A job is "stalled" when no heartbeat has been received for >20 seconds.
 * "completed_with_errors" is used when errorCount > 0; the UI must display
 * "Completed with N errors", never "Completed successfully" (T5 §6.2b).
 * phaseDiagnostic is set when a phase-level failure halted execution (T5 §5.2).
 */
export interface RestoreJobResponse {
  jobId: string;
  status: RestoreJobStatus;
  restoredCount: number;
  errorCount: number;
  /** Named diagnostic emitted when any restore phase fails. */
  phaseDiagnostic?: string;
  /** ISO-8601 timestamp; null while the job is still running. */
  completedAt: string | null;
}
