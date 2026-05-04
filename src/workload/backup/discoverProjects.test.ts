import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraHttpClient } from '../http/JiraHttpClient.js';
import { _setDbForTesting, _resetDb } from '../../db/database.js';
import { discoverProjects, partitionJsmProjects } from './discoverProjects.js';

const TEST_CONN_ID = 'wl-conn-discover-001';
const CLOUD_BASE = 'https://api.atlassian.com/ex/jira/cloud-test-456';
const ACCESS_TOKEN = 'test-access-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(TEST_CONN_ID, 'cloud-test-456', 'Test Site', now, now);

  db.prepare(
    `INSERT INTO credentials
       (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CONN_ID,
    ACCESS_TOKEN,
    'test-refresh-token',
    Math.floor(Date.now() / 1000) + 3600,
    'read:jira-work',
    'test-client-id',
    'test-client-secret',
    now
  );

  return db;
}

type RawProject = {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
};

function makeProject(index: number, typeKey = 'software'): RawProject {
  return {
    id: String(10000 + index),
    key: `PROJ${index}`,
    name: `Project ${index}`,
    projectTypeKey: typeKey,
  };
}

function makeProjectSearchResponse(
  projects: RawProject[],
  startAt: number,
  isLast: boolean
): object {
  return {
    startAt,
    maxResults: 50,
    total: 110,
    isLast,
    values: projects,
  };
}

// ---------------------------------------------------------------------------
// Happy-path: 3-page response (50 + 50 + 10 projects, all non-JSM, scope=all)
// ---------------------------------------------------------------------------

describe('discoverProjects — happy path (3 pages, scope=all)', () => {
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

  it('returns all 110 projects and discoveredCount=110', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeProject(i));
    const page2 = Array.from({ length: 50 }, (_, i) => makeProject(50 + i));
    const page3 = Array.from({ length: 10 }, (_, i) => makeProject(100 + i));

    const mockFetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      const startAt = Number(u.searchParams.get('startAt') ?? '0');

      if (startAt === 0) {
        return new Response(JSON.stringify(makeProjectSearchResponse(page1, 0, false)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (startAt === 50) {
        return new Response(JSON.stringify(makeProjectSearchResponse(page2, 50, false)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // startAt === 100: final page
      return new Response(JSON.stringify(makeProjectSearchResponse(page3, 100, true)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'all');

    expect(result.projects).toHaveLength(110);
    expect(result.jsmDeferredProjects).toHaveLength(0);
    expect(result.discoveredCount).toBe(110);
  });

  it('emits [discover] phase=project log line for each page', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeProject(i));
    const page2 = Array.from({ length: 50 }, (_, i) => makeProject(50 + i));
    const page3 = Array.from({ length: 10 }, (_, i) => makeProject(100 + i));

    const mockFetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      const startAt = Number(u.searchParams.get('startAt') ?? '0');
      if (startAt === 0) return new Response(JSON.stringify(makeProjectSearchResponse(page1, 0, false)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (startAt === 50) return new Response(JSON.stringify(makeProjectSearchResponse(page2, 50, false)), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(makeProjectSearchResponse(page3, 100, true)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    await discoverProjects(client, CLOUD_BASE, 'all');

    const discoverLogs = logs.filter(l => l.includes('[discover]') && l.includes('phase=project'));
    expect(discoverLogs).toHaveLength(3);
    expect(discoverLogs[0]).toMatch(/page=1 count=50/);
    expect(discoverLogs[1]).toMatch(/page=2 count=50/);
    expect(discoverLogs[2]).toMatch(/page=3 count=10/);
  });

  it('terminates pagination on isLast=true and does not make extra requests', async () => {
    const singlePage = Array.from({ length: 10 }, (_, i) => makeProject(i));
    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 10, isLast: true, values: singlePage }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'all');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.projects).toHaveLength(10);
    expect(result.discoveredCount).toBe(10);
  });

  it('defers service_desk projects into jsmDeferredProjects with PHASE_2_DEFERRED reason', async () => {
    const mixed = [
      makeProject(1, 'software'),
      makeProject(2, 'service_desk'),
      makeProject(3, 'business'),
      makeProject(4, 'service_desk'),
    ];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 4, isLast: true, values: mixed }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'all');

    expect(result.projects).toHaveLength(2);
    expect(result.jsmDeferredProjects).toHaveLength(2);
    expect(result.jsmDeferredProjects[0].reason).toBe('PHASE_2_DEFERRED');
    expect(result.jsmDeferredProjects[1].reason).toBe('PHASE_2_DEFERRED');
    expect(result.discoveredCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Scope filtering: scope='selected'
// ---------------------------------------------------------------------------

describe('discoverProjects — scope=selected', () => {
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

  it('returns only the projects whose keys appear in selectedKeys', async () => {
    const allProjects = [
      makeProject(1, 'software'),  // key=PROJ1
      makeProject(2, 'software'),  // key=PROJ2
      makeProject(3, 'business'),  // key=PROJ3
    ];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 3, isLast: true, values: allProjects }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'selected', ['PROJ1', 'PROJ3']);

    expect(result.projects).toHaveLength(2);
    expect(result.projects.map(p => p.projectKey)).toEqual(['PROJ1', 'PROJ3']);
    expect(result.jsmDeferredProjects).toHaveLength(0);
  });

  it('always defers service_desk projects even when key is in selectedKeys', async () => {
    const allProjects = [
      makeProject(1, 'service_desk'),  // key=PROJ1
      makeProject(2, 'software'),       // key=PROJ2
    ];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 2, isLast: true, values: allProjects }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'selected', ['PROJ1', 'PROJ2']);

    expect(result.jsmDeferredProjects).toHaveLength(1);
    expect(result.jsmDeferredProjects[0].projectKey).toBe('PROJ1');
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].projectKey).toBe('PROJ2');
  });

  it('returns empty projects[] when no project key matches selectedKeys', async () => {
    const allProjects = [makeProject(1, 'software'), makeProject(2, 'software')];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 2, isLast: true, values: allProjects }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await discoverProjects(client, CLOUD_BASE, 'selected', ['UNRELATED']);

    expect(result.projects).toHaveLength(0);
    expect(result.discoveredCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Error path: HTTP 500 mid-pagination
// ---------------------------------------------------------------------------

describe('discoverProjects — error path (HTTP 500 mid-pagination)', () => {
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

  it('throws an error when the API returns HTTP 500 mid-pagination', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => makeProject(i));

    const mockFetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      const startAt = Number(u.searchParams.get('startAt') ?? '0');

      if (startAt === 0) {
        return new Response(
          JSON.stringify(makeProjectSearchResponse(page1, 0, false)),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Second page: simulate server error
      return new Response('Internal Server Error', { status: 500 });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await expect(
      discoverProjects(client, CLOUD_BASE, 'all')
    ).rejects.toThrow(/HTTP 500/);
  });

  it('preserves the HTTP status code in the thrown error message', async () => {
    const mockFetch = vi.fn(async () =>
      new Response('Service Unavailable', { status: 503 })
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await expect(
      discoverProjects(client, CLOUD_BASE, 'all')
    ).rejects.toThrow(/HTTP 503/);
  });
});

// ---------------------------------------------------------------------------
// partitionJsmProjects — unit tests
// ---------------------------------------------------------------------------

describe('partitionJsmProjects — unit tests', () => {
  it('puts service_desk projects into deferred and others into included', () => {
    const projects = [
      { id: '1', key: 'SW1', name: 'Software 1', projectTypeKey: 'software' },
      { id: '2', key: 'JSM1', name: 'JSM 1', projectTypeKey: 'service_desk' },
      { id: '3', key: 'BIZ1', name: 'Business 1', projectTypeKey: 'business' },
      { id: '4', key: 'JSM2', name: 'JSM 2', projectTypeKey: 'service_desk' },
    ];

    const { included, deferred } = partitionJsmProjects(projects);

    expect(included).toHaveLength(2);
    expect(included.map(p => p.key)).toEqual(['SW1', 'BIZ1']);

    expect(deferred).toHaveLength(2);
    expect(deferred[0]).toEqual({ projectId: '2', projectKey: 'JSM1', projectName: 'JSM 1', reason: 'PHASE_2_DEFERRED' });
    expect(deferred[1]).toEqual({ projectId: '4', projectKey: 'JSM2', projectName: 'JSM 2', reason: 'PHASE_2_DEFERRED' });
  });

  it('returns all projects in included when none are service_desk', () => {
    const projects = [
      { id: '1', key: 'SW1', name: 'Software 1', projectTypeKey: 'software' },
      { id: '2', key: 'BIZ1', name: 'Business 1', projectTypeKey: 'business' },
    ];

    const { included, deferred } = partitionJsmProjects(projects);

    expect(included).toHaveLength(2);
    expect(deferred).toHaveLength(0);
  });

  it('returns all projects in deferred when all are service_desk', () => {
    const projects = [
      { id: '1', key: 'JSM1', name: 'JSM 1', projectTypeKey: 'service_desk' },
      { id: '2', key: 'JSM2', name: 'JSM 2', projectTypeKey: 'service_desk' },
    ];

    const { included, deferred } = partitionJsmProjects(projects);

    expect(included).toHaveLength(0);
    expect(deferred).toHaveLength(2);
    expect(deferred.every(d => d.reason === 'PHASE_2_DEFERRED')).toBe(true);
  });

  it('handles an empty array', () => {
    const { included, deferred } = partitionJsmProjects([]);
    expect(included).toHaveLength(0);
    expect(deferred).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// [discover] jsm-deferred log line emission
// ---------------------------------------------------------------------------

describe('discoverProjects — jsm-deferred log lines', () => {
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

  it('emits [discover] jsm-deferred log per service_desk project', async () => {
    const mixed = [
      makeProject(1, 'software'),
      makeProject(2, 'service_desk'),
      makeProject(3, 'business'),
      makeProject(4, 'service_desk'),
    ];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 4, isLast: true, values: mixed }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    await discoverProjects(client, CLOUD_BASE, 'all');

    const jsmLogs = logs.filter(l => l.includes('[discover] jsm-deferred'));
    expect(jsmLogs).toHaveLength(2);
    expect(jsmLogs[0]).toMatch(/projectKey=PROJ2 projectId=10002/);
    expect(jsmLogs[1]).toMatch(/projectKey=PROJ4 projectId=10004/);
  });

  it('does not emit jsm-deferred log lines for non-service_desk projects', async () => {
    const projects = [makeProject(1, 'software'), makeProject(2, 'business')];

    const mockFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 2, isLast: true, values: projects }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    await discoverProjects(client, CLOUD_BASE, 'all');

    const jsmLogs = logs.filter(l => l.includes('[discover] jsm-deferred'));
    expect(jsmLogs).toHaveLength(0);
  });
});
