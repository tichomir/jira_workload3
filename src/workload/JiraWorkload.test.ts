import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JiraWorkload, WorkloadAuthError } from './JiraWorkload.js';
import { JiraHttpClient } from './http/JiraHttpClient.js';
import { _setDbForTesting, _resetDb } from '../db/database.js';

// ---------------------------------------------------------------------------
// Test DB factory
// ---------------------------------------------------------------------------

const TEST_CONN_ID = 'wl-discover-jw-001';
const CLOUD_ID = 'cloud-jira-999';
const ACCESS_TOKEN = 'tok-access-abc';

function createTestDb(withCredentials = true): Database.Database {
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
    CREATE TABLE backup_manifests (
      id           TEXT PRIMARY KEY,
      connectionId TEXT NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      cloudId      TEXT NOT NULL,
      createdAt    TEXT NOT NULL,
      manifestJson TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(TEST_CONN_ID, CLOUD_ID, 'Test Jira Site', now, now);

  if (withCredentials) {
    db.prepare(
      `INSERT INTO credentials
         (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      TEST_CONN_ID,
      ACCESS_TOKEN,
      'tok-refresh-xyz',
      Math.floor(Date.now() / 1000) + 3600,
      'read:jira-work',
      'cid-test',
      'csec-test',
      now
    );
  }

  return db;
}

// ---------------------------------------------------------------------------
// Minimal mock project factory
// ---------------------------------------------------------------------------

function makeProject(index: number, typeKey = 'software') {
  return { id: String(20000 + index), key: `JP${index}`, name: `Jira Project ${index}`, projectTypeKey: typeKey };
}

function mockPage(projects: ReturnType<typeof makeProject>[], isLast = true) {
  return JSON.stringify({ startAt: 0, maxResults: 50, total: projects.length, isLast, values: projects });
}

// ---------------------------------------------------------------------------
// Happy-path: discover() with 3 software projects and 1 JSM project
// ---------------------------------------------------------------------------

describe('JiraWorkload.discover() — happy path', () => {
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

  it('returns backupPointId, projectCount=3, jsmDeferredCount=1', async () => {
    const projects = [
      makeProject(1, 'software'),
      makeProject(2, 'business'),
      makeProject(3, 'software'),
      makeProject(4, 'service_desk'),
    ];

    const mockFetch = vi.fn(async () =>
      new Response(mockPage(projects), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const workload = new JiraWorkload();
    const result = await workload.discover(TEST_CONN_ID, { projectScope: 'all' });

    expect(result.backupPointId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.projectCount).toBe(3);
    expect(result.jsmDeferredCount).toBe(1);
  });

  it('persists a backup_manifests row with full manifestJson', async () => {
    const projects = [makeProject(1, 'software'), makeProject(2, 'software')];

    const mockFetch = vi.fn(async () =>
      new Response(mockPage(projects), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const workload = new JiraWorkload();
    const result = await workload.discover(TEST_CONN_ID, { projectScope: 'all' });

    const row = db
      .prepare('SELECT * FROM backup_manifests WHERE id = ?')
      .get(result.backupPointId) as {
        id: string;
        connectionId: string;
        cloudId: string;
        createdAt: string;
        manifestJson: string;
      } | undefined;

    expect(row).toBeDefined();
    expect(row!.connectionId).toBe(TEST_CONN_ID);
    expect(row!.cloudId).toBe(CLOUD_ID);

    const manifest = JSON.parse(row!.manifestJson);
    expect(manifest.manifestId).toBe(result.backupPointId);
    expect(manifest.projects).toHaveLength(2);
    expect(manifest.jsmDeferredProjects).toHaveLength(0);
    expect(manifest.coverageInvariant).toBeNull();
  });

  it('manifest row id matches returned backupPointId', async () => {
    const projects = [makeProject(1, 'software')];

    const mockFetch = vi.fn(async () =>
      new Response(mockPage(projects), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const workload = new JiraWorkload();
    const result = await workload.discover(TEST_CONN_ID, { projectScope: 'all' });

    const count = (db.prepare('SELECT COUNT(*) as n FROM backup_manifests WHERE id = ?').get(result.backupPointId) as { n: number }).n;
    expect(count).toBe(1);
  });

  it('scope=selected filters projects correctly and persists filtered manifest', async () => {
    const projects = [
      makeProject(1, 'software'),  // JP1
      makeProject(2, 'software'),  // JP2
      makeProject(3, 'business'),  // JP3
    ];

    const mockFetch = vi.fn(async () =>
      new Response(mockPage(projects), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const workload = new JiraWorkload();
    const result = await workload.discover(TEST_CONN_ID, {
      projectScope: 'selected',
      selectedProjectKeys: ['JP1', 'JP3'],
    });

    expect(result.projectCount).toBe(2);
    expect(result.jsmDeferredCount).toBe(0);

    const row = db.prepare('SELECT manifestJson FROM backup_manifests WHERE id = ?').get(result.backupPointId) as { manifestJson: string } | undefined;
    const manifest = JSON.parse(row!.manifestJson);
    expect(manifest.projects.map((p: { projectKey: string }) => p.projectKey)).toEqual(['JP1', 'JP3']);
    expect(manifest.projectScope).toBe('selected');
    expect(manifest.selectedProjectKeys).toEqual(['JP1', 'JP3']);
  });

  it('writes correct cloudBaseUrl (api.atlassian.com path) to the HTTP client', async () => {
    const projects = [makeProject(1, 'software')];
    const fetchedUrls: string[] = [];

    const mockFetch = vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return new Response(mockPage(projects), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    JiraHttpClient._createForTesting(TEST_CONN_ID, mockFetch);

    const workload = new JiraWorkload();
    await workload.discover(TEST_CONN_ID, { projectScope: 'all' });

    expect(fetchedUrls[0]).toContain(`/ex/jira/${CLOUD_ID}`);
    expect(fetchedUrls[0]).toContain('/rest/api/3/project/search');
  });
});

// ---------------------------------------------------------------------------
// Error path: auth failure surfaces WorkloadAuthError
// ---------------------------------------------------------------------------

describe('JiraWorkload.discover() — auth failure error path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
    JiraHttpClient._clearInstances();
  });

  it('throws WorkloadAuthError when connectionId has no DB row', async () => {
    const db = createTestDb(false);
    // Remove the connection so it truly doesn't exist
    db.prepare('DELETE FROM connections WHERE connectionId = ?').run(TEST_CONN_ID);
    _setDbForTesting(db);

    const workload = new JiraWorkload();
    await expect(
      workload.discover('nonexistent-connection-id', { projectScope: 'all' })
    ).rejects.toThrow(WorkloadAuthError);
  });

  it('WorkloadAuthError message contains connectionId', async () => {
    const db = createTestDb(false);
    db.prepare('DELETE FROM connections WHERE connectionId = ?').run(TEST_CONN_ID);
    _setDbForTesting(db);

    const workload = new JiraWorkload();
    await expect(
      workload.discover('bad-conn-123', { projectScope: 'all' })
    ).rejects.toThrow(/bad-conn-123/);
  });

  it('throws WorkloadAuthError when credentials row is missing', async () => {
    // Connection exists but no credentials row
    const db = createTestDb(false);
    _setDbForTesting(db);
    JiraHttpClient._clearInstances();

    const workload = new JiraWorkload();
    await expect(
      workload.discover(TEST_CONN_ID, { projectScope: 'all' })
    ).rejects.toThrow(WorkloadAuthError);
  });

  it('WorkloadAuthError.name is "WorkloadAuthError"', async () => {
    const db = createTestDb(false);
    db.prepare('DELETE FROM connections WHERE connectionId = ?').run(TEST_CONN_ID);
    _setDbForTesting(db);

    const workload = new JiraWorkload();
    try {
      await workload.discover('no-such-conn', { projectScope: 'all' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkloadAuthError);
      expect((err as WorkloadAuthError).name).toBe('WorkloadAuthError');
      expect((err as WorkloadAuthError).connectionId).toBe('no-such-conn');
    }
  });
});
