import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { handleCreateConnection } from './connections.js';

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
      clientId     TEXT,
      clientSecret TEXT,
      updatedAt    TEXT NOT NULL
    );
    CREATE TABLE probe_results (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId      TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      endpoint          TEXT    NOT NULL,
      status            INTEGER NOT NULL,
      duration_ms       INTEGER NOT NULL,
      remediationNeeded INTEGER NOT NULL DEFAULT 0,
      checkedAt         TEXT    NOT NULL
    );
  `);
  return db;
}

type MockRes = {
  res: Response;
  statusCode: () => number;
  jsonBody: () => unknown;
};

function makeRes(): MockRes {
  let code = 200;
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
  } as unknown as Response;

  return { res, statusCode: () => code, jsonBody: () => body };
}

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

describe('POST /api/connections — OAuth completion', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 201 with connectionId, cloudId, siteName, scopes, createdAt on success', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        cloudId: 'cloud-abc-001',
        siteName: 'my-site.atlassian.net',
        accessToken: 'access-001',
        refreshToken: 'refresh-001',
        expiresAt: 9999999999,
        scopes: ['read:jira-work', 'write:jira-work'],
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['connectionId']).toBeTypeOf('string');
    expect(body['cloudId']).toBe('cloud-abc-001');
    expect(body['siteName']).toBe('my-site.atlassian.net');
    expect(body['scopes']).toEqual(['read:jira-work', 'write:jira-work']);
    expect(body['createdAt']).toBeTypeOf('string');
  });

  it('persists the connection and credentials to the database', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        cloudId: 'cloud-abc-002',
        siteName: 'test-site.atlassian.net',
        accessToken: 'at-002',
        refreshToken: 'rt-002',
        expiresAt: 9999999999,
      }),
      mock.res
    );

    const { connectionId } = mock.jsonBody() as { connectionId: string };
    const conn = db
      .prepare('SELECT * FROM connections WHERE connectionId = ?')
      .get(connectionId) as Record<string, unknown> | undefined;
    expect(conn).toBeDefined();
    expect(conn!['cloudId']).toBe('cloud-abc-002');

    const creds = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get(connectionId) as { accessToken: string; refreshToken: string } | undefined;
    expect(creds).toBeDefined();
    expect(creds!.accessToken).toBe('at-002');
    expect(creds!.refreshToken).toBe('rt-002');
  });

  it('returns 400 when required OAuth fields are missing', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({ cloudId: 'cloud-xyz', siteName: 'foo.atlassian.net' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('updates existing connection on re-submission with same cloudId', () => {
    const mock1 = makeRes();
    handleCreateConnection(
      makeReq({
        cloudId: 'cloud-dup-001',
        siteName: 'Original Site',
        accessToken: 'at-old',
        refreshToken: 'rt-old',
        expiresAt: 1000,
      }),
      mock1.res
    );

    const mock2 = makeRes();
    handleCreateConnection(
      makeReq({
        cloudId: 'cloud-dup-001',
        siteName: 'Updated Site',
        accessToken: 'at-new',
        refreshToken: 'rt-new',
        expiresAt: 2000,
      }),
      mock2.res
    );

    expect(mock2.statusCode()).toBe(201);
    const { connectionId } = mock2.jsonBody() as { connectionId: string };
    expect(
      (db.prepare('SELECT siteName FROM connections WHERE connectionId = ?').get(connectionId) as {
        siteName: string;
      }).siteName
    ).toBe('Updated Site');
  });
});

describe('POST /api/connections — Manual connection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 201 with clientIdMasked showing last 4 chars', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        mode: 'manual',
        cloudId: 'cloud-manual-001',
        siteName: 'manual-site.atlassian.net',
        clientId: 'ABCD-EFG-WXYZ',
        clientSecret: 'super-secret-value',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['connectionId']).toBeTypeOf('string');
    expect(body['cloudId']).toBe('cloud-manual-001');
    expect(body['siteName']).toBe('manual-site.atlassian.net');
    expect(body['clientIdMasked']).toBe('****WXYZ');
    expect(body['scopes']).toEqual([]);
    expect(body['createdAt']).toBeTypeOf('string');
  });

  it('also works with connectionType discriminator', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        connectionType: 'manual',
        cloudId: 'cloud-manual-002',
        siteName: 'ct-site.atlassian.net',
        clientId: 'CT-CLIENT-1234',
        clientSecret: 'ct-secret',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['clientIdMasked']).toBe('****1234');
  });

  it('stores clientId and clientSecret in the credentials table', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        mode: 'manual',
        cloudId: 'cloud-manual-003',
        siteName: 'store-site.atlassian.net',
        clientId: 'STORE-CLIENT-ABCD',
        clientSecret: 'stored-secret',
      }),
      mock.res
    );

    const { connectionId } = mock.jsonBody() as { connectionId: string };
    const creds = db
      .prepare('SELECT clientId, clientSecret FROM credentials WHERE connectionId = ?')
      .get(connectionId) as { clientId: string; clientSecret: string } | undefined;

    expect(creds).toBeDefined();
    expect(creds!.clientId).toBe('STORE-CLIENT-ABCD');
    expect(creds!.clientSecret).toBe('stored-secret');
  });

  it('does not return clientSecret in response', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        mode: 'manual',
        cloudId: 'cloud-manual-004',
        siteName: 'nosecret.atlassian.net',
        clientId: 'NO-SECRET-ZZZZ',
        clientSecret: 'this-must-not-appear',
      }),
      mock.res
    );

    const body = mock.jsonBody() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('this-must-not-appear');
    expect(body['clientIdMasked']).toBeDefined();
    expect(body['clientIdMasked']).not.toContain('NO-SECRET');
  });

  it('returns 400 when clientId is missing', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        mode: 'manual',
        cloudId: 'cloud-bad',
        siteName: 'bad.atlassian.net',
        clientSecret: 'only-secret',
      }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });
});

describe('POST /api/connections — cloudId mismatch 409', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES ('existing-conn', 'cloud-original', 'Original Site', 'active', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
       VALUES ('existing-conn', 'at-old', 'rt-old', 9999999999, 'read:jira-work', ?)`
    ).run(now);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 409 with cloudid_mismatch when connectionId re-auth has different cloudId (OAuth)', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        connectionId: 'existing-conn',
        cloudId: 'cloud-DIFFERENT',
        siteName: 'Original Site',
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        expiresAt: 9999999999,
        scopes: ['read:jira-work'],
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(409);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('cloudid_mismatch');
    expect(body['storedCloudId']).toBe('cloud-original');
    expect(body['receivedCloudId']).toBe('cloud-DIFFERENT');
  });

  it('returns 409 with cloudid_mismatch when connectionId re-auth has different cloudId (Manual)', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        mode: 'manual',
        connectionId: 'existing-conn',
        cloudId: 'cloud-DIFFERENT',
        siteName: 'Original Site',
        clientId: 'CLI-ID-WXYZ',
        clientSecret: 'new-secret',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(409);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('cloudid_mismatch');
  });

  it('allows reauth when connectionId and cloudId match', () => {
    const mock = makeRes();
    handleCreateConnection(
      makeReq({
        connectionId: 'existing-conn',
        cloudId: 'cloud-original',
        siteName: 'Original Site',
        accessToken: 'new-at',
        refreshToken: 'new-rt',
        expiresAt: 9999999999,
        scopes: ['read:jira-work'],
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
  });
});
