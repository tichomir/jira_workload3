/**
 * Manifest deletion-diff pass — Sprint 3, Phase 2.
 *
 * Compares the current backup manifest against the previous one for the same
 * connectionId and stamps each ProjectRecord with a changeBadge. Deleted
 * projects are retained in the projects[] array with badge='deleted' and
 * lastSeenBackupPointId pointing to the manifest where they last appeared.
 *
 * 'modified' is determined by a stable per-object content hash that excludes
 * volatile timestamps. The hash covers: projectKey, projectName, projectTypeKey,
 * boardIds (sorted), sprintIds (sorted).
 *
 * Source: T4 §6, CLAUDE.md Goals §10.
 */

import { createHash } from 'crypto';
import type { BackupManifest, ProjectRecord, ChangeBadge } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiffSummary {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

export interface ManifestDiffResult {
  /** Updated project list — includes deleted entries from the previous manifest. */
  projects: ProjectRecord[];
  /** Aggregate counts across all change badges. */
  summary: DiffSummary;
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

/**
 * Produces a stable SHA-256 digest for a ProjectRecord that excludes volatile
 * or computed fields (timestamps, issueCounts from the current run,
 * changeBadge, lastSeenBackupPointId). Two records with the same stable fields
 * produce identical hashes regardless of when they were captured.
 */
export function stableProjectHash(p: ProjectRecord): string {
  const stable = {
    projectKey: p.projectKey,
    projectName: p.projectName,
    projectTypeKey: p.projectTypeKey,
    boardIds: [...p.boardIds].sort(),
    sprintIds: [...p.sprintIds].sort(),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// ---------------------------------------------------------------------------
// computeManifestDiff
// ---------------------------------------------------------------------------

/**
 * Compute the deletion-diff between `current` and `previous`.
 *
 * When `previous` is null (first-ever backup run), every project in `current`
 * receives changeBadge='added'.
 *
 * Otherwise:
 *   added     — projectId present in current, absent in previous
 *   modified  — projectId present in both; stableProjectHash differs
 *   unchanged — projectId present in both; stableProjectHash identical
 *   deleted   — projectId present in previous, absent in current; entry is
 *               appended to the returned projects[] with lastSeenBackupPointId
 *
 * The returned projects[] always covers every project from both manifests —
 * no project is silently omitted (zero-omissions invariant, T4 §6).
 */
export function computeManifestDiff(
  current: BackupManifest,
  previous: BackupManifest | null
): ManifestDiffResult {
  const summary: DiffSummary = { added: 0, modified: 0, deleted: 0, unchanged: 0 };

  if (previous === null) {
    const projects = current.projects.map(
      (p): ProjectRecord => ({ ...p, changeBadge: 'added' as ChangeBadge })
    );
    summary.added = projects.length;
    return { projects, summary };
  }

  const prevById = new Map(previous.projects.map((p) => [p.projectId, p]));
  const currIdSet = new Set(current.projects.map((p) => p.projectId));

  const stamped: ProjectRecord[] = [];

  for (const proj of current.projects) {
    const prev = prevById.get(proj.projectId);
    if (!prev) {
      stamped.push({ ...proj, changeBadge: 'added' });
      summary.added++;
    } else if (stableProjectHash(proj) !== stableProjectHash(prev)) {
      stamped.push({ ...proj, changeBadge: 'modified' });
      summary.modified++;
    } else {
      stamped.push({ ...proj, changeBadge: 'unchanged' });
      summary.unchanged++;
    }
  }

  for (const prev of previous.projects) {
    if (!currIdSet.has(prev.projectId)) {
      stamped.push({
        ...prev,
        changeBadge: 'deleted',
        lastSeenBackupPointId: previous.manifestId,
      });
      summary.deleted++;
    }
  }

  return { projects: stamped, summary };
}
