import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraHttpClient } from './JiraHttpClient.js';
import { _setDbForTesting, _resetDb } from '../../db/database.js';

const TEST_CONN_ID = 'wl-conn-test-001';
const CLOUD_BASE = 'https://api.atlassian.com/ex/jira/cloud-test-123';
const OLD_ACCESS_TOKEN = 'old-access-token';
const INITIAL_REFRESH_TOKEN = 'initial-refresh-token';
const NEW_ACCESS_TOKEN = 'refreshed-access-token';
const NEW_REFRESH_TOKEN = 'new-refresh-token';
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

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
  ).run(TEST_CONN_ID, 'cloud-test-123', 'Test Site', now, now);

  db.prepare(
    `INSERT INTO credentials
       (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CONN_ID,
    OLD_ACCESS_TOKEN,
    INITIAL_REFRESH_TOKEN,
    Math.floor(Date.now() / 1000) + 3600,
    'read:jira-work',
    CLIENT_ID,
    CLIENT_SECRET,
    now
  );

  return db;
}

function makeMockFetch(tokenExchangeRef: { count: number }) {
  return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === 'https://auth.atlassian.com/oauth/token') {
      tokenExchangeRef.count++;
      return new Response(
        JSON.stringify({
          access_token: NEW_ACCESS_TOKEN,
          refresh_token: NEW_REFRESH_TOKEN,
          expires_in: 3600,
          scope: 'read:jira-work',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers['Authorization'] ?? '';

    if (auth === `Bearer ${OLD_ACCESS_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (auth === `Bearer ${NEW_ACCESS_TOKEN}`) {
      return new Response(JSON.stringify({ accountId: 'user-abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  });
}

describe('JiraHttpClient (workload) — single-flight refresh mutex', () => {
  let db: Database.Database;
  let logs: string[];
  let tokenExchangeRef: { count: number };

  beforeEach(() => {
    tokenExchangeRef = { count: 0 };
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

  it('10 parallel 401s produce exactly 1 token-exchange POST and 10 successful retries', async () => {
    const mockFetch = makeMockFetch(tokenExchangeRef);
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.getJson<{ accountId: string }>(CLOUD_BASE, '/rest/api/3/myself')
      )
    );

    expect(tokenExchangeRef.count).toBe(1);
    expect(results).toHaveLength(10);
    results.forEach(r => expect(r).toEqual({ accountId: 'user-abc' }));
  });

  it('DB row shows new refreshToken after rotation', async () => {
    const mockFetch = makeMockFetch(tokenExchangeRef);
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself')
      )
    );

    const row = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get(TEST_CONN_ID) as { accessToken: string; refreshToken: string };

    expect(row.accessToken).toBe(NEW_ACCESS_TOKEN);
    expect(row.refreshToken).toBe(NEW_REFRESH_TOKEN);
  });

  it('emits [auth-refresh] mutex=acquire, outcome=success, and mutex=release log lines', async () => {
    const mockFetch = makeMockFetch(tokenExchangeRef);
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself')
      )
    );

    const authLogs = logs.filter(l => l.includes('[auth-refresh]'));
    expect(authLogs.some(l => l.includes('mutex=acquire'))).toBe(true);
    expect(authLogs.some(l => l.includes('outcome=success'))).toBe(true);
    expect(authLogs.some(l => l.includes('mutex=release'))).toBe(true);

    // Every [auth-refresh] line must carry the connectionId.
    expect(authLogs.every(l => l.includes(TEST_CONN_ID))).toBe(true);
  });

  it('non-401 responses pass through without triggering a refresh', async () => {
    const successFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, successFetch);

    const result = await client.getJson<{ ok: boolean }>(CLOUD_BASE, '/rest/api/3/myself');

    expect(result).toEqual({ ok: true });
    expect(tokenExchangeRef.count).toBe(0);
  });

  it('refresh failure propagates a typed error to all concurrent callers', async () => {
    const failFetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return new Response('Bad credentials', { status: 400 });
      }
      return new Response('Unauthorized', { status: 401 });
    });
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, failFetch);

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself')
      )
    );

    // Every caller must see a rejection (not a hang or silent swallow).
    expect(settled.every(r => r.status === 'rejected')).toBe(true);

    // Errors must mention the token endpoint failure.
    settled.forEach(r => {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(Error);
      expect((r as PromiseRejectedResult).reason.message).toMatch(/HTTP 400/);
    });

    // outcome=failure must have been logged.
    const authLogs = logs.filter(l => l.includes('[auth-refresh]'));
    expect(authLogs.some(l => l.includes('outcome=failure'))).toBe(true);
    expect(authLogs.some(l => l.includes('mutex=release'))).toBe(true);
  });

  it('throws when clientId or clientSecret is missing from credentials', async () => {
    db.prepare('UPDATE credentials SET clientId = NULL WHERE connectionId = ?').run(TEST_CONN_ID);

    const badFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('Unauthorized', { status: 401 })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, badFetch);

    await expect(
      client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself')
    ).rejects.toThrow('clientId/clientSecret not set');
  });
});

describe('JiraHttpClient (workload) — forConnection singleton', () => {
  beforeEach(() => JiraHttpClient._clearInstances());
  afterEach(() => JiraHttpClient._clearInstances());

  it('returns the same instance for the same connectionId', () => {
    const a = JiraHttpClient.forConnection('conn-abc');
    const b = JiraHttpClient.forConnection('conn-abc');
    expect(a).toBe(b);
  });

  it('returns different instances for different connectionIds', () => {
    const a = JiraHttpClient.forConnection('conn-aaa');
    const b = JiraHttpClient.forConnection('conn-bbb');
    expect(a).not.toBe(b);
  });
});

describe('JiraHttpClient (workload) — IJiraHttpClient surface', () => {
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

  it('searchJql posts to /rest/api/3/search/jql and returns parsed response', async () => {
    const mockResponse = {
      startAt: 0,
      maxResults: 50,
      total: 1,
      issues: [{ id: '10000', key: 'PROJ-1', fields: { summary: 'Test' } }],
    };
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const result = await client.searchJql(CLOUD_BASE, {
      jql: 'project = PROJ',
      startAt: 0,
      maxResults: 50,
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].key).toBe('PROJ-1');

    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(`${CLOUD_BASE}/rest/api/3/search/jql`);
    expect((calledInit as RequestInit).method).toBe('POST');
  });

  it('downloadAttachment returns binary data with SHA-256 contentHash', async () => {
    const fileBytes = Buffer.from('hello attachment');
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(fileBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const result = await client.downloadAttachment(CLOUD_BASE, 'att-001');

    expect(result.data).toEqual(fileBytes);
    expect(result.contentType).toBe('image/png');
    // Verify SHA-256 is correct.
    const { createHash } = await import('crypto');
    const expectedHash = createHash('sha256').update(fileBytes).digest('hex');
    expect(result.contentHash).toBe(expectedHash);

    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(`${CLOUD_BASE}/rest/api/3/attachment/content/att-001`);
  });
});
