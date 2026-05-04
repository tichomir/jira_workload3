import { describe, it, expect } from 'vitest';
import { computeManifestDiff, stableProjectHash } from './computeManifestDiff.js';
import type { BackupManifest, ProjectRecord } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectRecord> & { projectId: string; projectKey: string }): ProjectRecord {
  return {
    projectId: overrides.projectId,
    projectKey: overrides.projectKey,
    projectName: overrides.projectName ?? `Project ${overrides.projectKey}`,
    projectTypeKey: overrides.projectTypeKey ?? 'software',
    issueCounts: overrides.issueCounts ?? { total: 0, backed: 0, errored: 0 },
    boardIds: overrides.boardIds ?? [],
    sprintIds: overrides.sprintIds ?? [],
    changeBadge: overrides.changeBadge ?? 'added',
    lastSeenBackupPointId: overrides.lastSeenBackupPointId,
  };
}

function makeManifest(id: string, projects: ProjectRecord[]): BackupManifest {
  return {
    manifestId: id,
    cloudId: 'cloud-test-001',
    discoveredAt: '2026-05-04T00:00:00.000Z',
    projectScope: 'all',
    selectedProjectKeys: [],
    projects,
    jsmDeferredProjects: [],
    fieldContexts: null,
    customFieldsCaptured: null,
    customFieldsSkipped: [],
    coverageInvariant: null,
    diffSummary: null,
  };
}

// ---------------------------------------------------------------------------
// stableProjectHash
// ---------------------------------------------------------------------------

