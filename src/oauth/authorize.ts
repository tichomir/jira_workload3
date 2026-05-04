import { randomBytes, createHash } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';

// Full T2 §4.2.2 Phase 1 scope set — both board-scope variants are required
export const PHASE1_SCOPES = [
  'offline_access',
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'manage:jira-project',
  'manage:jira-configuration',
  'read:board-scope:jira-software',
  'write:board-scope:jira-software',
  'write:board-scope.admin:jira-software',
  'read:sprint:jira-software',
  'write:sprint:jira-software',
].join(' ');

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64urlEncode(randomBytes(32));
  const codeChallenge = base64urlEncode(
    createHash('sha256').update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

/**
 * Builds the Atlassian authorization URL with PKCE.
 * Pure function — no I/O; safe to call in tests without a database.
 */
export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: clientId,
    scope: PHASE1_SCOPES,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${ATLASSIAN_AUTH_URL}?${params.toString()}`;
}

export function handleAuthorize(req: Request, res: Response): void {
  const clientId = process.env['ATLASSIAN_CLIENT_ID'];

  if (!clientId) {
    res.status(500).json({ error: 'ATLASSIAN_CLIENT_ID is not configured' });
    return;
  }

  const redirectUri =
    process.env['OAUTH_REDIRECT_URI'] ??
    `${req.protocol}://${req.get('host')}/api/oauth/callback`;

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = base64urlEncode(randomBytes(16));

  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();

  db.prepare(
    'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
  ).run(state, codeVerifier, clientId, now.toISOString(), expiresAt);

  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
  res.redirect(302, authorizeUrl);
}
