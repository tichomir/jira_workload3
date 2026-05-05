import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { _setFetchForTesting, _resetFetch, handleCallback, TokenExchangeError, type FetchFn } from './tokenExchange.js';
import type { Request, Response } from 'express';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE connections (
      connectionId TEXT PRIMARY KEY,
      cloudId      TEXT NOT NULL UNIQUE,
      siteName     TEXT NOT NULL,
      accountId    TEXT,
      status       TEXT NOT NULL DEFAULT 'active',
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL
    );
    CREATE TABLE credentials (
      connectionId TEXT PRIMARY KEY REFERENCES connections(connectionId) ON DELETE CASCADE,
      accessToken  TEXT NOT NULL,
      refreshToken TEXT NOT NULL,
      expiresAt    INTEGER NOT NULL,
      scopes       TEXT NOT NULL,
      updatedAt    TEXT NOT NULL,
      clientId     TEXT,
      clientSecret TEXT
    );
    CREATE TABLE oauth_state (
      state        TEXT PRIMARY KEY,
      codeVerifier TEXT NOT NULL,
      clientId     TEXT NOT NULL,
      createdAt    TEXT NOT NULL,
      expiresAt    TEXT NOT NULL,
      connectionId TEXT,
      redirectUri  TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function makeReq(query: Record<string, string>): Request {
  return {
    query,
    protocol: 'http',
    get: (header: string) => (header === 'host' ? 'localhost:3000' : ''),
  } as unknown as Request;
}

type MockRes = {
  res: Response;
  statusCode: () => number;
  redirectUrl: () => string | undefined;
  jsonBody: () => unknown;
};

function makeRes(): MockRes {
  let code = 200;
  let redirected: string | undefined;
  let body: unknown;

  const res = {
    status(c: number) {
      code = c;
      return res;
    },
    json(b: unknown) {
      body = b;
      return res;
    },
    redirect(codeOrUrl: number | string, url?: string) {
      if (typeof codeOrUrl === 'number') {
        code = codeOrUrl;
        redirected = url;
      } else {
        redirected = codeOrUrl;
      }
      return res;
    },
  } as unknown as Response;

  return {
    res,
    statusCode: () => code,
    redirectUrl: () => redirected,
    jsonBody: () => body,
  };
}

function makeTokenFetch(cloudId = 'cloud-id-abc', accountId = 'acc-id-001'): FetchFn {
  return vi.fn(async (url: string): Promise<globalThis.Response> => {
    if (url === 'https://auth.atlassian.com/oauth/token') {
      return new globalThis.Response(
        JSON.stringify({
          access_token: 'access-token-123',
          refresh_token: 'refresh-token-456',
          expires_in: 3600,
          scope: 'read:jira-work write:jira-work',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return new globalThis.Response(
        JSON.stringify([
          {
            id: cloudId,
            name: 'My Jira Site',
            url: 'https://mysite.atlassian.net',
            scopes: [],
            avatarUrl: '',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.atlassian.com/me') {
      return new globalThis.Response(
        JSON.stringify({ accountId, displayName: 'Test User', emailAddress: 'test@example.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe('handleCallback — happy path', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('test-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    process.env['ATLASSIAN_CLIENT_SECRET'] = 'test-client-secret';
    _setFetchForTesting(makeTokenFetch());
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('creates a connections row with cloudId and siteName', async () => {
    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), res);

    const conn = db
      .prepare('SELECT * FROM connections WHERE cloudId = ?')
      .get('cloud-id-abc') as Record<string, unknown> | undefined;

    expect(conn).toBeDefined();
    expect(conn!['siteName']).toBe('My Jira Site');
  });

  it('stores the accountId from GET /me in the connections row', async () => {
    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), res);

    const conn = db
      .prepare('SELECT * FROM connections WHERE cloudId = ?')
      .get('cloud-id-abc') as Record<string, unknown> | undefined;

    expect(conn).toBeDefined();
    expect(conn!['accountId']).toBe('acc-id-001');
  });

  it('creates a credentials row with accessToken and refreshToken', async () => {
    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), res);

    const conn = db
      .prepare('SELECT connectionId FROM connections WHERE cloudId = ?')
      .get('cloud-id-abc') as { connectionId: string } | undefined;

    const creds = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get(conn!.connectionId) as { accessToken: string; refreshToken: string } | undefined;

    expect(creds).toBeDefined();
    expect(creds!.accessToken).toBe('access-token-123');
    expect(creds!.refreshToken).toBe('refresh-token-456');
  });

  it('redirects to /connections on success', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), mock.res);

    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toBe('/connections');
  });

  it('sends client_secret in the token exchange request body', async () => {
    const fetchSpy = makeTokenFetch();
    _setFetchForTesting(fetchSpy);

    // Re-insert state since the beforeEach one is consumed by other tests running first;
    // use a fresh state key to avoid conflicts
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('secret-test-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'secret-test-state' }), res);

    const tokenCall = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === 'https://auth.atlassian.com/oauth/token'
    );
    expect(tokenCall).toBeDefined();
    const body = JSON.parse((tokenCall![1] as RequestInit).body as string);
    expect(body.client_secret).toBe('test-client-secret');
    expect(body.client_id).toBe('test-client-id');
    expect(body.grant_type).toBe('authorization_code');
  });

  it('consumes the state so a second callback with the same state redirects with invalid_state', async () => {
    const { res: res1 } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), res1);

    // Re-inject fetch for second call (first call consumed the state)
    _setFetchForTesting(makeTokenFetch());
    const mock2 = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-456', state: 'test-state' }), mock2.res);

    expect(mock2.statusCode()).toBe(302);
    expect(mock2.redirectUrl()).toContain('error=invalid_state');
  });
});

describe('handleCallback — reauth cloudId mismatch (409)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES ('existing-conn-id', 'cloud-id-original', 'Original Site', 'active', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
       VALUES ('existing-conn-id', 'old-access', 'old-refresh', 9999999999, 'read:jira-work', ?)`
    ).run(now);

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      `INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt, connectionId)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('reauth-state', 'reauth-verifier', 'test-client-id', now, expiresAt, 'existing-conn-id');

    process.env['ATLASSIAN_CLIENT_SECRET'] = 'test-client-secret';
    // Fetch returns a DIFFERENT cloudId
    _setFetchForTesting(makeTokenFetch('cloud-id-DIFFERENT'));
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('redirects with cloudid_mismatch error', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'auth-code', state: 'reauth-state' }), mock.res);

    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=cloudid_mismatch');
    expect(mock.redirectUrl()).toContain('correlationId=');
  });
});

