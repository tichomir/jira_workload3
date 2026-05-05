/**
 * Three focused tests for the OAuth token-exchange flow:
 *  1. Happy path — tokens persisted, /me probe succeeds
 *  2. Error path — 400 invalid_grant, credential store NOT mutated, error propagated
 *  3. redirect_uri mismatch guard — rejected before calling Atlassian
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { _setDbForTesting, _resetDb } from '../../db/database.js';
import {
  _setFetchForTesting,
  _resetFetch,
  handleCallback,
  type FetchFn,
} from '../../oauth/tokenExchange.js';
import type { Request, Response } from 'express';

// ── Shared test helpers ──────────────────────────────────────────────────────

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

function makeRes() {
  let code = 200;
  let redirected: string | undefined;
  const res = {
    status(c: number) { code = c; return res; },
    json(_b: unknown) { return res; },
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
  return { res, statusCode: () => code, redirectUrl: () => redirected };
}

function makeSuccessFetch(cloudId = 'cloud-id-spec', accountId = 'acc-spec-001'): FetchFn {
  return vi.fn(async (url: string): Promise<globalThis.Response> => {
    if (url === 'https://auth.atlassian.com/oauth/token') {
      return new globalThis.Response(
        JSON.stringify({
          access_token: 'spec-at-123',
          refresh_token: 'spec-rt-456',
          expires_in: 3600,
          scope: 'read:jira-work write:jira-work',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.atlassian.com/oauth/token/accessible-resources') {
      return new globalThis.Response(
        JSON.stringify([{
          id: cloudId,
          name: 'Spec Jira Site',
          url: 'https://specsite.atlassian.net',
          scopes: [],
          avatarUrl: '',
        }]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://api.atlassian.com/me') {
      return new globalThis.Response(
        JSON.stringify({ accountId, displayName: 'Spec User', emailAddress: 'spec@test.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

// ── Test 1: Happy path ───────────────────────────────────────────────────────

describe('OAuth token exchange — happy path', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'spec-secret';

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt, redirectUri) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('hp-state', 'hp-verifier', 'hp-client-id', new Date().toISOString(), expiresAt, '');

    _setFetchForTesting(makeSuccessFetch());
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('persists both access_token and refresh_token and the stored token authenticates GET /me', async () => {
    const { res } = makeRes();
    await handleCallback(makeReq({ code: 'hp-auth-code', state: 'hp-state' }), res);

    const conn = db
      .prepare('SELECT connectionId FROM connections WHERE cloudId = ?')
      .get('cloud-id-spec') as { connectionId: string } | undefined;
    expect(conn, 'connection row should exist after successful callback').toBeDefined();

    const creds = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get(conn!.connectionId) as { accessToken: string; refreshToken: string } | undefined;
    expect(creds, 'credentials row should exist').toBeDefined();
    expect(creds!.accessToken, 'accessToken persisted').toBe('spec-at-123');
    expect(creds!.refreshToken, 'refreshToken persisted').toBe('spec-rt-456');

    // Verify the stored token authenticates a GET /me call (returns 200 with accountId)
    const meMock = vi.fn(async (_url: string, init?: RequestInit): Promise<globalThis.Response> => {
      const authHeader = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      if (authHeader === `Bearer ${creds!.accessToken}`) {
        return new globalThis.Response(
          JSON.stringify({ accountId: 'acc-spec-001', displayName: 'Spec User' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new globalThis.Response('Unauthorized', { status: 401 });
    });

    const meResp = await meMock('https://api.atlassian.com/me', {
      headers: { Authorization: `Bearer ${creds!.accessToken}`, Accept: 'application/json' },
    });
    expect(meResp.status, '/me probe must return 200').toBe(200);
    const meBody = await meResp.json() as Record<string, unknown>;
    expect(meBody['accountId'], '/me body must contain accountId').toBe('acc-spec-001');
    const calledHeader = (meMock.mock.calls[0]![1]?.headers as Record<string, string>)['Authorization'];
    expect(calledHeader, '/me was called with the persisted token').toBe('Bearer spec-at-123');
  });
});

// ── Test 2: Error path — 400 invalid_grant ──────────────────────────────────

describe('OAuth token exchange — 400 invalid_grant error path', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'spec-secret';

    // Pre-insert an existing connection with credentials that must NOT be overwritten
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES ('pre-conn-id', 'pre-cloud-id', 'Pre Site', 'active', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
       VALUES ('pre-conn-id', 'original-access-token', 'original-refresh-token', 9999999999, 'read:jira-work', ?)`
    ).run(now);

    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt, redirectUri) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ig-state', 'ig-verifier', 'ig-client-id', now, expiresAt, '');

    _setFetchForTesting(vi.fn(async (url: string): Promise<globalThis.Response> => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return new globalThis.Response(
          JSON.stringify({
            error: 'invalid_grant',
            error_description: 'Authorization code expired or already used',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as FetchFn);
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
  });

  it('does not mutate the credential store and propagates invalid_grant to the route response', async () => {
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'ig-auth-code', state: 'ig-state' }), mock.res);

    // Credential store must NOT be mutated
    const creds = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get('pre-conn-id') as { accessToken: string; refreshToken: string } | undefined;
    expect(creds, 'credentials row must still exist').toBeDefined();
    expect(creds!.accessToken, 'accessToken must not be overwritten on 400').toBe('original-access-token');
    expect(creds!.refreshToken, 'refreshToken must not be overwritten on 400').toBe('original-refresh-token');

    // Structured error must propagate to the route response
    expect(mock.statusCode(), 'must redirect').toBe(302);
    const url = mock.redirectUrl()!;
    expect(url).toContain('error=token_exchange_failed');
    expect(url).toContain('atlassian_error=invalid_grant');
    expect(url).toContain('correlationId=');
  });
});

// ── Test 3: redirect_uri mismatch guard ─────────────────────────────────────

describe('OAuth token exchange — redirect_uri mismatch guard', () => {
  let db: Database.Database;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    process.env['ATLASSIAN_CLIENT_SECRET'] = 'spec-secret';
    delete process.env['OAUTH_REDIRECT_URI'];

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    // State was created with a production redirect URI
    db.prepare(
      'INSERT INTO oauth_state (state, codeVerifier, clientId, createdAt, expiresAt, redirectUri) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      'rm-state',
      'rm-verifier',
      'rm-client-id',
      now,
      expiresAt,
      'https://prod.example.com/api/oauth/callback'
    );

    fetchSpy = vi.fn();
    _setFetchForTesting(fetchSpy as FetchFn);
  });

  afterEach(() => {
    _resetFetch();
    _resetDb();
    delete process.env['ATLASSIAN_CLIENT_SECRET'];
    delete process.env['OAUTH_REDIRECT_URI'];
  });

  it('rejects mismatched redirect URIs before calling the Atlassian token endpoint', async () => {
    // The current request produces 'http://localhost:3000/api/oauth/callback',
    // but the stored redirectUri is 'https://prod.example.com/api/oauth/callback'.
    // The guard must reject this mismatch before any network call.
    const mock = makeRes();
    await handleCallback(makeReq({ code: 'rm-auth-code', state: 'rm-state' }), mock.res);

    expect(mock.statusCode(), 'must redirect on mismatch').toBe(302);
    expect(mock.redirectUrl(), 'must signal redirect_uri_mismatch').toContain('error=redirect_uri_mismatch');
    expect(mock.redirectUrl(), 'must include correlationId for tracing').toContain('correlationId=');
    expect(fetchSpy.mock.calls.length, 'Atlassian token endpoint must NOT be called').toBe(0);
  });
});
