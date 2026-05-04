import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraHttpClient } from './JiraHttpClient.js';
import { _setDbForTesting, _resetDb } from '../db/database.js';

const TEST_CONN_ID = 'conn-test-001';
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
  ).run(TEST_CONN_ID, 'cloud-abc-123', 'Test Site', now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
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

describe('JiraHttpClient — single-flight refresh mutex', () => {
  let db: Database.Database;
  let logs: string[];
  let tokenExchangeCount: number;

  function makeMockFetch() {
    return vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === 'https://auth.atlassian.com/oauth/token') {
        tokenExchangeCount++;
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
        return new Response('{}', { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    });
  }

  beforeEach(() => {
    tokenExchangeCount = 0;
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
    const mockFetch = makeMockFetch();
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.request('https://api.atlassian.com/rest/api/3/myself')
      )
    );

    // Exactly 1 token exchange
    expect(tokenExchangeCount).toBe(1);

    // All 10 retries succeeded
    const statuses = results.map(r => r.status);
    expect(statuses.every(s => s === 200)).toBe(true);
    expect(statuses).toHaveLength(10);
  });

  it('DB row shows new refreshToken after rotation', async () => {
    const mockFetch = makeMockFetch();
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        client.request('https://api.atlassian.com/rest/api/3/myself')
      )
    );

    const row = db
      .prepare('SELECT refreshToken FROM credentials WHERE connectionId = ?')
      .get(TEST_CONN_ID) as { refreshToken: string };

    expect(row.refreshToken).toBe(NEW_REFRESH_TOKEN);
  });

  it('emits [auth-refresh] mutex-acquire, token-rotated, and mutex-release log lines', async () => {
    const mockFetch = makeMockFetch();
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    await Promise.all(
      Array.from({ length: 10 }, () =>
        client.request('https://api.atlassian.com/rest/api/3/myself')
      )
    );

    expect(logs.some(l => l.includes('[auth-refresh]') && l.includes('mutex-acquire'))).toBe(true);
    expect(logs.some(l => l.includes('[auth-refresh]') && l.includes('token-rotated'))).toBe(true);
    expect(logs.some(l => l.includes('[auth-refresh]') && l.includes('mutex-release'))).toBe(true);

    // Every log line must include the connectionId
    const authLogs = logs.filter(l => l.includes('[auth-refresh]'));
    expect(authLogs.every(l => l.includes(TEST_CONN_ID))).toBe(true);
  });

  it('non-401 responses pass through without triggering refresh', async () => {
    const successFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('{}', { status: 200 })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, successFetch);

    const result = await client.request('https://api.atlassian.com/rest/api/3/myself');

    expect(result.status).toBe(200);
    expect(tokenExchangeCount).toBe(0);
  });

  it('throws when clientId or clientSecret is missing from credentials', async () => {
    db.prepare('UPDATE credentials SET clientId = NULL WHERE connectionId = ?').run(TEST_CONN_ID);

    const badFetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response('Unauthorized', { status: 401 })
    );
    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, badFetch);

    await expect(
      client.request('https://api.atlassian.com/rest/api/3/myself')
    ).rejects.toThrow('clientId/clientSecret not set');
  });
});

describe('JiraHttpClient — forConnection singleton', () => {
  beforeEach(() => {
    JiraHttpClient._clearInstances();
  });

  afterEach(() => {
    JiraHttpClient._clearInstances();
  });

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
