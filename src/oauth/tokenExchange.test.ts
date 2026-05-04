import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { _setFetchForTesting, _resetFetch, handleCallback, type FetchFn } from './tokenExchange.js';
import type { Request, Response } from 'express';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE connections (
      connectionId TEXT PRIMARY KEY,
      cloudId      TEXT NOT NULL UNIQUE,
      siteName     TEXT NOT NULL,
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
      connectionId TEXT
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

function makeTokenFetch(cloudId = 'cloud-id-abc'): FetchFn {
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

    _setFetchForTesting(makeTokenFetch());
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
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

  it('consumes the state so a second callback with the same state fails', async () => {
    const { res: res1 } = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-123', state: 'test-state' }), res1);

    // Re-inject fetch for second call (first call consumed the state)
    _setFetchForTesting(makeTokenFetch());
    const mock2 = makeRes();
    await handleCallback(makeReq({ code: 'auth-code-456', state: 'test-state' }), mock2.res);

    expect(mock2.statusCode()).toBe(400);
    expect(mock2.jsonBody()).toEqual({ error: 'invalid_state' });
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

    // Fetch returns a DIFFERENT cloudId
    _setFetchForTesting(makeTokenFetch('cloud-id-DIFFERENT'));
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
  });

  it('returns 409 with cloudid_mismatch', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'auth-code', state: 'reauth-state' }), mock.res);

    expect(mock.statusCode()).toBe(409);
    expect(mock.jsonBody()).toEqual({ error: 'cloudid_mismatch' });
  });
});

describe('handleCallback — input validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
  });

  it('returns 400 when code is missing', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ state: 'some-state' }), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect(mock.jsonBody()).toEqual({ error: 'missing_code_or_state' });
  });

  it('returns 400 when state is missing', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'some-code' }), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect(mock.jsonBody()).toEqual({ error: 'missing_code_or_state' });
  });

  it('returns 400 for an unknown state value', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'some-code', state: 'not-in-db' }), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect(mock.jsonBody()).toEqual({ error: 'invalid_state' });
  });

  it('returns 400 when oauth provider returns an error', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ error: 'access_denied' }), mock.res);
    expect(mock.statusCode()).toBe(400);
  });
});
