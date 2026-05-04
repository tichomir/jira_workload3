/**
 * Platform/Workload Boundary — transport-agnostic interface.
 *
 * The Platform calls these methods; the Workload implements them.
 * No vendor HTTP imports belong here. All network I/O is an implementation detail
 * of the concrete workload module, not part of this contract.
 */

import type { Connection, CredentialRecord } from "./types/connection";

// ---------------------------------------------------------------------------
// Shared result shapes
// ---------------------------------------------------------------------------

export interface DiscoverResult {
  /** Opaque manifest identifier for this discovery run. */
  manifestId: string;
  /** ISO-8601 timestamp when discovery completed. */
  completedAt: string;
  counts: {
    projects: number;
    issues: number;
    boards: number;
    sprints: number;
  };
}

export interface SnapshotResult {
  /** Backup-point ID assigned by the platform. */
  backupPointId: string;
  completedAt: string;
  /** Number of items successfully captured. */
  itemCount: number;
  /** Number of per-item errors. A non-zero value means "Completed with N errors". */
  errorCount: number;
}

export interface RestoreResult {
  /** Restore job ID. */
  jobId: string;
  completedAt: string;
  /** Number of items successfully restored. */
  restoredCount: number;
  errorCount: number;
  /** Human-readable diagnostic emitted when any phase fails. */
  phaseDiagnostic?: string;
}

export type RefreshAuthResult =
  | { ok: true; credentials: CredentialRecord }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Restore options
// ---------------------------------------------------------------------------

export type ConflictMode = "override" | "skip" | "ask";

export type RestoreDestination =
  | { type: "original" }
  | { type: "alternate"; cloudId: string; projectKey: string }
  | { type: "export" };

export interface RestoreOptions {
  backupPointId: string;
  /** Object IDs selected for restore. */
  itemIds: string[];
  conflictMode: ConflictMode;
  destination: RestoreDestination;
}

// ---------------------------------------------------------------------------
// Platform/Workload Boundary interface
// ---------------------------------------------------------------------------

/**
 * Implemented by the Jira Cloud workload module and called by the DCC platform.
 */
export interface PlatformWorkloadInterface {
  /**
   * Discover all objects on the connected site and write a manifest.
   * Must produce zero silent omissions — every API-returned object is represented.
   */
  discover(connection: Connection): Promise<DiscoverResult>;

  /**
   * Capture a full backup snapshot for the given manifest.
   * Emits a progress event at least every 10 seconds.
   * Returns SnapshotResult with errorCount > 0 when any item fails.
   */
  snapshot(connection: Connection, manifestId: string): Promise<SnapshotResult>;

  /**
   * Restore items from a backup point according to the supplied options.
   * Enforces write dependency order: Project → Workflow+WorkflowScheme →
   * CustomField+FieldConfiguration → Board → Sprint → Issue body →
   * issue links + comments + attachments.
   * A failure in any phase halts execution and populates phaseDiagnostic.
   */
  restore(connection: Connection, options: RestoreOptions): Promise<RestoreResult>;

  /**
   * Atomically rotate the access/refresh token pair.
   * Both tokens are written to the credential store before the call resolves.
   * Concurrent callers queue behind a single in-flight refresh (mutex enforced
   * by the concrete implementation, not this interface).
   */
  refresh_auth(connection: Connection): Promise<RefreshAuthResult>;
}
