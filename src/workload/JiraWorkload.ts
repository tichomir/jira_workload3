/**
 * Concrete implementation of PlatformWorkloadInterface for Jira Cloud.
 *
 * discover() is the operator-observable seam: it calls discoverProjects,
 * persists the BackupManifest to the backup_manifests table, and returns
 * { backupPointId, projectCount, jsmDeferredCount } to the Platform.
 *
 * Source: T3 §4.3, T4 §6, T1 §1.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { JiraHttpClient } from './http/JiraHttpClient.js';
import { discoverProjects } from './backup/discoverProjects.js';
import type {
  PlatformWorkloadInterface,
  DiscoverPolicy,
  DiscoverResult,
  SnapshotResult,
  RestoreResult,
  RefreshAuthResult,
  RestoreOptions,
} from '../platform_workload_iface.js';
import type { Connection } from '../types/connection.js';
import type { BackupManifest } from './backup/types.js';

// ---------------------------------------------------------------------------
// Typed error surfaces
// ---------------------------------------------------------------------------

/**
 * Thrown when discover() cannot resolve credentials for the given connectionId.
 * The Platform Stub surfaces this as HTTP 401 to the operator.
 */
export class WorkloadAuthError extends Error {
  readonly connectionId: string;
  constructor(connectionId: string, detail: string) {
    super(`[auth-failure] connectionId=${connectionId} ${detail}`);
    this.name = 'WorkloadAuthError';
    this.connectionId = connectionId;
  }
}

// ---------------------------------------------------------------------------
// JiraWorkload
// ---------------------------------------------------------------------------

export class JiraWorkload implements PlatformWorkloadInterface {
  // -------------------------------------------------------------------------
  // discover
  // -------------------------------------------------------------------------

  async discover(connectionId: string, policy: DiscoverPolicy): Promise<DiscoverResult> {
    const db = getDb();

    const row = db
      .prepare(
        `SELECT c.connectionId, c.cloudId
           FROM connections c
           JOIN credentials cr ON cr.connectionId = c.connectionId
          WHERE c.connectionId = ?`
      )
      .get(connectionId) as { connectionId: string; cloudId: string } | undefined;

    if (!row) {
      throw new WorkloadAuthError(
        connectionId,
        'connection or credentials not found'
      );
    }

    const cloudBaseUrl = `https://api.atlassian.com/ex/jira/${row.cloudId}`;
    const client = JiraHttpClient.forConnection(connectionId);

    const { projects, jsmDeferredProjects } = await discoverProjects(
      client,
      cloudBaseUrl,
      policy.projectScope,
      policy.selectedProjectKeys
    );

    const manifestId = randomUUID();
    const now = new Date().toISOString();

    const manifest: BackupManifest = {
      manifestId,
      cloudId: row.cloudId,
      discoveredAt: now,
      projectScope: policy.projectScope,
      selectedProjectKeys: policy.selectedProjectKeys ?? [],
      projects,
      jsmDeferredProjects,
      coverageInvariant: null,
    };

    db.prepare(
      `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(manifestId, connectionId, row.cloudId, now, JSON.stringify(manifest));

    return {
      backupPointId: manifestId,
      completedAt: now,
      projectCount: projects.length,
      jsmDeferredCount: jsmDeferredProjects.length,
    };
  }

  // -------------------------------------------------------------------------
  // snapshot — Phase 2 deliverable
  // -------------------------------------------------------------------------

  async snapshot(_connection: Connection, _manifestId: string): Promise<SnapshotResult> {
    throw new Error('snapshot() not yet implemented — Phase 2 deliverable');
  }

  // -------------------------------------------------------------------------
  // restore — Phase 2 deliverable
  // -------------------------------------------------------------------------

  async restore(_connection: Connection, _options: RestoreOptions): Promise<RestoreResult> {
    throw new Error('restore() not yet implemented — Phase 2 deliverable');
  }

  // -------------------------------------------------------------------------
  // refresh_auth — delegates to JiraHttpClient's internal refresh
  // -------------------------------------------------------------------------

  async refresh_auth(connection: Connection): Promise<RefreshAuthResult> {
    try {
      const db = getDb();
      const creds = db
        .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
        .get(connection.connectionId) as { accessToken: string; refreshToken: string } | undefined;

      if (!creds) {
        return { ok: false, error: `credentials not found for connectionId=${connection.connectionId}` };
      }

      return {
        ok: true,
        credentials: {
          accessToken: creds.accessToken,
          refreshToken: creds.refreshToken,
          expiresAt: connection.credentials.expiresAt,
        },
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Singleton exported for Platform Stub route use. */
export const jiraWorkload = new JiraWorkload();
