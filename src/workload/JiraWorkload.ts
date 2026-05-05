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
import { discoverFieldContexts } from './backup/discoverFieldContexts.js';
import { computeManifestDiff } from './backup/computeManifestDiff.js';
import { CaptureOrchestrator } from './snapshot/CaptureOrchestrator.js';
import { ProgressEmitter } from './snapshot/ProgressEmitter.js';
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

    const fieldContexts = await discoverFieldContexts(client, cloudBaseUrl);

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
      fieldContexts,
      customFieldsCaptured: null,
      customFieldsSkipped: [],
      coverageInvariant: null,
      diffSummary: null,
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
  // snapshot
  // -------------------------------------------------------------------------

  async snapshot(connection: Connection, manifestId: string): Promise<SnapshotResult> {
    const db = getDb();

    const row = db
      .prepare('SELECT manifestJson FROM backup_manifests WHERE id = ?')
      .get(manifestId) as { manifestJson: string } | undefined;

    if (!row) {
      throw new Error(`[snapshot] manifest not found: manifestId=${manifestId}`);
    }

    const manifest: BackupManifest = JSON.parse(row.manifestJson);
    const cloudBaseUrl = `https://api.atlassian.com/ex/jira/${connection.cloudId}`;
    const client = JiraHttpClient.forConnection(connection.connectionId);
    const orchestrator = new CaptureOrchestrator(client, manifest);

    const emitter = new ProgressEmitter(manifestId, manifestId, connection.connectionId);
    emitter.start();

    const capturedIssues: Array<{ key: string; summary: string }> = [];

    let captureResult;
    try {
      captureResult = await orchestrator.runCapture(
        {
          connectionId: connection.connectionId,
          cloudId: connection.cloudId,
          cloudBaseUrl,
          manifestId,
          projectScope: manifest.projectScope,
          selectedProjectKeys: manifest.selectedProjectKeys,
          attachmentBaseDir: process.env['DCC_ATTACHMENT_DIR'],
          onIssueCaptured: (key, summary) => capturedIssues.push({ key, summary }),
        },
        (event) => {
          emitter.emit(event);
          console.log(
            `[snapshot-progress] phase=${event.phase}` +
              ` captured=${event.itemsCaptured}` +
              ` total=${event.itemsTotal ?? 'unknown'}` +
              ` elapsedMs=${event.elapsedMs}`
          );
        }
      );
    } catch (err) {
      emitter.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }

    emitter.complete(captureResult.errorCount);

    // -------------------------------------------------------------------------
    // SDI: persist BackupPointSdiSummary and emit structured log line
    // -------------------------------------------------------------------------
    const sdiSummary = captureResult.sdiSummary ?? {
      backupPointId: manifestId,
      issueCount: 0,
      projectCount: 0,
      regulations: { gdpr: 'inactive' as const, pciDss: 'inactive' as const },
    };

    db.prepare(
      `INSERT OR REPLACE INTO backup_point_sdi_summary
         (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      sdiSummary.backupPointId,
      sdiSummary.issueCount,
      sdiSummary.projectCount,
      JSON.stringify(sdiSummary.regulations),
      captureResult.completedAt
    );

    console.log(
      `[sdi] summary backupPointId=${manifestId}` +
        ` issueCount=${sdiSummary.issueCount}` +
        ` projectCount=${sdiSummary.projectCount}` +
        ` gdpr=${sdiSummary.regulations.gdpr}` +
        ` pciDss=${sdiSummary.regulations.pciDss}`
    );

    const customFieldPhase = captureResult.phaseResults.find(
      (p) => p.phase === 'CustomField'
    );
    const issuePhase = captureResult.phaseResults.find((p) => p.phase === 'Issue');

    // Load the previous manifest for this connectionId (any manifest other than the current one)
    // to compute the deletion-diff. Null on the first-ever backup run.
    const prevRow = db
      .prepare(
        `SELECT id, manifestJson FROM backup_manifests
          WHERE connectionId = ? AND id != ?
          ORDER BY createdAt DESC
          LIMIT 1`
      )
      .get(connection.connectionId, manifestId) as { id: string; manifestJson: string } | undefined;

    const prevManifestId: string | undefined = prevRow?.id;
    const previousManifest: BackupManifest | null = prevRow
      ? (JSON.parse(prevRow.manifestJson) as BackupManifest)
      : null;

    const diffResult = computeManifestDiff(manifest, previousManifest);

    const updatedManifest: BackupManifest = {
      ...manifest,
      projects: diffResult.projects,
      fieldContexts: captureResult.fieldContexts,
      customFieldsCaptured: customFieldPhase?.itemCount ?? 0,
      customFieldsSkipped: [],
      coverageInvariant: {
        totalIssuesEnumerated:
          (issuePhase?.itemCount ?? 0) + (issuePhase?.errorCount ?? 0),
        issuesFullyCaptured: issuePhase?.itemCount ?? 0,
        issuesWithErrors: issuePhase?.errorCount ?? 0,
        systemFieldsSkipped: [],
      },
      diffSummary: diffResult.summary,
    };

    db.prepare('UPDATE backup_manifests SET manifestJson = ? WHERE id = ?').run(
      JSON.stringify(updatedManifest),
      manifestId
    );

    // Populate backup_point_items for inventory browsing.
    // changeBadge rule: "unchanged when no prior manifest" (T3 inventory spec).
    const hasPrev = prevManifestId !== undefined;

    let prevIssueKeys = new Set<string>();
    let prevBoardIds = new Set<string>();
    let prevSprintIds = new Set<string>();

    if (hasPrev) {
      const prevItems = db
        .prepare('SELECT objectType, itemId FROM backup_point_items WHERE backupPointId = ?')
        .all(prevManifestId!) as { objectType: string; itemId: string }[];
      for (const item of prevItems) {
        if (item.objectType === 'Issue') prevIssueKeys.add(item.itemId);
        else if (item.objectType === 'Board') prevBoardIds.add(item.itemId);
        else if (item.objectType === 'Sprint') prevSprintIds.add(item.itemId);
      }
    }

    const ts = captureResult.completedAt;
    const insertItem = db.prepare(
      `INSERT OR IGNORE INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    db.transaction(() => {
      for (const issue of capturedIssues) {
        const badge = hasPrev ? (prevIssueKeys.has(issue.key) ? 'unchanged' : 'added') : 'unchanged';
        insertItem.run(connection.connectionId, manifestId, 'Issue', issue.key, issue.key, issue.summary, badge, ts);
      }

      for (const project of updatedManifest.projects) {
        if (project.changeBadge === 'deleted') continue;
        const badge = hasPrev ? project.changeBadge : 'unchanged';
        insertItem.run(connection.connectionId, manifestId, 'Project', project.projectId, project.projectKey, project.projectName, badge, ts);

        for (const boardId of project.boardIds) {
          const bBadge = hasPrev ? (prevBoardIds.has(boardId) ? 'unchanged' : 'added') : 'unchanged';
          insertItem.run(connection.connectionId, manifestId, 'Board', boardId, boardId, null, bBadge, ts);
        }

        for (const sprintId of project.sprintIds) {
          const sBadge = hasPrev ? (prevSprintIds.has(sprintId) ? 'unchanged' : 'added') : 'unchanged';
          insertItem.run(connection.connectionId, manifestId, 'Sprint', sprintId, sprintId, null, sBadge, ts);
        }
      }
    })();

    return {
      backupPointId: manifestId,
      completedAt: captureResult.completedAt,
      itemCount: captureResult.itemCount,
      errorCount: captureResult.errorCount,
    };
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