describe('stableProjectHash', () => {
  it('returns the same hash for identical projects', () => {
    const p = makeProject({ projectId: '1', projectKey: 'PROJ' });
    expect(stableProjectHash(p)).toBe(stableProjectHash(p));
  });

  it('returns different hashes when projectName changes', () => {
    const p1 = makeProject({ projectId: '1', projectKey: 'PROJ', projectName: 'Alpha' });
    const p2 = makeProject({ projectId: '1', projectKey: 'PROJ', projectName: 'Beta' });
    expect(stableProjectHash(p1)).not.toBe(stableProjectHash(p2));
  });

  it('is insensitive to boardIds order', () => {
    const p1 = makeProject({ projectId: '1', projectKey: 'PROJ', boardIds: ['b1', 'b2'] });
    const p2 = makeProject({ projectId: '1', projectKey: 'PROJ', boardIds: ['b2', 'b1'] });
    expect(stableProjectHash(p1)).toBe(stableProjectHash(p2));
  });

  it('is insensitive to sprintIds order', () => {
    const p1 = makeProject({ projectId: '1', projectKey: 'PROJ', sprintIds: ['s1', 's2'] });
    const p2 = makeProject({ projectId: '1', projectKey: 'PROJ', sprintIds: ['s2', 's1'] });
    expect(stableProjectHash(p1)).toBe(stableProjectHash(p2));
  });

  it('ignores changeBadge and lastSeenBackupPointId', () => {
    const p1 = makeProject({ projectId: '1', projectKey: 'PROJ', changeBadge: 'added' });
    const p2 = makeProject({ projectId: '1', projectKey: 'PROJ', changeBadge: 'modified', lastSeenBackupPointId: 'prev-manifest' });
    expect(stableProjectHash(p1)).toBe(stableProjectHash(p2));
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — first run (no previous manifest)
// ---------------------------------------------------------------------------

describe('computeManifestDiff — first run (previous=null)', () => {
  it('stamps all projects as added', () => {
    const p1 = makeProject({ projectId: '1', projectKey: 'A' });
    const p2 = makeProject({ projectId: '2', projectKey: 'B' });
    const current = makeManifest('m1', [p1, p2]);

    const result = computeManifestDiff(current, null);

    expect(result.projects).toHaveLength(2);
    expect(result.projects.every(p => p.changeBadge === 'added')).toBe(true);
  });

  it('summary reflects all added', () => {
    const current = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B' }),
      makeProject({ projectId: '3', projectKey: 'C' }),
    ]);

    const { summary } = computeManifestDiff(current, null);

    expect(summary.added).toBe(3);
    expect(summary.modified).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(summary.unchanged).toBe(0);
  });

  it('returns empty projects and zeroed summary for empty manifest', () => {
    const { projects, summary } = computeManifestDiff(makeManifest('m1', []), null);
    expect(projects).toHaveLength(0);
    expect(summary).toEqual({ added: 0, modified: 0, deleted: 0, unchanged: 0 });
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — added (new project not in previous)
// ---------------------------------------------------------------------------

describe('computeManifestDiff — added badge', () => {
  it('stamps new project as added', () => {
    const prev = makeManifest('m1', [makeProject({ projectId: '1', projectKey: 'A' })]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    const b = projects.find(p => p.projectId === '2')!;
    expect(b.changeBadge).toBe('added');
    expect(summary.added).toBe(1);
    expect(summary.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — modified badge
// ---------------------------------------------------------------------------

describe('computeManifestDiff — modified badge', () => {
  it('stamps project as modified when projectName changes', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A', projectName: 'Old Name' }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A', projectName: 'New Name' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('modified');
    expect(summary.modified).toBe(1);
    expect(summary.unchanged).toBe(0);
  });

  it('stamps project as modified when boardIds change', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A', boardIds: ['b1'] }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A', boardIds: ['b1', 'b2'] }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('modified');
    expect(summary.modified).toBe(1);
  });

  it('stamps project as modified when sprintIds change', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A', sprintIds: ['s1'] }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A', sprintIds: ['s1', 's2'] }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('modified');
    expect(summary.modified).toBe(1);
  });

  it('stamps project as modified when projectTypeKey changes', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A', projectTypeKey: 'software' }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A', projectTypeKey: 'business' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('modified');
    expect(summary.modified).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — unchanged badge
// ---------------------------------------------------------------------------

describe('computeManifestDiff — unchanged badge', () => {
  it('stamps project as unchanged when all stable fields are identical', () => {
    const proj = makeProject({ projectId: '1', projectKey: 'A', projectName: 'Alpha', boardIds: ['b1'], sprintIds: ['s1'] });
    const prev = makeManifest('m1', [proj]);
    const current = makeManifest('m2', [{ ...proj, changeBadge: 'added' }]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('unchanged');
    expect(summary.unchanged).toBe(1);
    expect(summary.modified).toBe(0);
  });

  it('treats board/sprint order changes as unchanged', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A', boardIds: ['b1', 'b2'], sprintIds: ['s2', 's1'] }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A', boardIds: ['b2', 'b1'], sprintIds: ['s1', 's2'] }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects[0].changeBadge).toBe('unchanged');
    expect(summary.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — deleted badge
// ---------------------------------------------------------------------------

describe('computeManifestDiff — deleted badge', () => {
  it('retains deleted project with badge=deleted', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B' }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(projects).toHaveLength(2);
    const deleted = projects.find(p => p.projectId === '2')!;
    expect(deleted.changeBadge).toBe('deleted');
    expect(summary.deleted).toBe(1);
  });

  it('sets lastSeenBackupPointId to the previous manifest id', () => {
    const prev = makeManifest('prev-manifest-id-abc', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B' }),
    ]);
    const current = makeManifest('curr-manifest-id-xyz', [
      makeProject({ projectId: '1', projectKey: 'A' }),
    ]);

    const { projects } = computeManifestDiff(current, prev);

    const deleted = projects.find(p => p.projectId === '2')!;
    expect(deleted.lastSeenBackupPointId).toBe('prev-manifest-id-abc');
  });

  it('does not set lastSeenBackupPointId on non-deleted entries', () => {
    const prev = makeManifest('m1', [makeProject({ projectId: '1', projectKey: 'A' })]);
    const current = makeManifest('m2', [makeProject({ projectId: '1', projectKey: 'A' })]);

    const { projects } = computeManifestDiff(current, prev);

    expect(projects[0].lastSeenBackupPointId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeManifestDiff — mixed scenario
// ---------------------------------------------------------------------------

describe('computeManifestDiff — mixed scenario', () => {
  it('correctly classifies added/modified/deleted/unchanged in one run', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'UNCHANGED', projectName: 'Same' }),
      makeProject({ projectId: '2', projectKey: 'MODIFIED', projectName: 'Old' }),
      makeProject({ projectId: '3', projectKey: 'DELETED' }),
    ]);

    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'UNCHANGED', projectName: 'Same' }),
      makeProject({ projectId: '2', projectKey: 'MODIFIED', projectName: 'New' }),
      makeProject({ projectId: '4', projectKey: 'ADDED' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    expect(summary).toEqual({ added: 1, modified: 1, deleted: 1, unchanged: 1 });
    expect(projects).toHaveLength(4);

    const unchanged = projects.find(p => p.projectId === '1')!;
    expect(unchanged.changeBadge).toBe('unchanged');

    const modified = projects.find(p => p.projectId === '2')!;
    expect(modified.changeBadge).toBe('modified');

    const added = projects.find(p => p.projectId === '4')!;
    expect(added.changeBadge).toBe('added');

    const deleted = projects.find(p => p.projectId === '3')!;
    expect(deleted.changeBadge).toBe('deleted');
    expect(deleted.lastSeenBackupPointId).toBe('m1');
  });

  it('summary total equals projects.length', () => {
    const prev = makeManifest('m1', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B', projectName: 'Old' }),
      makeProject({ projectId: '3', projectKey: 'C' }),
    ]);
    const current = makeManifest('m2', [
      makeProject({ projectId: '1', projectKey: 'A' }),
      makeProject({ projectId: '2', projectKey: 'B', projectName: 'New' }),
      makeProject({ projectId: '4', projectKey: 'D' }),
    ]);

    const { projects, summary } = computeManifestDiff(current, prev);

    const total = summary.added + summary.modified + summary.deleted + summary.unchanged;
    expect(total).toBe(projects.length);
  });
});
