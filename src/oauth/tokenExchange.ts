import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { config } from '../config.js';

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';
const ATLASSIAN_ME_URL = 'https://api.atlassian.com/me';

export type FetchFn = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

let _fetchFn: FetchFn = globalThis.fetch.bind(globalThis);

export function _setFetchForTesting(fn: FetchFn): void {
  _fetchFn = fn;
}

export function _resetFetch(): void {
  _fetchFn = globalThis.fetch.bind(globalThis);
}

export class TokenExchangeError extends Error {
  constructor(
    public readonly status: number,
    public readonly atlassianError: string,
    public readonly atlassianErrorDescription: string,
    public readonly atlassianBody: unknown
  ) {
    super(`Token exchange failed: HTTP ${status}${atlassianError ? ` (${atlassianError})` : ''}`);
    this.name = 'TokenExchangeError';
  }
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

interface MeResponse {
  accountId: string;
  displayName?: string;
  emailAddress?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TokenResponse> {
  const resp = await _fetchFn(ATLASSIAN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    let body: unknown = null;
    try {
      body = await resp.json();
    } catch {
      try { body = await resp.text(); } catch { /* unreadable */ }
    }
    const errObj = (typeof body === 'object' && body !== null) ? body as Record<string, unknown> : {};
    throw new TokenExchangeError(
      resp.status,
      String(errObj['error'] ?? ''),
      String(errObj['error_description'] ?? ''),
      body
    );
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

export async function getMe(accessToken: string): Promise<MeResponse> {
  const resp = await _fetchFn(ATLASSIAN_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  if (!resp.ok) {
    throw new Error(`GET /me failed: HTTP ${resp.status}`);
  }

  return resp.json() as Promise<MeResponse>;
}

function errorRedirect(error: string, description: string, correlationId: string, extra?: Record<string, string>): string {
  const p = new URLSearchParams({ error, description, correlationId, ...extra });
  return `/connections?${p.toString()}`;
}

export async function handleCallback(req: Request, res: Response): Promise<void> {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const correlationId = randomUUID();

  if (error) {
    console.error(`[oauth-callback] correlationId=${correlationId} oauth_error=${error}`);
    res.redirect(302, errorRedirect('oauth_error', `Atlassian returned: ${error}`, correlationId));
    return;
  }

  if (!code || !state) {
    console.error(`[oauth-callback] correlationId=${correlationId} missing_code_or_state`);
    res.redirect(302, errorRedirect('missing_code_or_state', 'Missing authorization code or state parameter', correlationId));
    return;
  }

  const db = getDb();

  const stateRow = db
    .prepare(
      'SELECT codeVerifier, clientId, connectionId, expiresAt, redirectUri FROM oauth_state WHERE state = ?'
    )
    .get(state) as
    | { codeVerifier: string; clientId: string; connectionId: string | null; expiresAt: string; redirectUri: string }
    | undefined;

  if (!stateRow) {
    console.error(`[oauth-callback] correlationId=${correlationId} invalid_state`);
    res.redirect(302, errorRedirect('invalid_state', 'Invalid or unknown authorization state', correlationId));
    return;
  }

  if (new Date(stateRow.expiresAt) < new Date()) {
    db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);
    console.error(`[oauth-callback] correlationId=${correlationId} state_expired`);
    res.redirect(302, errorRedirect('state_expired', 'Authorization state has expired — please try again', correlationId));
    return;
  }

  // One-time use: consume the state before any network calls
  db.prepare('DELETE FROM oauth_state WHERE state = ?').run(state);

  const currentRedirectUri =
    config.oauthRedirectUri ||
    `${req.protocol}://${req.get('host')}/api/oauth/callback`;

  const storedRedirectUri = stateRow.redirectUri ?? '';
  if (storedRedirectUri !== '' && storedRedirectUri !== currentRedirectUri) {
    console.error(
      `[oauth-callback] correlationId=${correlationId} redirect_uri_mismatch stored=${storedRedirectUri} current=${currentRedirectUri}`
    );
    res.redirect(302, errorRedirect('redirect_uri_mismatch', 'Redirect URI mismatch — ensure OAUTH_REDIRECT_URI matches the value used during authorization', correlationId));
    return;
  }

  const redirectUri = storedRedirectUri || currentRedirectUri;
  console.log(`[oauth-callback] redirectUri=${redirectUri}`);

  const clientSecret = config.atlassianClientSecret;
  if (!clientSecret) {
    console.error(`[oauth-callback] correlationId=${correlationId} ATLASSIAN_CLIENT_SECRET is not configured`);
    res.redirect(302, errorRedirect('server_misconfigured', 'Server is missing OAuth credentials — contact your administrator', correlationId));
    return;
  }

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCodeForTokens(
      code,
      stateRow.codeVerifier,
      stateRow.clientId,
      clientSecret,
      redirectUri
    );
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      console.error(
        `[oauth-callback] correlationId=${correlationId} token exchange failed: status=${err.status} atlassianBody=${JSON.stringify(err.atlassianBody)}`
      );
      const description = err.atlassianErrorDescription || err.atlassianError || 'Token exchange failed';
      const extra: Record<string, string> = {};
      if (err.atlassianError) extra['atlassian_error'] = err.atlassianError;
      res.redirect(302, errorRedirect('token_exchange_failed', description, correlationId, extra));
    } else {
      console.error(`[oauth-callback] correlationId=${correlationId} token exchange failed:`, err);
      res.redirect(302, errorRedirect('token_exchange_failed', 'Token exchange failed unexpectedly', correlationId));
    }
    return;
  }

  let resources: AccessibleResource[];
  try {
    resources = await getAccessibleResources(tokens.access_token);
  } catch (err) {
    console.error(`[oauth-callback] correlationId=${correlationId} accessible-resources failed:`, err);
    res.redirect(302, errorRedirect('resources_fetch_failed', 'Failed to retrieve accessible Jira sites', correlationId));
    return;
  }

  if (resources.length === 0) {
    console.error(`[oauth-callback] correlationId=${correlationId} no_accessible_resources`);
    res.redirect(302, errorRedirect('no_accessible_resources', 'No accessible Jira sites found for this account', correlationId));
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
      console.error(`[oauth-callback] correlationId=${correlationId} cloudid_mismatch`);
      res.redirect(302, errorRedirect('cloudid_mismatch', 'The authorized site does not match the original connection', correlationId));
      return;
    }
  }

  // Fetch accountId from /me — soft failure, store NULL if unavailable
  let accountId: string | null = null;
  try {
    const me = await getMe(tokens.access_token);
    accountId = me.accountId;
  } catch (err) {
    console.warn(`[oauth-callback] correlationId=${correlationId} GET /me failed (non-fatal):`, err);
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
        `UPDATE connections SET siteName = ?, accountId = ?, status = 'active', updatedAt = ? WHERE connectionId = ?`
      ).run(siteName, accountId, now, connectionId);

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
        `INSERT INTO connections (connectionId, cloudId, siteName, accountId, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'active', ?, ?)`
      ).run(connectionId, cloudId, siteName, accountId, now, now);

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
    `[oauth-callback] connection upserted: connectionId=${connectionId} cloudId=${cloudId} accountId=${accountId ?? 'unknown'}`
  );
  res.redirect(302, '/connections');
}
