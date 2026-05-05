import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraHttpClient, RateLimitedError } from './JiraHttpClient.js';
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

// ---------------------------------------------------------------------------
// enumerateIssues — nextPageToken-based pagination with length termination
// ---------------------------------------------------------------------------

describe('JiraHttpClient (workload) — enumerateIssues', () => {
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

  function makeIssue(key: string) {
    return { id: key, key, fields: { summary: key } };
  }

  it('terminates on partial-page response and returns all issues', async () => {
    // Page 1: 3 issues (full page, maxResults=3) → nextPageToken present
    // Page 2: 2 issues (partial page, 2 < 3) → terminate
    const page1Issues = [makeIssue('PROJ-1'), makeIssue('PROJ-2'), makeIssue('PROJ-3')];
    const page2Issues = [makeIssue('PROJ-4'), makeIssue('PROJ-5')];

    let callCount = 0;
    const mockFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes('/rest/api/3/search/jql')) {
        callCount++;
        const body = JSON.parse((init?.body as string) ?? '{}');
        const issues = body.nextPageToken ? page2Issues : page1Issues;
        return new Response(
          JSON.stringify({
            startAt: 0,
            maxResults: 3,
            total: 5,
            issues,
            ...(callCount === 1 ? { nextPageToken: 'cursor-page-2' } : {}),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await client.enumerateIssues(CLOUD_BASE, 'PROJ', 'project = PROJ', ['summary'], { maxResults: 3 });

    expect(result).toHaveLength(5);
    expect(result.map(i => i.key)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3', 'PROJ-4', 'PROJ-5']);
    expect(callCount).toBe(2);
  });

  it('terminates on empty-page response', async () => {
    const page1Issues = [makeIssue('X-1'), makeIssue('X-2'), makeIssue('X-3')];
    let callCount = 0;
    const mockFetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url.includes('/rest/api/3/search/jql')) {
        callCount++;
        const issues = callCount === 1 ? page1Issues : [];
        return new Response(
          JSON.stringify({ startAt: 0, maxResults: 3, total: 3, issues,
            ...(callCount === 1 ? { nextPageToken: 'tok-2' } : {}) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    const result = await client.enumerateIssues(CLOUD_BASE, 'X', 'project = X', ['summary'], { maxResults: 3 });

    expect(result).toHaveLength(3);
    expect(callCount).toBe(2);
  });

  it('emits [search] endpoint=search/jql log line on every page', async () => {
    const issues3 = [makeIssue('A-1'), makeIssue('A-2'), makeIssue('A-3')];
    const issues1 = [makeIssue('A-4')];
    let callCount = 0;
    const mockFetch = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
      if (url.includes('/rest/api/3/search/jql')) {
        callCount++;
        const issues = callCount === 1 ? issues3 : issues1;
        return new Response(
          JSON.stringify({ startAt: 0, maxResults: 3, total: 4, issues,
            ...(callCount === 1 ? { nextPageToken: 'tok' } : {}) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    await client.enumerateIssues(CLOUD_BASE, 'ALPHA', 'project = ALPHA', ['summary'], { maxResults: 3 });

    const searchLogs = logs.filter(l => l.includes('[search]'));
    expect(searchLogs).toHaveLength(2);
    expect(searchLogs[0]).toContain('endpoint=search/jql');
    expect(searchLogs[0]).toContain('project=ALPHA');
    expect(searchLogs[0]).toContain('page=1');
    expect(searchLogs[0]).toContain('pageSize=3');
    expect(searchLogs[0]).toContain('returnedCount=3');
    expect(searchLogs[1]).toContain('page=2');
    expect(searchLogs[1]).toContain('pageSize=3');
    expect(searchLogs[1]).toContain('returnedCount=1');
  });

  it('POSTs to /rest/api/3/search/jql and not to any other search endpoint', async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 0, issues: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    await client.enumerateIssues(CLOUD_BASE, 'MYPROJ', 'project = MYPROJ', []);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(`${CLOUD_BASE}/rest/api/3/search/jql`);
    expect((calledInit as RequestInit).method).toBe('POST');
  });

  it('never reads the total field — pagination is length-only', async () => {
    // Provide a deliberately wrong total to confirm it is never used for termination.
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response(
        JSON.stringify({ startAt: 0, maxResults: 50, total: 9999, issues: [makeIssue('Z-1')] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);
    // maxResults=50; page returns 1 issue → 1 < 50, so must stop after 1 page
    const result = await client.enumerateIssues(CLOUD_BASE, 'Z', 'project = Z', [], { maxResults: 50 });

    expect(result).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 429 rate-limit exponential backoff
// ---------------------------------------------------------------------------

describe('JiraHttpClient (workload) — 429 rate-limit backoff', () => {
  let db: Database.Database;
  let logs: string[];
  let sleepDelays: number[];

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    JiraHttpClient._clearInstances();
    logs = [];
    sleepDelays = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
    JiraHttpClient._clearInstances();
  });

  function makeSleepFn() {
    return async (ms: number) => { sleepDelays.push(ms); };
  }

  it('retries after 429 and succeeds on second attempt', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch, makeSleepFn());
    const result = await client.getJson<{ ok: boolean }>(CLOUD_BASE, '/rest/api/3/myself');

    expect(result).toEqual({ ok: true });
    expect(sleepDelays).toHaveLength(1);

    const rateLimitLogs = logs.filter(l => l.includes('[rate-limit]'));
    expect(rateLimitLogs).toHaveLength(1);
    expect(rateLimitLogs[0]).toContain('attempt=1');
    expect(rateLimitLogs[0]).toContain('/rest/api/3/myself');
  });

  it('honors Retry-After seconds header and uses it as the delay', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': '30' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch, makeSleepFn());
    await client.getJson<{ ok: boolean }>(CLOUD_BASE, '/rest/api/3/myself');

    expect(sleepDelays).toHaveLength(1);
    expect(sleepDelays[0]).toBe(30000);

    const rateLimitLogs = logs.filter(l => l.includes('[rate-limit]'));
    expect(rateLimitLogs[0]).toContain('delayMs=30000');
  });

  it('throws RateLimitedError after exhausting max retries', async () => {
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> =>
      new Response('Too Many Requests', { status: 429 })
    );

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch, makeSleepFn());

    await expect(
      client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself')
    ).rejects.toThrow(RateLimitedError);

    // 4 retries → 4 sleeps and 4 [rate-limit] log lines
    expect(sleepDelays).toHaveLength(4);

    const rateLimitLogs = logs.filter(l => l.includes('[rate-limit]'));
    expect(rateLimitLogs).toHaveLength(4);
    expect(rateLimitLogs[0]).toContain('attempt=1');
    expect(rateLimitLogs[3]).toContain('attempt=4');
  });

  it('uses exponential backoff delays when no Retry-After is present', async () => {
    let callCount = 0;
    const mockFetch = vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
      callCount++;
      if (callCount <= 3) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response(JSON.stringify({ done: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch, makeSleepFn());
    await client.getJson<unknown>(CLOUD_BASE, '/rest/api/3/myself');

    expect(sleepDelays).toHaveLength(3);
    // Delays grow: attempt=1 ~1000ms, attempt=2 ~2000ms, attempt=3 ~4000ms (with ±20% jitter)
    expect(sleepDelays[0]).toBeGreaterThanOrEqual(800);
    expect(sleepDelays[0]).toBeLessThanOrEqual(1200);
    expect(sleepDelays[1]).toBeGreaterThanOrEqual(1600);
    expect(sleepDelays[1]).toBeLessThanOrEqual(2400);
    expect(sleepDelays[2]).toBeGreaterThanOrEqual(3200);
    expect(sleepDelays[2]).toBeLessThanOrEqual(4800);
  });
});

// ---------------------------------------------------------------------------
// Deprecated-endpoint grep guard
// ---------------------------------------------------------------------------

describe('deprecated endpoint guard', () => {
  it('src/ contains no references to /rest/api/3/search without /jql suffix', () => {
    const { spawnSync } = require('child_process') as typeof import('child_process');
    const cwd = new URL('../../../', import.meta.url).pathname;

    // First grep: find any line matching /rest/api/3/search in TypeScript sources
    const first = spawnSync(
      'grep',
      ['-rn', '--include=*.ts', '--include=*.tsx', '/rest/api/3/search', 'src/'],
      { encoding: 'utf-8', cwd }
    );
    // Exit 1 means no matches at all — definitely clean
    if (first.status === 1) return;

    // Filter: keep only lines that are actual code references to the forbidden endpoint
    const violations = (first.stdout as string)
      .split('\n')
      .filter(line => {
        if (!line.includes('/rest/api/3/search')) return false;
        // Permitted endpoint: /rest/api/3/search/jql
        if (line.includes('/rest/api/3/search/jql')) return false;
        // Skip this test file (it necessarily references the pattern)
        if (line.includes('JiraHttpClient.test.ts')) return false;
        // Skip type-definition files — they document constraints but never call HTTP
        if (line.match(/types\.ts:/)) return false;
        // Skip JSDoc and single-line comment lines
        // grep output format: filepath:linenum:content
        const contentStart = line.indexOf(':', line.indexOf(':') + 1) + 1;
        const code = line.slice(contentStart).trimStart();
        if (code.startsWith('*') || code.startsWith('//')) return false;
        return true;
      })
      .join('\n')
      .trim();

    if (violations) {
      throw new Error(
        `Deprecated /rest/api/3/search endpoint found in src/:\n${violations}`
      );
    }
  });
});
