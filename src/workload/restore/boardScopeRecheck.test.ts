import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBoardScopesFromString, REQUIRED_BOARD_SCOPES } from './boardScopeRecheck.js';

describe('checkBoardScopesFromString', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('happy path: both scopes present — passed=true, no missingScopes', () => {
    const scopeString = [
      'read:jira-user',
      'write:board-scope:jira-software',
      'write:board-scope.admin:jira-software',
      'write:jira-work',
    ].join(' ');

    const result = checkBoardScopesFromString(scopeString);

    expect(result.passed).toBe(true);
    expect(result.guardName).toBe('board-scope-recheck');
    expect(result.missingScopes).toBeUndefined();
    expect(result.failureCode).toBeUndefined();
  });

  it('happy path: emits [permission-probe] log line with outcome=ok for each scope variant', () => {
    const scopeString = [
      'write:board-scope:jira-software',
      'write:board-scope.admin:jira-software',
    ].join(' ');

    checkBoardScopesFromString(scopeString);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope:jira-software outcome=ok'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope.admin:jira-software outcome=ok'
    );
  });

  it('missing both scopes: passed=false, both listed in missingScopes', () => {
    const result = checkBoardScopesFromString('read:jira-user write:jira-work');

    expect(result.passed).toBe(false);
    expect(result.guardName).toBe('board-scope-recheck');
    expect(result.failureCode).toBe('scope_missing');
    expect(result.missingScopes).toEqual([...REQUIRED_BOARD_SCOPES]);
    expect(result.failureMessage).toContain('write:board-scope:jira-software');
    expect(result.failureMessage).toContain('write:board-scope.admin:jira-software');
  });

  it('missing both scopes: emits [permission-probe] log line with outcome=missing for each variant', () => {
    checkBoardScopesFromString('read:jira-user');

    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope:jira-software outcome=missing'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope.admin:jira-software outcome=missing'
    );
  });

  it('missing only write:board-scope.admin:jira-software — plain scope present', () => {
    const result = checkBoardScopesFromString(
      'read:jira-user write:board-scope:jira-software write:jira-work'
    );

    expect(result.passed).toBe(false);
    expect(result.missingScopes).toEqual(['write:board-scope.admin:jira-software']);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope:jira-software outcome=ok'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      '[permission-probe] scope=write:board-scope.admin:jira-software outcome=missing'
    );
  });

  it('missing only write:board-scope:jira-software — admin variant present', () => {
    const result = checkBoardScopesFromString(
      'read:jira-user write:board-scope.admin:jira-software write:jira-work'
    );

    expect(result.passed).toBe(false);
    expect(result.missingScopes).toEqual(['write:board-scope:jira-software']);
  });

  it('empty scope string: both scopes missing', () => {
    const result = checkBoardScopesFromString('');

    expect(result.passed).toBe(false);
    expect(result.missingScopes).toHaveLength(2);
  });

  it('log lines are emitted for exactly two scope variants', () => {
    checkBoardScopesFromString('write:board-scope:jira-software write:board-scope.admin:jira-software');

    const probeLines = consoleSpy.mock.calls.filter((args) =>
      String(args[0]).startsWith('[permission-probe]')
    );
    expect(probeLines).toHaveLength(2);
  });
});
