import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

export type FetchFn = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

let _fetchFn: FetchFn = globalThis.fetch.bind(globalThis);

export function _setFetchForTesting(fn: FetchFn): void {
  _fetchFn = fn;
}

export function _resetFetch(): void {
  _fetchFn = globalThis.fetch.bind(globalThis);
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface AccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<TokenResponse> {
  const resp = await _fetchFn(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token exchange failed: HTTP ${resp.status}`);
  }

  return resp.json() as Promise<TokenResponse>;
}

export async function getAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  const resp = await _fetchFn(ATLASSIAN_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!resp.ok) {
    throw new Error(`accessible-resources failed: HTTP ${resp.status}`);
  }

  return resp.json() as Promise<AccessibleResource[]>;
}

export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  if (error) {
    res.status(400).json({ error: `oauth_error: ${error}` });
    return;
  }

  if (!code || !state) {
    res.status(400).json({ error: 'missing_code_or_state' });
    return;
  }

  const db = getDb();

  const stateRow = db
    .prepare(
      'SELECT codeVerifier, clientId, connectionId, expiresAt FROM oauth_state WHERE state = ?'
    )
    .get(state) as
    | { codeVerifier: string; clientId: string; connectionId: string | null; expiresAt: string }
    | undefined;

  if (!stateRow) {
    res.status(400).json({ error: 'invalid_state' });
    return;
  }

  if (new Date(stateRow.expiresAt) < new Date()) {
    db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
    res.status(400).json({ error: 'state_expired' });
    return;
  }

  // One-time use: consume the state before any network calls
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);

  const redirectUri =
    process.env['OAUTH_REDIRECT_URI'] ??
    `${req.protocol}://${req.get('host')}/api/oauth/callback`;

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCodeForTokens(
      code,
      stateRow.codeVerifier,
      stateRow.clientId,
      redirectUri
    );
  } catch (err) {
    console.error('[oauth-callback] token exchange failed:', err);
    res.status(502).json({ error: 'token_exchange_failed' });
    return;
  }

  let resources: AccessibleResource[];
  try {
    resources = await getAccessibleResources(tokens.access_token);
  } catch (err) {
    console.error('[oauth-callback] accessible-resources failed:', err);
    res.status(502).json({ error: 'resources_fetch_failed' });
    return;
  }

  if (resources.length === 0) {
    res.status(400).json({ error: 'no_accessible_resources' });
    return;
  }

  const resource = resources[0]!;
  const cloudId = resource.id;
  const siteName = resource.name;

  // Reauth: enforce cloudId match against the original connection
  if (stateRow.connectionId) {
    const existing = db
      .prepare('SELECT cloudId FROM connections WHERE connectionId = ?')
      .get(stateRow.connectionId) as { cloudId: string } | undefined;

    if (existing && existing.cloudId !== cloudId) {
      res.status(409).json({ error: 'cloudid_mismatch' });
      return;
    }
  }

  const now = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;
  const scopes = tokens.scope;

  const existingByCloud = db
    .prepare('SELECT connectionId FROM connections WHERE cloudId = ?')
    .get(cloudId) as { connectionId: string } | undefined;

  const connectionId = existingByCloud?.connectionId ?? randomUUID();

  db.transaction(() => {
    if (existingByCloud) {
      db.prepare(
        `UPDATE connections SET siteName = ?, status = 'active', updatedAt = ? WHERE connectionId = ?`
      ).run(siteName, now, connectionId);

      db.prepare(
        `UPDATE credentials
            SET accessToken = ?, refreshToken = ?, expiresAt = ?, scopes = ?, updatedAt = ?, clientId = ?
          WHERE connectionId = ?`
      ).run(
        tokens.access_token,
        tokens.refresh_token,
        expiresAt,
        scopes,
        now,
        stateRow.clientId,
        connectionId
      );
    } else {
      db.prepare(
        `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', ?, ?)`
      ).run(connectionId, cloudId, siteName, now, now);

      db.prepare(
        `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt, clientId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        connectionId,
        tokens.access_token,
        tokens.refresh_token,
        expiresAt,
        scopes,
        now,
        stateRow.clientId
      );
    }
  })();

  console.log(
    `[oauth-callback] connection upserted: connectionId=${connectionId} cloudId=${cloudId}`
  );
  res.redirect(302, '/connections');
}
