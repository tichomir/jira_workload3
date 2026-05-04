import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraHttpClient } from '../http/JiraHttpClient.js';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { runPermissionProbes, getProbeResults } from './permissionProbes.js';

const TEST_CONN_ID = 'probe-conn-001';
const TEST_CLOUD_ID = 'cloud-probe-123';
const ACCESS_TOKEN = 'test-access-token';

const EXPECTED_PATHS = [
  '/rest/api/3/myself',
  '/rest/api/3/field',
  '/rest/agile/1.0/board',
  '/rest/api/3/workflow/search',
];

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

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, 'Probe Test Site', now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CONN_ID,
    ACCESS_TOKEN,
    'refresh-token',
    Math.floor(Date.now() / 1000) + 3600,
    'read:jira-work',
    'client-id',
    'client-secret',
    now
  );

  return db;
}

describe('runPermissionProbes — happy path (all 200)', () => {
  let db: Database.Database;
  let logs: string[];

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    JiraHttpClient._clearInstances();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
    JiraHttpClient._clearInstances();
  });

  it('fires all four probes in parallel and returns 200 for each', async () => {
    const mockFetch = vi.fn(async (_url: string) =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const results = await runPermissionProbes(TEST_CONN_ID);

    expect(results).toHaveLength(4);
    expect(results.map((r) => r.endpoint).sort()).toEqual([...EXPECTED_PATHS].sort());
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.every((r) => r.remediationNeeded === false)).toBe(true);
  });

  it('emits [permission-probe] log lines with endpoint, status, and duration_ms for each probe', async () => {
    const mockFetch = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await runPermissionProbes(TEST_CONN_ID);

    const probeLogs = logs.filter((l) => l.includes('[permission-probe]'));
    expect(probeLogs).toHaveLength(4);

    for (const path of EXPECTED_PATHS) {
      const match = probeLogs.find((l) => l.includes(`endpoint=${path}`));
      expect(match, `expected log line for endpoint=${path}`).toBeDefined();
      expect(match).toMatch(/status=\d+/);
      expect(match).toMatch(/duration_ms=\d+/);
    }
  });

  it('persists results to probe_results table with remediationNeeded=0 on all-200', async () => {
    const mockFetch = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await runPermissionProbes(TEST_CONN_ID);

    const stored = getProbeResults(TEST_CONN_ID);
    expect(stored).toHaveLength(4);
    expect(stored.every((r) => r.remediationNeeded === false)).toBe(true);
  });

  it('constructs request URLs using the connection cloudId', async () => {
    const calledUrls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      calledUrls.push(url);
      return new Response('{}', { status: 200 });
    });
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await runPermissionProbes(TEST_CONN_ID);

    const expectedBase = `https://api.atlassian.com/ex/jira/${TEST_CLOUD_ID}`;
    for (const path of EXPECTED_PATHS) {
      expect(calledUrls.some((u) => u === `${expectedBase}${path}`)).toBe(true);
    }
  });
});

describe('runPermissionProbes — error path (one 403)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    JiraHttpClient._clearInstances();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
    JiraHttpClient._clearInstances();
  });

  it('sets remediationNeeded=true only for the 403 probe', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/rest/agile/1.0/board')) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response('{}', { status: 200 });
    });
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const results = await runPermissionProbes(TEST_CONN_ID);

    const boardResult = results.find((r) => r.endpoint === '/rest/agile/1.0/board');
    expect(boardResult?.status).toBe(403);
    expect(boardResult?.remediationNeeded).toBe(true);

    const others = results.filter((r) => r.endpoint !== '/rest/agile/1.0/board');
    expect(others.every((r) => r.remediationNeeded === false)).toBe(true);
  });

  it('persists remediation record in probe_results for the 403 endpoint', async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('/rest/api/3/workflow/search')) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response('{}', { status: 200 });
    });
    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await runPermissionProbes(TEST_CONN_ID);

    const stored = getProbeResults(TEST_CONN_ID);
    const workflowResult = stored.find((r) => r.endpoint === '/rest/api/3/workflow/search');
    expect(workflowResult?.remediationNeeded).toBe(true);

    const others = stored.filter((r) => r.endpoint !== '/rest/api/3/workflow/search');
    expect(others.every((r) => r.remediationNeeded === false)).toBe(true);
  });

  it('overwrites stale probe_results on re-run', async () => {
    const allOkFetch = vi.fn(async () => new Response('{}', { status: 200 }));
    JiraHttpClient._createForTesting(TEST_CONN_ID, allOkFetch);
    await runPermissionProbes(TEST_CONN_ID);

    JiraHttpClient._clearInstances();
    const oneForbiddenFetch = vi.fn(async (url: string) => {
      if (url.includes('/rest/api/3/myself')) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response('{}', { status: 200 });
    });
    JiraHttpClient._createForTesting(TEST_CONN_ID, oneForbiddenFetch);
    await runPermissionProbes(TEST_CONN_ID);

    const stored = getProbeResults(TEST_CONN_ID);
    expect(stored).toHaveLength(4);
    const myselfResult = stored.find((r) => r.endpoint === '/rest/api/3/myself');
    expect(myselfResult?.remediationNeeded).toBe(true);
  });
});

describe('getProbeResults — before any probes run', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns empty array when no probes have been run', () => {
    const results = getProbeResults(TEST_CONN_ID);
    expect(results).toEqual([]);
  });
});
