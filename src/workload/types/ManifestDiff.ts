/**
 * Manifest deletion-diff contracts — Sprint 3, Phase 2.
 *
 * Defines the per-object ChangeBadge and ManifestDiff schema used to compare
 * the current backup-point manifest against the previous one. Computed after
 * every Discover run so the UI can display added/modified/deleted/unchanged
 * change badges on each project row.
 *
 * Source: T4 §6.
 */

import type { ProjectRecord } from '../backup/types.js';

/**
 * Change badge assigned to each object by comparing the current backup run
 * against the previous backup-point manifest.
 *
 * Computation rules (applied per project key):
 *   added     — key present in current manifest, absent in previous
 *   modified  — key present in both; one or more tracked fields differ
 *   deleted   — key present in previous manifest, absent in current
 *   unchanged — key present in both; all tracked fields are identical
 *
 * Source: T4 §6.
 */
export type ChangeBadge = 'added' | 'modified' | 'deleted' | 'unchanged';

/**
 * Diff entry for a single Project.
 *
 * `current` is null only for deleted entries.
 * `previous` is null only for added entries.
 */
export interface ProjectDiffEntry {
  /** Atlassian numeric project ID (string form) — stable key across renames. */
  projectId: string;
  /** Jira project key, e.g. "PROJ". */
  projectKey: string;
  /** Change relative to the previous backup point. */
  changeBadge: ChangeBadge;
  /** Populated for added and modified entries; null for deleted entries. */
  current: ProjectRecord | null;
  /** Populated for deleted and modified entries; null for added entries. */
  previous: ProjectRecord | null;
}

/**
 * Aggregate change counts across all diff entries.
 * `total` equals `projects.length` in the parent ManifestDiff.
 */
export interface ManifestDiffSummary {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  /** Sum of all four buckets. */
  total: number;
}

/**
 * Manifest deletion-diff comparing the current Discover snapshot to the
 * previous backup point's manifest.
 *
 * Produced once per Discover run and stored alongside the new manifest.
 * Every project in either the current or previous manifest appears exactly
 * once in `projects` — no project is silently omitted (T3 §4.3, T4 §6).
 *
 * On the first-ever backup run, `previousManifestId` is null and every
 * project entry receives `changeBadge: 'added'`.
 *
 * Source: T4 §6.
 */
export interface ManifestDiff {
  /** Previous backup-point manifest ID. null on the first backup run. */
  previousManifestId: string | null;
  /** Current manifest ID (matches BackupManifest.manifestId). */
  currentManifestId: string;
  /** ISO-8601 timestamp when this diff was computed. */
  computedAt: string;
  /** Per-project diff entries covering all non-JSM projects in both manifests. */
  projects: ProjectDiffEntry[];
  /** Aggregate change counts for quick UI display. */
  summary: ManifestDiffSummary;
}
