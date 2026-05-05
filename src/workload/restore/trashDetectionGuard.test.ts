import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runTrashDetection,
  extractProjectKeys,
  type TrashChecker,
} from './trashDetectionGuard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrashedChecker(trashedKey: string, daysInTrash = 15): TrashChecker {
  return async (key) => ({
    projectId: `id-${key.toLowerCase()}`,
    projectKey: key,
    inTrash: key === trashedKey,
    trashedAt: key === trashedKey ? '2026-04-20T00:00:00Z' : undefined,
    daysInTrash: key === trashedKey ? daysInTrash : undefined,
  });
}

function makeNonTrashedChecker(): TrashChecker {
  return async (key) => ({
    projectId: `id-${key.toLowerCase()}`,
    projectKey: key,
    inTrash: false,
  });
}

// ---------------------------------------------------------------------------
// runTrashDetection
// ---------------------------------------------------------------------------

describe('runTrashDetection', () => {
  let consoleSpy: { mockRestore(): void };

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // (1) trashed + original → block (force alternate, passed=false)
  it('trashed + original: guard returns passed=false and forces alternate-location', async () => {
    const checker = makeTrashedChecker('PROJ');
    const result = await runTrashDetection(['PROJ'], 'original', checker);

    expect(result.forcedAlternate).toBe(true);
    expect(result.guardResults).toHaveLength(1);
    expect(result.guardResults[0].passed).toBe(false);
    expect(result.guardResults[0].guardName).toBe('trash-detection');
    expect(result.guardResults[0].failureCode).toBe('project_in_trash');
    expect(result.guardResults[0].failureMessage).toContain('PROJ');

    expect(result.trashStatuses).toHaveLength(1);
    expect(result.trashStatuses[0].inTrash).toBe(true);
    expect(result.trashStatuses[0].alternateLocationRequired).toBe(true);
    expect(result.trashStatuses[0].projectKey).toBe('PROJ');
  });

  // (2) trashed + alternate → allow (passed=true, no forced alternate)
  it('trashed + alternate: guard allows through (passed=true)', async () => {
    const checker = makeTrashedChecker('PROJ');
    const result = await runTrashDetection(['PROJ'], 'alternate', checker);

    expect(result.forcedAlternate).toBe(false);
    expect(result.guardResults).toHaveLength(1);
    expect(result.guardResults[0].passed).toBe(true);
    expect(result.guardResults[0].failureCode).toBeUndefined();

    expect(result.trashStatuses[0].inTrash).toBe(true);
    expect(result.trashStatuses[0].alternateLocationRequired).toBe(false);
  });

  // (3) trashed + export → allow (passed=true, no forced alternate)
  it('trashed + export: guard allows through (passed=true)', async () => {
    const checker = makeTrashedChecker('PROJ');
    const result = await runTrashDetection(['PROJ'], 'export', checker);

    expect(result.forcedAlternate).toBe(false);
    expect(result.guardResults[0].passed).toBe(true);
    expect(result.trashStatuses[0].alternateLocationRequired).toBe(false);
  });

  // (4) non-trashed + original → allow (passed=true)
  it('non-trashed + original: guard allows through (passed=true)', async () => {
    const checker = makeNonTrashedChecker();
    const result = await runTrashDetection(['PROJ'], 'original', checker);

    expect(result.forcedAlternate).toBe(false);
    expect(result.guardResults).toHaveLength(1);
    expect(result.guardResults[0].passed).toBe(true);
    expect(result.guardResults[0].failureCode).toBeUndefined();

    expect(result.trashStatuses[0].inTrash).toBe(false);
    expect(result.trashStatuses[0].alternateLocationRequired).toBe(false);
  });

  it('emits one structured log line per project checked', async () => {
    const checker = makeNonTrashedChecker();
    await runTrashDetection(['PROJ', 'ABC', 'XYZ'], 'original', checker);

    expect(consoleSpy).toHaveBeenCalledTimes(3);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('guard=trash-detection projectKey=PROJ trashed=false')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('guard=trash-detection projectKey=ABC trashed=false')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('guard=trash-detection projectKey=XYZ trashed=false')
    );
  });

  it('trashed + original log line shows trashed=true', async () => {
    const checker = makeTrashedChecker('PROJ');
    await runTrashDetection(['PROJ'], 'original', checker);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('guard=trash-detection projectKey=PROJ trashed=true')
    );
  });

  it('mixed selection: only trashed+original project forces alternate, others pass', async () => {
    // PROJ is trashed, ABC is not
    const checker: TrashChecker = async (key) => ({
      projectId: `id-${key}`,
      projectKey: key,
      inTrash: key === 'PROJ',
      trashedAt: key === 'PROJ' ? '2026-04-10T00:00:00Z' : undefined,
      daysInTrash: key === 'PROJ' ? 25 : undefined,
    });
    const result = await runTrashDetection(['PROJ', 'ABC'], 'original', checker);

    expect(result.forcedAlternate).toBe(true);
    expect(result.guardResults).toHaveLength(2);
    expect(result.guardResults[0].passed).toBe(false); // PROJ trashed+original
    expect(result.guardResults[1].passed).toBe(true);  // ABC non-trashed
    expect(result.trashStatuses[0].alternateLocationRequired).toBe(true);
    expect(result.trashStatuses[1].alternateLocationRequired).toBe(false);
  });

  it('empty project keys list returns empty results', async () => {
    const checker = makeNonTrashedChecker();
    const result = await runTrashDetection([], 'original', checker);

    expect(result.forcedAlternate).toBe(false);
    expect(result.trashStatuses).toHaveLength(0);
    expect(result.guardResults).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractProjectKeys
// ---------------------------------------------------------------------------

describe('extractProjectKeys', () => {
  it('extracts prefix from issue keys', () => {
    expect(extractProjectKeys(['PROJ-1', 'PROJ-42', 'ABC-7'])).toEqual(
      expect.arrayContaining(['PROJ', 'ABC'])
    );
  });

  it('keeps pure project keys unchanged', () => {
    expect(extractProjectKeys(['PROJ', 'MYPROJECT'])).toEqual(
      expect.arrayContaining(['PROJ', 'MYPROJECT'])
    );
  });

  it('skips numeric IDs (board/sprint IDs)', () => {
    expect(extractProjectKeys(['10001', '99'])).toHaveLength(0);
  });

  it('deduplicates project keys from mixed selection', () => {
    const result = extractProjectKeys(['PROJ', 'PROJ-1', 'PROJ-2']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('PROJ');
  });

  it('handles mixed selection', () => {
    const result = extractProjectKeys(['PROJ-1', 'ABC', '12345', 'XYZ-99']);
    expect(result).toEqual(expect.arrayContaining(['PROJ', 'ABC', 'XYZ']));
    expect(result).not.toContain('12345');
  });
});
