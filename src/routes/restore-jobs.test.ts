import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { handleCreateRestoreJob } from './restore-jobs.js';

const TEST_CONN_ID = 'rj-test-conn-001';
const TEST_CLOUD_ID = 'cloud-rj-test-001';
const TEST_BACKUP_POINT_ID = 'bp-rj-test-001';

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
    CREATE TABLE restore_jobs (
      jobId                TEXT    PRIMARY KEY,
      connectionId         TEXT    NOT NULL REFERENCES connections(connectionId),
      backupPointId        TEXT    NOT NULL,
      conflictMode         TEXT    NOT NULL DEFAULT 'skip'
                                   CHECK (conflictMode IN ('override', 'skip', 'ask')),
      destination          TEXT    NOT NULL
                                   CHECK (destination IN ('original', 'alternate', 'export')),
      selection            TEXT    NOT NULL DEFAULT '[]',
      alternateDestination TEXT,
      status               TEXT    NOT NULL DEFAULT 'queued',
      restoredCount        INTEGER NOT NULL DEFAULT 0,
      errorCount           INTEGER NOT NULL DEFAULT 0,
      phaseDiagnostic      TEXT,
      createdAt            TEXT    NOT NULL,
      completedAt          TEXT
    );
    CREATE TABLE credentials (
      connectionId TEXT PRIMARY KEY,
      accessToken  TEXT,
      refreshToken TEXT,
      expiresAt    INTEGER,
      scopes       TEXT,
      updatedAt    TEXT,
      clientId     TEXT,
      clientSecret TEXT
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
    status(c: number) { code = c; return res; },
    json(b: unknown) { body = b; return res; },
  } as unknown as Response;
  return { res, statusCode: () => code, jsonBody: () => body };
}

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

