import { getDb } from '../../db/database.js';
import type { GuardResult } from './types.js';

export const REQUIRED_BOARD_SCOPES = [
  'write:board-scope:jira-software',
  'write:board-scope.admin:jira-software',
] as const;

/**
 * Pure scope-check logic — parses a raw space-separated scope string and
 * verifies both required board-scope variants are present.
 *
 * Emits a [permission-probe] structured log line for each scope variant.
 * Source: T2 §4.2.2, T5 §5.2.
 */
export function checkBoardScopesFromString(scopeString: string): GuardResult {
  const grantedScopes = new Set(scopeString.split(' ').filter(Boolean));
  const missingScopes: string[] = [];

  for (const scope of REQUIRED_BOARD_SCOPES) {
    const outcome = grantedScopes.has(scope) ? 'ok' : 'missing';
    console.log(`[permission-probe] scope=${scope} outcome=${outcome}`);
    if (outcome === 'missing') {
      missingScopes.push(scope);
    }
  }

  if (missingScopes.length === 0) {
    return { passed: true, guardName: 'board-scope-recheck' };
  }

  return {
    passed: false,
    guardName: 'board-scope-recheck',
    failureCode: 'scope_missing',
    failureMessage: `Missing required board scope(s): ${missingScopes.join(', ')}`,
    missingScopes,
  };
}

/**
 * Board-scope re-check guard — reads the stored scope string for the given
 * connectionId from the credentials table and verifies both
 * write:board-scope:jira-software variants are present.
 *
 * Uses the database directly (scopes are persisted at token-exchange time and
 * updated atomically on every refresh via JiraHttpClient). No additional HTTP
 * request is required.
 *
 * Source: T2 §4.2.2, T5 §5.2.
 */
export function checkBoardScopes(connectionId: string): GuardResult {
  const db = getDb();
  const row = db
    .prepare('SELECT scopes FROM credentials WHERE connectionId = ?')
    .get(connectionId) as { scopes: string | null } | undefined;

  const scopeString = row?.scopes ?? '';
  return checkBoardScopesFromString(scopeString);
}