describe('handleCallback — input validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('redirects with missing_code_or_state when code is missing', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ state: 'some-state' }), mock.res);
    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=missing_code_or_state');
    expect(mock.redirectUrl()).toContain('correlationId=');
  });

  it('redirects with missing_code_or_state when state is missing', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'some-code' }), mock.res);
    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=missing_code_or_state');
  });

  it('redirects with invalid_state for an unknown state value', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'some-code', state: 'not-in-db' }), mock.res);
    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=invalid_state');
  });

  it('redirects with oauth_error when oauth provider returns an error', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ error: 'access_denied' }), mock.res);
    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=oauth_error');
  });

  it('redirects with server_misconfigured when ATLASSIAN_CLIENT_SECRET is not set', async () => {
    // Insert a valid state so the handler reaches the secret check
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('no-secret-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    const mock = makeRes();
    await handleCallback(makeReq({ code: 'auth-code', state: 'no-secret-state' }), mock.res);

    expect(mock.statusCode()).toBe(302);
    expect(mock.redirectUrl()).toContain('error=server_misconfigured');
    expect(mock.redirectUrl()).toContain('correlationId=');
  });
});

describe('TokenExchangeError — class contract', () => {
  it('carries status, atlassianError, atlassianErrorDescription, and atlassianBody', () => {
    const body = { error: 'invalid_client', error_description: 'Invalid client credentials' };
    const err = new TokenExchangeError(401, 'invalid_client', 'Invalid client credentials', body);
    expect(err.status).toBe(401);
    expect(err.atlassianError).toBe('invalid_client');
    expect(err.atlassianErrorDescription).toBe('Invalid client credentials');
    expect(err.atlassianBody).toEqual(body);
    expect(err.name).toBe('TokenExchangeError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('handleCallback — token exchange failure with Atlassian error body', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'test-client-secret';
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('redirects to /connections with error params including atlassian_error on 401 from token endpoint', async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('fail-state-401', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    _setFetchForTesting(vi.fn(async (url: string): Promise<globalThis.Response> => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return new globalThis.Response(
          JSON.stringify({ error: 'invalid_client', error_description: 'Invalid client credentials' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mock = makeRes();
    await handleCallback(makeReq({ code: 'auth-code', state: 'fail-state-401' }), mock.res);

    expect(mock.statusCode()).toBe(302);
    const url = mock.redirectUrl()!;
    expect(url).toContain('error=token_exchange_failed');
    expect(url).toContain('atlassian_error=invalid_client');
    expect(url).toContain('correlationId=');
  });

  it('logs the full Atlassian error body to stderr on token exchange failure', async () => {
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('fail-log-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    _setFetchForTesting(vi.fn(async (url: string): Promise<globalThis.Response> => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return new globalThis.Response(
          JSON.stringify({ error: 'unauthorized_client', error_description: 'Client not authorized' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { res } = makeRes();
      await handleCallback(makeReq({ code: 'auth-code', state: 'fail-log-state' }), res);

      const oauthCallLog = errorSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[oauth-callback]') && args[0].includes('token exchange failed')
      );
      expect(oauthCallLog).toBeDefined();
      expect(oauthCallLog![0]).toContain('unauthorized_client');
      expect(oauthCallLog![0]).toContain('atlassianBody=');
      expect(oauthCallLog![0]).toContain('correlationId=');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('handleCallback — redirectUri log line', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'test-client-secret';
    process.env['OAUTH_REDIRECT_URI'] = 'https://localhost:8443/api/oauth/callback';

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('redirect-log-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    _setFetchForTesting(makeTokenFetch());
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
    delete process.env['OAUTH_REDIRECT_URI'];
  });

  it('emits [oauth-callback] redirectUri log line during callback', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { res } = makeRes();
      await handleCallback(makeReq({ code: 'auth-code', state: 'redirect-log-state' }), res);

      const redirectLog = logSpy.mock.calls.find(
        (args) => typeof args[0] === 'string' && args[0].includes('[oauth-callback]') && args[0].includes('redirectUri=')
      );
      expect(redirectLog).toBeDefined();
      expect(redirectLog![0]).toContain('https://localhost:8443/api/oauth/callback');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('handleCallback — GET /me execution evidence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'test-client-secret';

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?)'
    ).run('me-state', 'test-verifier', 'test-client-id', new Date().toISOString(), expiresAt);

    _setFetchForTesting(makeTokenFetch());
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('persisted access_token successfully authenticates GET https://api.atlassian.com/me (returns 200 with accountId)', async () => {
    // Complete the OAuth callback — this stores the tokens
    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-me', state: 'me-state' }), res);

    // Retrieve the stored access_token from the credential store
    const conn = db
      .prepare('SELECT connectionId FROM connections WHERE cloudId = ?')
      .get('cloud-id-abc') as { connectionId: string } | undefined;
    expect(conn).toBeDefined();

    const creds = db
      .prepare('SELECT accessToken FROM credentials WHERE connectionId = ?')
      .get(conn!.connectionId) as { accessToken: string } | undefined;
    expect(creds).toBeDefined();

    const storedToken = creds!.accessToken;
    expect(storedToken).toBe('access-token-123');

    // Use the stored token to call GET https://api.atlassian.com/me
    const meMock = vi.fn(async (_url: string, init?: RequestInit): Promise<globalThis.Response> => {
      const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      if (authHeader === `Bearer ${storedToken}`) {
        return new globalThis.Response(
          JSON.stringify({ accountId: 'acc-id-001', displayName: 'Test Operator', emailAddress: 'op@example.com' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new globalThis.Response('Unauthorized', { status: 401 });
    });

    const meResp = await meMock('https://api.atlassian.com/me', {
      headers: { Authorization: `Bearer ${storedToken}`, Accept: 'application/json' },
    });

    expect(meResp.status).toBe(200);
    const meData = await meResp.json() as Record<string, unknown>;
    expect(meData['accountId']).toBe('acc-id-001');
    // Confirm the token used in the header matches the stored token
    const calledWith = meMock.mock.calls[0]!;
    const calledHeaders = calledWith[1]?.headers as Record<string, string>;
    expect(calledHeaders['Authorization']).toBe(`Bearer access-token-123`);
  });
});