function seedConnection(db: Database.Database, overrides: { cloudId?: string } = {}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(TEST_CONN_ID, overrides.cloudId ?? TEST_CLOUD_ID, 'Test Site', now, now);
  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'test-access-token', 'test-refresh-token', 9999999999,
             'write:board-scope:jira-software write:board-scope.admin:jira-software', ?)`
  ).run(TEST_CONN_ID, now);
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: TEST_CONN_ID,
    backupPointId: TEST_BACKUP_POINT_ID,
    conflictMode: 'skip',
    destination: 'original',
    selection: ['PROJ-1', 'PROJ-2'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('POST /api/restore-jobs — happy path', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 201 with jobId and status queued on valid input', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(validBody()), mock.res);

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['jobId']).toBeTypeOf('string');
    expect(body['status']).toBe('queued');
  });

  it('persists restore_jobs row with all input fields', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({ conflictMode: 'override', destination: 'export', selection: ['PROJ-42'] })),
      mock.res
    );

    const { jobId } = mock.jsonBody() as { jobId: string };
    const row = db.prepare('SELECT * FROM restore_jobs WHERE jobId = ?').get(jobId) as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!['connectionId']).toBe(TEST_CONN_ID);
    expect(row!['backupPointId']).toBe(TEST_BACKUP_POINT_ID);
    expect(row!['conflictMode']).toBe('override');
    expect(row!['destination']).toBe('export');
    expect(JSON.parse(row!['selection'] as string)).toEqual(['PROJ-42']);
    expect(row!['status']).toBe('queued');
    expect(row!['restoredCount']).toBe(0);
    expect(row!['errorCount']).toBe(0);
  });

  it('defaults conflictMode to skip when omitted', async () => {
    const body = validBody();
    delete body['conflictMode'];
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(body), mock.res);

    expect(mock.statusCode()).toBe(201);
    const { jobId } = mock.jsonBody() as { jobId: string };
    const row = db.prepare('SELECT conflictMode FROM restore_jobs WHERE jobId = ?').get(jobId) as { conflictMode: string };
    expect(row.conflictMode).toBe('skip');
  });

  it('accepts all three conflict modes', async () => {
    for (const mode of ['override', 'skip', 'ask'] as const) {
      const mock = makeRes();
      await handleCreateRestoreJob(makeReq(validBody({ conflictMode: mode })), mock.res);
      expect(mock.statusCode()).toBe(201);
    }
  });

  it('accepts all three destination types', async () => {
    for (const dest of ['original', 'alternate', 'export'] as const) {
      const mock = makeRes();
      await handleCreateRestoreJob(makeReq(validBody({ destination: dest })), mock.res);
      expect(mock.statusCode()).toBe(201);
    }
  });

  it('accepts alternate destination with same cloudId (same-site alternate)', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({
        destination: 'alternate',
        alternateDestination: { cloudId: TEST_CLOUD_ID, projectKey: 'PROJ2' },
      })),
      mock.res
    );
    expect(mock.statusCode()).toBe(201);
  });

  it('generates a unique jobId per request', async () => {
    const mock1 = makeRes();
    const mock2 = makeRes();
    await handleCreateRestoreJob(makeReq(validBody()), mock1.res);
    await handleCreateRestoreJob(makeReq(validBody()), mock2.res);

    const id1 = (mock1.jsonBody() as { jobId: string }).jobId;
    const id2 = (mock2.jsonBody() as { jobId: string }).jobId;
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Missing field validation
// ---------------------------------------------------------------------------

describe('POST /api/restore-jobs — missing required fields', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 400 when connectionId is missing', async () => {
    const body = validBody();
    delete body['connectionId'];
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(body), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 400 when backupPointId is missing', async () => {
    const body = validBody();
    delete body['backupPointId'];
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(body), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 400 when selection is missing', async () => {
    const body = validBody();
    delete body['selection'];
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(body), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 400 when selection is not an array', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(validBody({ selection: 'PROJ-1' })), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 400 when destination is missing', async () => {
    const body = validBody();
    delete body['destination'];
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(body), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });
});

// ---------------------------------------------------------------------------
// Invalid enum values
// ---------------------------------------------------------------------------

describe('POST /api/restore-jobs — invalid enum values', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 400 for invalid conflictMode', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(validBody({ conflictMode: 'merge' })), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_conflict_mode');
  });

  it('returns 400 for invalid destination', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(validBody({ destination: 'cloud-upload' })), mock.res);
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_destination');
  });
});

// ---------------------------------------------------------------------------
// Connection not found
// ---------------------------------------------------------------------------

describe('POST /api/restore-jobs — connection not found', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 404 when connectionId does not exist', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(makeReq(validBody({ connectionId: 'non-existent' })), mock.res);
    expect(mock.statusCode()).toBe(404);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('connection_not_found');
  });
});

// ---------------------------------------------------------------------------
// Cross-site / cross-tenant rejection
// ---------------------------------------------------------------------------

describe('POST /api/restore-jobs — cross-site rejection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 400 with cross_site_restore_not_supported when targetCloudId differs from connection cloudId', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({ targetCloudId: 'different-cloud-id' })),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('cross_site_restore_not_supported');
  });

  it('returns 400 with cross_site_restore_not_supported when alternateDestination.cloudId differs', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({
        destination: 'alternate',
        alternateDestination: { cloudId: 'foreign-cloud-abc', projectKey: 'PROJ' },
      })),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('cross_site_restore_not_supported');
  });

  it('does not persist row when cross-site targetCloudId is rejected', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({ targetCloudId: 'foreign-cloud-xyz' })),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    const count = (db.prepare('SELECT COUNT(*) as n FROM restore_jobs').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('allows targetCloudId when it matches the connection cloudId', async () => {
    const mock = makeRes();
    await handleCreateRestoreJob(
      makeReq(validBody({ targetCloudId: TEST_CLOUD_ID })),
      mock.res
    );
    expect(mock.statusCode()).toBe(201);
  });
});
