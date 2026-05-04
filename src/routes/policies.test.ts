import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { JiraHttpClient } from '../workload/http/JiraHttpClient.js';
import { handleCreatePolicy } from './policies.js';

const TEST_CONN_ID = 'policy-test-conn-001';
const TEST_CLOUD_ID = 'cloud-policy-test-001';

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
      updatedAt    TEXT NOT NULL
    );
    CREATE TABLE policies (
      policyId             TEXT    PRIMARY KEY,
      connectionId         TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      projectScope         TEXT    NOT NULL CHECK (projectScope IN ('all', 'selected')),
      selectedProjectKeys  TEXT    NOT NULL DEFAULT '[]',
      retentionDays        INTEGER NOT NULL,
      rpoHours             INTEGER NOT NULL DEFAULT 24,
      jqlFilter            TEXT,
      updatedAt            TEXT    NOT NULL
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

function seedConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, 'Test Site', now, now);
}

function seedCredentials(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(TEST_CONN_ID, 'mock-access-token', 'mock-refresh-token', 9999999999, 'read:jira-work', now);
}

// ---------------------------------------------------------------------------
// Happy path — no jqlFilter
// ---------------------------------------------------------------------------

describe('POST /api/policies — happy path (no jqlFilter)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    JiraHttpClient._clearInstances();
    _resetDb();
  });

  it('returns 201 with policyId on valid payload', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 24, retentionDays: 30, projectScope: 'all' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['policyId']).toBeTypeOf('string');
    expect(body['connectionId']).toBe(TEST_CONN_ID);
    expect(body['rpoHours']).toBe(24);
    expect(body['retentionDays']).toBe(30);
    expect(body['projectScope']).toBe('all');
    expect(body['selectedProjectKeys']).toEqual([]);
    expect(body['updatedAt']).toBeTypeOf('string');
  });

  it('persists policy to database with rpoHours', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 12, retentionDays: 7, projectScope: 'all' }),
      mock.res
    );

    const { policyId } = mock.jsonBody() as { policyId: string };
    const row = db.prepare('SELECT * FROM policies WHERE policyId = ?').get(policyId) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!['rpoHours']).toBe(12);
    expect(row!['retentionDays']).toBe(7);
    expect(row!['connectionId']).toBe(TEST_CONN_ID);
    expect(row!['jqlFilter']).toBeNull();
  });

  it('returns 201 with selectedProjectKeys when projectScope is selected', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'selected',
        selectedProjectKeys: ['PROJ', 'INFRA'],
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['selectedProjectKeys']).toEqual(['PROJ', 'INFRA']);
  });

  it('returns 400 when rpoHours is missing', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, retentionDays: 30, projectScope: 'all' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 400 when rpoHours is 0', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 0, retentionDays: 30, projectScope: 'all' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 400 when rpoHours is negative', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: -1, retentionDays: 30, projectScope: 'all' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 400 when retentionDays is 0', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 24, retentionDays: 0, projectScope: 'all' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 400 when projectScope is invalid', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 24, retentionDays: 30, projectScope: 'invalid' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_project_scope');
  });

  it('returns 400 when projectScope is selected but selectedProjectKeys is missing', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 24, retentionDays: 30, projectScope: 'selected' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 400 when projectScope is selected but selectedProjectKeys is empty', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: TEST_CONN_ID, rpoHours: 24, retentionDays: 30, projectScope: 'selected', selectedProjectKeys: [] }),
      mock.res
    );
    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('validation_error');
  });

  it('returns 404 when connectionId does not exist', async () => {
    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({ connectionId: 'non-existent', rpoHours: 24, retentionDays: 30, projectScope: 'all' }),
      mock.res
    );
    expect(mock.statusCode()).toBe(404);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('connection_not_found');
  });
});

// ---------------------------------------------------------------------------
// jqlFilter validation — error path
// ---------------------------------------------------------------------------

describe('POST /api/policies — jqlFilter validation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
    seedCredentials(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    JiraHttpClient._clearInstances();
    _resetDb();
  });

  it('returns 201 when jqlFilter parses without errors', async () => {
    JiraHttpClient._createForTesting(TEST_CONN_ID, async (url) => {
      if (url.includes('/rest/api/3/jql/parse')) {
        return new Response(
          JSON.stringify({ queries: [{ query: 'status = Open', errors: [], warnings: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });

    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'all',
        jqlFilter: 'status = Open',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(201);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['jqlFilter']).toBe('status = Open');
  });

  it('returns 400 with parser error details when jqlFilter is invalid', async () => {
    const jiraErrors = ["Unexpected token '@@' at position 8."];
    JiraHttpClient._createForTesting(TEST_CONN_ID, async (url) => {
      if (url.includes('/rest/api/3/jql/parse')) {
        return new Response(
          JSON.stringify({ queries: [{ query: 'INVALID @@', errors: jiraErrors, warnings: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });

    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'all',
        jqlFilter: 'INVALID @@',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_jql');
    const details = body['details'] as Record<string, unknown>;
    expect(details).toBeDefined();
    const queries = details['queries'] as Array<{ errors: string[] }>;
    expect(queries[0].errors).toEqual(jiraErrors);
  });

  it('does not persist policy when jqlFilter is invalid', async () => {
    JiraHttpClient._createForTesting(TEST_CONN_ID, async (url) => {
      if (url.includes('/rest/api/3/jql/parse')) {
        return new Response(
          JSON.stringify({ queries: [{ query: 'BAD JQL', errors: ['syntax error'], warnings: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });

    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'all',
        jqlFilter: 'BAD JQL',
      }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const count = (db.prepare('SELECT COUNT(*) as n FROM policies').get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('persists jqlFilter to database when JQL is valid', async () => {
    JiraHttpClient._createForTesting(TEST_CONN_ID, async (url) => {
      if (url.includes('/rest/api/3/jql/parse')) {
        return new Response(
          JSON.stringify({ queries: [{ query: 'project = MYPROJ', errors: [], warnings: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });

    const mock = makeRes();
    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'all',
        jqlFilter: 'project = MYPROJ',
      }),
      mock.res
    );

    const { policyId } = mock.jsonBody() as { policyId: string };
    const row = db.prepare('SELECT jqlFilter FROM policies WHERE policyId = ?').get(policyId) as { jqlFilter: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.jqlFilter).toBe('project = MYPROJ');
  });

  it('calls POST /rest/api/3/jql/parse with { queries: [jqlFilter] }', async () => {
    let capturedBody: unknown;
    JiraHttpClient._createForTesting(TEST_CONN_ID, async (url, init) => {
      if (url.includes('/rest/api/3/jql/parse')) {
        capturedBody = JSON.parse((init?.body as string) ?? '{}');
        return new Response(
          JSON.stringify({ queries: [{ query: 'assignee = currentUser()', errors: [], warnings: [] }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch to: ${url}`);
    });

    await handleCreatePolicy(
      makeReq({
        connectionId: TEST_CONN_ID,
        rpoHours: 24,
        retentionDays: 30,
        projectScope: 'all',
        jqlFilter: 'assignee = currentUser()',
      }),
      makeRes().res
    );

    expect(capturedBody).toEqual({ queries: ['assignee = currentUser()'] });
  });
});
