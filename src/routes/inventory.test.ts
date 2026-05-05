import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { handleGetInventory, buildInventoryResponse, handleGetInventoryByType } from './inventory.js';
import type { BackupManifest } from '../workload/backup/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_CONN_ID = 'inv-test-conn-001';
const TEST_CLOUD_ID = 'cloud-inv-test-001';

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
    CREATE TABLE backup_manifests (
      id           TEXT    PRIMARY KEY,
      connectionId TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      cloudId      TEXT    NOT NULL,
      createdAt    TEXT    NOT NULL,
      manifestJson TEXT    NOT NULL
    );
    CREATE TABLE backup_point_items (
      rowId         INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId  TEXT    NOT NULL,
      backupPointId TEXT    NOT NULL,
      objectType    TEXT    NOT NULL CHECK (objectType IN ('Issue', 'Project', 'Board', 'Sprint')),
      itemId        TEXT    NOT NULL,
      displayName   TEXT    NOT NULL,
      summary       TEXT,
      changeBadge   TEXT    NOT NULL DEFAULT 'unchanged' CHECK (changeBadge IN ('added', 'modified', 'deleted', 'unchanged')),
      capturedAt    TEXT    NOT NULL,
      status        TEXT,
      issueType     TEXT,
      assignee      TEXT,
      priority      TEXT,
      updatedAt     TEXT,
      sprintId      TEXT,
      boardId       TEXT,
      labels        TEXT,
      FOREIGN KEY (connectionId) REFERENCES connections(connectionId) ON DELETE CASCADE,
      FOREIGN KEY (backupPointId) REFERENCES backup_manifests(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bpi_unique
      ON backup_point_items(backupPointId, objectType, itemId);
    CREATE INDEX IF NOT EXISTS idx_bpi_lookup
      ON backup_point_items(connectionId, backupPointId, objectType);
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

function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

function seedConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, 'Test Site', now, now);
}

function seedManifest(db: Database.Database, manifest: BackupManifest, id = 'manifest-001'): void {
  const now = manifest.discoveredAt;
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, TEST_CONN_ID, TEST_CLOUD_ID, now, JSON.stringify(manifest));
}

function makeManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    manifestId: 'manifest-001',
    cloudId: TEST_CLOUD_ID,
    discoveredAt: '2026-05-04T10:00:00.000Z',
    projectScope: 'all',
    selectedProjectKeys: [],
    projects: [],
    jsmDeferredProjects: [],
    fieldContexts: null,
    customFieldsCaptured: null,
    customFieldsSkipped: [],
    coverageInvariant: null,
    diffSummary: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Happy path — manifest with mixed projects
// ---------------------------------------------------------------------------

describe('GET /api/inventory — happy path', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('returns 200 with objectTypes array', () => {
    seedManifest(db, makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'PROJ', projectName: 'Project One',
          projectTypeKey: 'software',
          issueCounts: { total: 5, backed: 5, errored: 0 },
          boardIds: ['b1'],
          sprintIds: ['s1', 's2'],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
      customFieldsCaptured: 3,
    }));

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number; lastBackupAt: string | null }> };
    expect(body.objectTypes).toHaveLength(6);
  });

  it('returns correct counts from manifest with mixed projects', () => {
    const manifest = makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'PROJ', projectName: 'Project One',
          projectTypeKey: 'software',
          issueCounts: { total: 10, backed: 8, errored: 2 },
          boardIds: ['b1', 'b2'],
          sprintIds: ['s1', 's2', 's3'],
          changeBadge: 'added',
        },
        {
          projectId: 'p2', projectKey: 'INFRA', projectName: 'Project Two',
          projectTypeKey: 'business',
          issueCounts: { total: 4, backed: 4, errored: 0 },
          boardIds: ['b3'],
          sprintIds: ['s4'],
          changeBadge: 'unchanged',
        },
      ],
      jsmDeferredProjects: [
        { projectId: 'p3', projectKey: 'JSMP', projectName: 'JSM Project', reason: 'PHASE_2_DEFERRED' },
      ],
      customFieldsCaptured: 5,
    });
    seedManifest(db, manifest);

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number; displayName: string; lastBackupAt: string | null }> };
    const byType = Object.fromEntries(body.objectTypes.map(e => [e.type, e]));

    // 2 non-JSM projects (JSM project is in jsmDeferredProjects, not counted)
    expect(byType['Project'].count).toBe(2);
    // backed issues: 8 + 4 = 12
    expect(byType['Issue'].count).toBe(12);
    // boards: b1, b2, b3 = 3
    expect(byType['Board'].count).toBe(3);
    // sprints: s1, s2, s3, s4 = 4
    expect(byType['Sprint'].count).toBe(4);
    // workflows: 0 (not stored in manifest)
    expect(byType['Workflow'].count).toBe(0);
    // custom fields: 5
    expect(byType['CustomField'].count).toBe(5);
  });

  it('returns lastBackupAt from manifest discoveredAt', () => {
    const discoveredAt = '2026-05-04T08:30:00.000Z';
    seedManifest(db, makeManifest({ discoveredAt }));

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ lastBackupAt: string | null }> };
    body.objectTypes.forEach(entry => {
      expect(entry.lastBackupAt).toBe(discoveredAt);
    });
  });

  it('deduplicates boardIds shared across projects', () => {
    const manifest = makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'P1', projectName: 'P1',
          projectTypeKey: 'software',
          issueCounts: { total: 0, backed: 0, errored: 0 },
          boardIds: ['b1', 'b2'],
          sprintIds: [],
          changeBadge: 'added',
        },
        {
          projectId: 'p2', projectKey: 'P2', projectName: 'P2',
          projectTypeKey: 'software',
          issueCounts: { total: 0, backed: 0, errored: 0 },
          boardIds: ['b2', 'b3'],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
    });
    seedManifest(db, manifest);

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number }> };
    const boardEntry = body.objectTypes.find(e => e.type === 'Board');
    expect(boardEntry?.count).toBe(3); // b1, b2, b3 (b2 deduplicated)
  });

  it('falls back to fieldContexts.length when customFieldsCaptured is null', () => {
    const manifest = makeManifest({
      customFieldsCaptured: null,
      fieldContexts: [
        { fieldId: 'customfield_001', fieldName: 'Story Points', custom: true, contexts: [] },
        { fieldId: 'customfield_002', fieldName: 'Epic Link', custom: true, contexts: [] },
      ],
    });
    seedManifest(db, manifest);

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number }> };
    const cfEntry = body.objectTypes.find(e => e.type === 'CustomField');
    expect(cfEntry?.count).toBe(2);
  });

  it('emits structured [inventory] log line with jsmExcludedProjects count', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manifest = makeManifest({
      projects: [],
      jsmDeferredProjects: [
        { projectId: 'p3', projectKey: 'JSM1', projectName: 'JSM Project', reason: 'PHASE_2_DEFERRED' },
        { projectId: 'p4', projectKey: 'JSM2', projectName: 'JSM Project 2', reason: 'PHASE_2_DEFERRED' },
      ],
    });
    seedManifest(db, manifest);

    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), makeRes().res);

    const logCalls = logSpy.mock.calls.map(args => args[0] as string);
    const inventoryLog = logCalls.find(s => s.includes('[inventory]'));
    expect(inventoryLog).toBeDefined();
    expect(inventoryLog).toContain(`connectionId=${TEST_CONN_ID}`);
    expect(inventoryLog).toContain('jsmExcludedProjects=2');
  });

  it('uses the most recent manifest when multiple exist', () => {
    const now = new Date();
    const older = makeManifest({
      discoveredAt: new Date(now.getTime() - 3600_000).toISOString(),
      projects: [
        {
          projectId: 'p-old', projectKey: 'OLD', projectName: 'Old Project',
          projectTypeKey: 'software',
          issueCounts: { total: 1, backed: 1, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
    });
    const newer = makeManifest({
      discoveredAt: now.toISOString(),
      projects: [
        {
          projectId: 'p-new', projectKey: 'NEW', projectName: 'New Project',
          projectTypeKey: 'software',
          issueCounts: { total: 7, backed: 7, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
        {
          projectId: 'p-new2', projectKey: 'NEW2', projectName: 'New Project 2',
          projectTypeKey: 'software',
          issueCounts: { total: 3, backed: 3, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
    });

    seedManifest(db, older, 'manifest-old');
    seedManifest(db, newer, 'manifest-new');

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number }> };
    const projEntry = body.objectTypes.find(e => e.type === 'Project');
    expect(projEntry?.count).toBe(2); // from the newer manifest
  });

  it('includes all six object types in the response', () => {
    seedManifest(db, makeManifest());

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string }> };
    const types = body.objectTypes.map(e => e.type);
    expect(types).toContain('Project');
    expect(types).toContain('Issue');
    expect(types).toContain('Board');
    expect(types).toContain('Sprint');
    expect(types).toContain('Workflow');
    expect(types).toContain('CustomField');
  });
});

// ---------------------------------------------------------------------------
// Error path — no backup point exists
// ---------------------------------------------------------------------------

describe('GET /api/inventory — no backup point', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('returns 200 with zero counts and lastBackupAt null when no manifest exists', () => {
    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { objectTypes: Array<{ count: number; lastBackupAt: string | null }> };
    expect(body.objectTypes).toHaveLength(6);
    body.objectTypes.forEach(entry => {
      expect(entry.count).toBe(0);
      expect(entry.lastBackupAt).toBeNull();
    });
  });

  it('returns 400 when connectionId query parameter is missing', () => {
    const mock = makeRes();
    handleGetInventory(makeReq({}), mock.res);

    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('missing_required_fields');
  });

  it('returns 404 when connection does not exist', () => {
    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: 'non-existent-id' }), mock.res);

    expect(mock.statusCode()).toBe(404);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('connection_not_found');
  });

  it('emits [inventory] log line with backupPointId=none when no manifest exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), makeRes().res);

    const logCalls = logSpy.mock.calls.map(args => args[0] as string);
    const inventoryLog = logCalls.find(s => s.includes('[inventory]'));
    expect(inventoryLog).toBeDefined();
    expect(inventoryLog).toContain('backupPointId=none');
    expect(inventoryLog).toContain('jsmExcludedProjects=0');
  });
});

// ---------------------------------------------------------------------------
// Unit — buildInventoryResponse (pure function)
// ---------------------------------------------------------------------------

describe('buildInventoryResponse', () => {
  it('returns zero counts and null lastBackupAt when manifest is null', () => {
    const result = buildInventoryResponse(null);
    result.objectTypes.forEach(entry => {
      expect(entry.count).toBe(0);
      expect(entry.lastBackupAt).toBeNull();
    });
  });

  it('excludes JSM projects from Project count (manifest already separates them)', () => {
    const manifest = makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'P1', projectName: 'P1',
          projectTypeKey: 'software',
          issueCounts: { total: 0, backed: 0, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [
        { projectId: 'p2', projectKey: 'JSM', projectName: 'JSM', reason: 'PHASE_2_DEFERRED' },
      ],
    });

    const result = buildInventoryResponse(manifest);
    const projEntry = result.objectTypes.find(e => e.type === 'Project');
    expect(projEntry?.count).toBe(1); // JSM project not counted
  });

  it('counts backed issues (not total or errored)', () => {
    const manifest = makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'P1', projectName: 'P1',
          projectTypeKey: 'software',
          issueCounts: { total: 10, backed: 7, errored: 3 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
    });

    const result = buildInventoryResponse(manifest);
    const issueEntry = result.objectTypes.find(e => e.type === 'Issue');
    expect(issueEntry?.count).toBe(7);
  });

  it('jsmExcluded is false on all entries when no JSM projects are deferred', () => {
    const manifest = makeManifest({
      projects: [
        {
          projectId: 'p1', projectKey: 'PROJ', projectName: 'PROJ',
          projectTypeKey: 'software',
          issueCounts: { total: 0, backed: 0, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [],
    });

    const result = buildInventoryResponse(manifest);
    result.objectTypes.forEach(entry => {
      expect(entry.jsmExcluded).toBe(false);
    });
  });

  it('jsmExcluded is true on all entries when ≥1 JSM project is deferred', () => {
    const manifest = makeManifest({
      projects: [],
      jsmDeferredProjects: [
        { projectId: 'p-jsm', projectKey: 'HELP', projectName: 'Help Desk', reason: 'PHASE_2_DEFERRED' },
      ],
    });

    const result = buildInventoryResponse(manifest);
    result.objectTypes.forEach(entry => {
      expect(entry.jsmExcluded).toBe(true);
    });
  });

  it('jsmExcluded is false on all entries when manifest is null', () => {
    const result = buildInventoryResponse(null);
    result.objectTypes.forEach(entry => {
      expect(entry.jsmExcluded).toBe(false);
    });
  });
});

// ===========================================================================
// GET /api/inventory/:type  tests
// ===========================================================================

const INV_CONN_ID = 'inv-type-conn-001';
const INV_CLOUD_ID = 'cloud-inv-type-001';
const INV_BP_ID = 'bp-inv-type-001';
const INV_CAPTURED_AT = '2026-05-04T10:00:00.000Z';

function seedInventoryConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(INV_CONN_ID, INV_CLOUD_ID, 'Inv Test Site', now, now);
}

function seedInventoryManifest(db: Database.Database): void {
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(INV_BP_ID, INV_CONN_ID, INV_CLOUD_ID, INV_CAPTURED_AT, '{}');
}

function seedInventoryItems(
  db: Database.Database,
  type: string,
  count: number,
  startIndex = 1
): void {
  const stmt = db.prepare(
    `INSERT INTO backup_point_items
       (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'unchanged', ?)`
  );
  for (let i = startIndex; i < startIndex + count; i++) {
    const itemId = type === 'Issue' ? `PROJ-${i}` : `${type.toLowerCase()}-${i}`;
    const displayName = itemId;
    const summary = type === 'Issue' ? `Summary for ${itemId}` : null;
    stmt.run(INV_CONN_ID, INV_BP_ID, type, itemId, displayName, summary, INV_CAPTURED_AT);
  }
}

function makeTypeReq(params: { type: string }, query: Record<string, string>): Request {
  return { params, query } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Happy-path — pagination math
// ---------------------------------------------------------------------------

describe('GET /api/inventory/:type — pagination math', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedInventoryConnection(db);
    seedInventoryManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns all items on first page when count < default limit', () => {
    seedInventoryItems(db, 'Issue', 10);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: unknown[]; pagination: { limit: number; offset: number; total: number } };
    expect(body.pagination.total).toBe(10);
    expect(body.pagination.limit).toBe(50);
    expect(body.pagination.offset).toBe(0);
    expect(body.items).toHaveLength(10);
  });

  it('returns correct slice with explicit limit and offset', () => {
    seedInventoryItems(db, 'Issue', 25);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq(
        { type: 'Issue' },
        { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID, limit: '10', offset: '10' }
      ),
      mock.res
    );

    const body = mock.jsonBody() as { items: unknown[]; pagination: { limit: number; offset: number; total: number } };
    expect(body.pagination.total).toBe(25);
    expect(body.pagination.limit).toBe(10);
    expect(body.pagination.offset).toBe(10);
    expect(body.items).toHaveLength(10);
  });

  it('returns partial page when remaining items < limit', () => {
    seedInventoryItems(db, 'Issue', 7);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq(
        { type: 'Issue' },
        { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID, limit: '5', offset: '5' }
      ),
      mock.res
    );

    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(7);
    expect(body.items).toHaveLength(2);
  });

  it('returns empty items array with total=0 when no items exist', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Sprint' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number } };
    expect(mock.statusCode()).toBe(200);
    expect(body.pagination.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('clamps limit to 200 maximum', () => {
    seedInventoryItems(db, 'Project', 3);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID, limit: '999' }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { limit: number } };
    expect(body.pagination.limit).toBe(200);
  });

  it('totals do not cross-contaminate between object types', () => {
    seedInventoryItems(db, 'Issue', 5);
    seedInventoryItems(db, 'Project', 3);

    const issueMock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      issueMock.res
    );
    const projectMock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      projectMock.res
    );

    expect((issueMock.jsonBody() as { pagination: { total: number } }).pagination.total).toBe(5);
    expect((projectMock.jsonBody() as { pagination: { total: number } }).pagination.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Issue shape — displayName and summary
// ---------------------------------------------------------------------------

describe('GET /api/inventory/Issue — item shape', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedInventoryConnection(db);
    seedInventoryManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns displayName as <PROJECT_KEY>-<N> format and includes summary', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', 'ALPHA-42', 'ALPHA-42', 'Fix the login bug', 'unchanged', ?)`
    ).run(INV_CONN_ID, INV_BP_ID, INV_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const item = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items[0];
    expect(item['id']).toBe('ALPHA-42');
    expect(item['displayName']).toBe('ALPHA-42');
    expect(item['summary']).toBe('Fix the login bug');
    expect(item['backupPointId']).toBe(INV_BP_ID);
    expect(item['backupPointTimestamp']).toBe(INV_CAPTURED_AT);
    expect(item['changeBadge']).toBe('unchanged');
  });

  it('returns summary as empty string when null in DB', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', 'PROJ-1', 'PROJ-1', NULL, 'unchanged', ?)`
    ).run(INV_CONN_ID, INV_BP_ID, INV_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const item = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items[0];
    expect(item['summary']).toBe('');
  });

  it('Issue items include projectKey and issueNumber extracted from the issue key', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', 'ALPHA-42', 'ALPHA-42', 'Some issue', 'unchanged', ?)`
    ).run(INV_CONN_ID, INV_BP_ID, INV_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const item = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items[0];
    expect(item['projectKey']).toBe('ALPHA');
    expect(item['issueNumber']).toBe(42);
  });

  it('Project items do not include summary, projectKey, or issueNumber fields', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', 'proj-001', 'MYPROJ', 'My Project', 'added', ?)`
    ).run(INV_CONN_ID, INV_BP_ID, INV_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const item = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items[0];
    expect('summary' in item).toBe(false);
    expect('projectKey' in item).toBe(false);
    expect('issueNumber' in item).toBe(false);
    expect(item['changeBadge']).toBe('added');
  });

  it('changeBadge is correctly returned for each badge value', () => {
    const badges = ['added', 'modified', 'unchanged', 'deleted'] as const;
    const stmt = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', ?, ?, ?, ?)`
    );
    badges.forEach((badge, i) => {
      stmt.run(INV_CONN_ID, INV_BP_ID, `p-${i}`, `PROJ-${i}`, badge, INV_CAPTURED_AT);
    });

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    const items = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items;
    const returnedBadges = items.map((it) => it['changeBadge']);
    expect(returnedBadges).toEqual(expect.arrayContaining(['added', 'modified', 'unchanged', 'deleted']));
  });
});

// ---------------------------------------------------------------------------
// Error paths — invalid type and missing params
// ---------------------------------------------------------------------------

describe('GET /api/inventory/:type — error paths', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedInventoryConnection(db);
    seedInventoryManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 400 with invalid_type for an unrecognised type', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Workflow' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_type');
  });

  it('returns 400 with invalid_type for case-sensitive mismatch', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'issue' }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_type');
  });

  it('returns 400 with missing_required_fields and mentions backupPointId when absent', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('missing_required_fields');
    expect(String(body['message'])).toMatch(/backupPointId/);
  });

  it('returns 400 with missing_required_fields and mentions connectionId when absent', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('missing_required_fields');
    expect(String(body['message'])).toMatch(/connectionId/);
  });

  it('returns 400 for other invalid type strings', () => {
    const invalidTypes = ['Attachment', 'CustomField', 'audit', ''];
    for (const badType of invalidTypes) {
      const mock = makeRes();
      handleGetInventoryByType(
        makeTypeReq({ type: badType }, { connectionId: INV_CONN_ID, backupPointId: INV_BP_ID }),
        mock.res
      );
      expect(mock.statusCode()).toBe(400);
      expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_type');
    }
  });

  it('returns 404 with connection_not_found for an unknown connectionId', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: 'does-not-exist', backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(404);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('connection_not_found');
    expect(String(body['message'])).toMatch(/does-not-exist/);
  });

  it('returns 404 with backup_point_not_found for an unknown backupPointId', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: INV_CONN_ID, backupPointId: 'bp-does-not-exist' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(404);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('backup_point_not_found');
    expect(String(body['message'])).toMatch(/bp-does-not-exist/);
  });

  it('returns 404 backup_point_not_found when backupPointId belongs to a different connection', () => {
    const otherConnId = 'other-conn-9999';
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).run(otherConnId, 'cloud-other-9999', 'Other Site', now, now);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: otherConnId, backupPointId: INV_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(404);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('backup_point_not_found');
  });
});

// ---------------------------------------------------------------------------
// changeBadge transitions — two-backup-point fixture
// ---------------------------------------------------------------------------

const TWO_BP_CONN_ID = 'two-bp-conn-001';
const TWO_BP_CLOUD_ID = 'cloud-two-bp-001';
const TWO_BP_BP1_ID = 'bp-two-bp-001';
const TWO_BP_BP2_ID = 'bp-two-bp-002';
const TWO_BP_TS1 = '2026-05-04T08:00:00.000Z';
const TWO_BP_TS2 = '2026-05-04T12:00:00.000Z';

describe('GET /api/inventory/:type — changeBadge transitions (two-backup-point fixture)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).run(TWO_BP_CONN_ID, TWO_BP_CLOUD_ID, 'Two BP Site', now, now);

    // Backup point 1: issues PROJ-1, PROJ-2, PROJ-3 all freshly added
    db.prepare(
      `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(TWO_BP_BP1_ID, TWO_BP_CONN_ID, TWO_BP_CLOUD_ID, TWO_BP_TS1, '{}');

    const insertItem = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', ?, ?, ?, ?, ?)`
    );
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP1_ID, 'PROJ-1', 'PROJ-1', 'Issue one', 'added', TWO_BP_TS1);
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP1_ID, 'PROJ-2', 'PROJ-2', 'Issue two', 'added', TWO_BP_TS1);
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP1_ID, 'PROJ-3', 'PROJ-3', 'Issue three', 'added', TWO_BP_TS1);

    // Backup point 2:
    //   PROJ-1 → modified (existing issue changed)
    //   PROJ-2 → unchanged (no changes detected)
    //   PROJ-3 → deleted (issue removed from Jira)
    //   PROJ-4 → added   (brand-new issue)
    db.prepare(
      `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(TWO_BP_BP2_ID, TWO_BP_CONN_ID, TWO_BP_CLOUD_ID, TWO_BP_TS2, '{}');

    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP2_ID, 'PROJ-1', 'PROJ-1', 'Issue one updated', 'modified', TWO_BP_TS2);
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP2_ID, 'PROJ-2', 'PROJ-2', 'Issue two', 'unchanged', TWO_BP_TS2);
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP2_ID, 'PROJ-3', 'PROJ-3', 'Issue three', 'deleted', TWO_BP_TS2);
    insertItem.run(TWO_BP_CONN_ID, TWO_BP_BP2_ID, 'PROJ-4', 'PROJ-4', 'Issue four', 'added', TWO_BP_TS2);
  });

  afterEach(() => {
    _resetDb();
  });

  it('backup point 2 contains all four changeBadge states', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TWO_BP_CONN_ID, backupPointId: TWO_BP_BP2_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(4);

    const badges = body.items.map((it) => it['changeBadge']);
    expect(badges).toContain('added');
    expect(badges).toContain('modified');
    expect(badges).toContain('deleted');
    expect(badges).toContain('unchanged');
  });

  it('backup point 1 shows all items as added', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TWO_BP_CONN_ID, backupPointId: TWO_BP_BP1_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(3);
    body.items.forEach((item) => {
      expect(item['changeBadge']).toBe('added');
    });
  });

  it('each backup point is isolated — querying bp1 after bp2 returns only bp1 items', () => {
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TWO_BP_CONN_ID, backupPointId: TWO_BP_BP2_ID }),
      makeRes().res
    );

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TWO_BP_CONN_ID, backupPointId: TWO_BP_BP1_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(3);
  });

  it('PROJ-3 is stored with deleted badge in backup point 2', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TWO_BP_CONN_ID, backupPointId: TWO_BP_BP2_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>> };
    const proj3 = body.items.find((it) => it['id'] === 'PROJ-3');
    expect(proj3).toBeDefined();
    expect(proj3!['changeBadge']).toBe('deleted');
  });

  it('service_desk project in JSM fixture is excluded from the summary inventory response', () => {
    // Build a manifest that has one software project and one service_desk deferred project
    const jsmManifestId = 'bp-jsm-fixture-001';
    const jsmConnId = TWO_BP_CONN_ID;
    const jsmTs = '2026-05-04T16:00:00.000Z'; // must be after TWO_BP_TS2 (12:00) to be the latest manifest

    const jsmManifest = {
      manifestId: jsmManifestId,
      cloudId: TWO_BP_CLOUD_ID,
      discoveredAt: jsmTs,
      projectScope: 'all',
      selectedProjectKeys: [],
      projects: [
        {
          projectId: 'p-sw', projectKey: 'SW', projectName: 'Software Project',
          projectTypeKey: 'software',
          issueCounts: { total: 10, backed: 10, errored: 0 },
          boardIds: ['b1'],
          sprintIds: ['s1'],
          changeBadge: 'added',
        },
      ],
      jsmDeferredProjects: [
        { projectId: 'p-jsm', projectKey: 'JSM', projectName: 'Service Desk Project', reason: 'PHASE_2_DEFERRED' },
      ],
      fieldContexts: null,
      customFieldsCaptured: 2,
      customFieldsSkipped: [],
      coverageInvariant: null,
      diffSummary: null,
    };

    db.prepare(
      `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(jsmManifestId, jsmConnId, TWO_BP_CLOUD_ID, jsmTs, JSON.stringify(jsmManifest));

    // Query the summary endpoint — JSM project must be excluded from Project count
    // We need a fresh db lookup for the conn which is already seeded with TWO_BP_CONN_ID
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const mock = makeRes();
    handleGetInventory(makeReq({ connectionId: jsmConnId }), mock.res);

    vi.restoreAllMocks();

    const body = mock.jsonBody() as { objectTypes: Array<{ type: string; count: number }> };
    const projEntry = body.objectTypes.find((e) => e.type === 'Project');
    // Only 1 software project; the service_desk project is in jsmDeferredProjects and must not be counted
    expect(projEntry?.count).toBe(1);
    const issueEntry = body.objectTypes.find((e) => e.type === 'Issue');
    expect(issueEntry?.count).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Single-click trace — every returned item exposes backupPointId + timestamp
// ---------------------------------------------------------------------------

const TRACE_CONN_ID = 'trace-conn-001';
const TRACE_CLOUD_ID = 'cloud-trace-001';
const TRACE_BP_ID = 'bp-trace-001';
const TRACE_TS = '2026-05-04T14:30:00.000Z';

describe('GET /api/inventory/:type — single-click traceability', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
       VALUES (?, ?, ?, 'active', ?, ?)`
    ).run(TRACE_CONN_ID, TRACE_CLOUD_ID, 'Trace Site', now, now);

    db.prepare(
      `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
       VALUES (?, ?, ?, ?, ?)`
    ).run(TRACE_BP_ID, TRACE_CONN_ID, TRACE_CLOUD_ID, TRACE_TS, '{}');
  });

  afterEach(() => {
    _resetDb();
  });

  it('every Issue item exposes backupPointId and backupPointTimestamp', () => {
    const stmt = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', ?, ?, ?, 'unchanged', ?)`
    );
    for (let i = 1; i <= 5; i++) {
      stmt.run(TRACE_CONN_ID, TRACE_BP_ID, `TRACE-${i}`, `TRACE-${i}`, `Summary ${i}`, TRACE_TS);
    }

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: TRACE_CONN_ID, backupPointId: TRACE_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(5);
    body.items.forEach((item) => {
      expect(item['backupPointId']).toBe(TRACE_BP_ID);
      expect(item['backupPointTimestamp']).toBe(TRACE_TS);
    });
  });

  it('every Project item exposes backupPointId and backupPointTimestamp', () => {
    const stmt = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', ?, ?, 'added', ?)`
    );
    stmt.run(TRACE_CONN_ID, TRACE_BP_ID, 'proj-trace-1', 'TRACE', TRACE_TS);
    stmt.run(TRACE_CONN_ID, TRACE_BP_ID, 'proj-trace-2', 'INFRA', TRACE_TS);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: TRACE_CONN_ID, backupPointId: TRACE_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(2);
    body.items.forEach((item) => {
      expect(item['backupPointId']).toBe(TRACE_BP_ID);
      expect(item['backupPointTimestamp']).toBe(TRACE_TS);
    });
  });

  it('every Sprint item exposes backupPointId and backupPointTimestamp', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Sprint', 'sprint-trace-1', 'Sprint 1', 'unchanged', ?)`
    ).run(TRACE_CONN_ID, TRACE_BP_ID, TRACE_TS);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Sprint' }, { connectionId: TRACE_CONN_ID, backupPointId: TRACE_BP_ID }),
      mock.res
    );

    const item = (mock.jsonBody() as { items: Array<Record<string, unknown>> }).items[0];
    expect(item['backupPointId']).toBe(TRACE_BP_ID);
    expect(item['backupPointTimestamp']).toBe(TRACE_TS);
  });

  it('backupPointId and backupPointTimestamp are present regardless of changeBadge value', () => {
    const badges = ['added', 'modified', 'deleted', 'unchanged'] as const;
    const stmt = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Board', ?, ?, ?, ?)`
    );
    badges.forEach((badge, i) => {
      stmt.run(TRACE_CONN_ID, TRACE_BP_ID, `board-trace-${i}`, `Board ${i}`, badge, TRACE_TS);
    });

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Board' }, { connectionId: TRACE_CONN_ID, backupPointId: TRACE_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>> };
    body.items.forEach((item) => {
      expect(item['backupPointId']).toBe(TRACE_BP_ID);
      expect(item['backupPointTimestamp']).toBe(TRACE_TS);
    });
  });
});

// ===========================================================================
// JSM project exclusion — GET /api/inventory/:type
// ===========================================================================

const JSM_CONN_ID = 'jsm-excl-conn-001';
const JSM_CLOUD_ID = 'cloud-jsm-excl-001';
const JSM_BP_ID = 'bp-jsm-excl-001';
const JSM_CAPTURED_AT = '2026-05-04T10:00:00.000Z';

function seedJsmConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(JSM_CONN_ID, JSM_CLOUD_ID, 'JSM Excl Site', now, now);
}

function seedManifestWithJsmDeferred(
  db: Database.Database,
  jsmProjects: Array<{ projectId: string; projectKey: string }>,
  id = JSM_BP_ID
): void {
  const manifest = {
    manifestId: id,
    cloudId: JSM_CLOUD_ID,
    discoveredAt: JSM_CAPTURED_AT,
    projectScope: 'all',
    selectedProjectKeys: [],
    projects: [],
    jsmDeferredProjects: jsmProjects.map(p => ({
      projectId: p.projectId,
      projectKey: p.projectKey,
      projectName: `JSM ${p.projectKey}`,
      reason: 'PHASE_2_DEFERRED',
    })),
    fieldContexts: null,
    customFieldsCaptured: null,
    customFieldsSkipped: [],
    coverageInvariant: null,
    diffSummary: null,
  };
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, JSM_CONN_ID, JSM_CLOUD_ID, JSM_CAPTURED_AT, JSON.stringify(manifest));
}

describe('GET /api/inventory/:type — JSM project exclusion', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedJsmConnection(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('happy-path: excludes JSM project item from Project listing (mixed software + JSM)', () => {
    seedManifestWithJsmDeferred(db, [{ projectId: 'jsm-proj-id', projectKey: 'JSMP' }]);

    const insertItem = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', ?, ?, 'added', ?)`
    );
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'sw-proj-id', 'SWPROJ', JSM_CAPTURED_AT);
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'jsm-proj-id', 'JSMP', JSM_CAPTURED_AT); // must be excluded

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: JSM_CONN_ID, backupPointId: JSM_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]['id']).toBe('sw-proj-id');
  });

  it('happy-path: excludes JSM issues from Issue listing by project key prefix', () => {
    seedManifestWithJsmDeferred(db, [{ projectId: 'jsm-proj-id', projectKey: 'JSMP' }]);

    const insertItem = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', ?, ?, ?, 'unchanged', ?)`
    );
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'SWPROJ-1', 'SWPROJ-1', 'SW issue 1', JSM_CAPTURED_AT);
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'SWPROJ-2', 'SWPROJ-2', 'SW issue 2', JSM_CAPTURED_AT);
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'JSMP-1', 'JSMP-1', 'JSM issue 1', JSM_CAPTURED_AT); // must be excluded
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'JSMP-2', 'JSMP-2', 'JSM issue 2', JSM_CAPTURED_AT); // must be excluded

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: JSM_CONN_ID, backupPointId: JSM_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
    expect(body.items).toHaveLength(2);
    const ids = body.items.map((it) => it['id'] as string);
    expect(ids).toContain('SWPROJ-1');
    expect(ids).toContain('SWPROJ-2');
    expect(ids).not.toContain('JSMP-1');
    expect(ids).not.toContain('JSMP-2');
  });

  it('error-path: all-JSM site returns 200 with zero Project count (not 500)', () => {
    seedManifestWithJsmDeferred(db, [
      { projectId: 'jsm-p1', projectKey: 'HELP' },
      { projectId: 'jsm-p2', projectKey: 'ITSM' },
    ]);
    const insertItem = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', ?, ?, 'added', ?)`
    );
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'jsm-p1', 'HELP', JSM_CAPTURED_AT);
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'jsm-p2', 'ITSM', JSM_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: JSM_CONN_ID, backupPointId: JSM_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('error-path: all-JSM site returns 200 with zero Issue count (not 500)', () => {
    seedManifestWithJsmDeferred(db, [{ projectId: 'jsm-p1', projectKey: 'HELP' }]);
    const insertItem = db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', ?, ?, ?, 'added', ?)`
    );
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'HELP-1', 'HELP-1', 'JSM issue 1', JSM_CAPTURED_AT);
    insertItem.run(JSM_CONN_ID, JSM_BP_ID, 'HELP-2', 'HELP-2', 'JSM issue 2', JSM_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeTypeReq({ type: 'Issue' }, { connectionId: JSM_CONN_ID, backupPointId: JSM_BP_ID }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });

  it('emits per-project log lines for each JSM deferred project', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    seedManifestWithJsmDeferred(db, [
      { projectId: 'jsm-p1', projectKey: 'HELP' },
      { projectId: 'jsm-p2', projectKey: 'ITSM' },
    ]);

    handleGetInventoryByType(
      makeTypeReq({ type: 'Project' }, { connectionId: JSM_CONN_ID, backupPointId: JSM_BP_ID }),
      makeRes().res
    );

    const logCalls = logSpy.mock.calls.map((args) => String(args[0]));
    const jsmLogs = logCalls.filter((s) => s.includes('jsm_excluded'));
    expect(jsmLogs).toHaveLength(2);
    expect(jsmLogs.some((s) => s.includes('projectKey=HELP') && s.includes('reason=service_desk'))).toBe(true);
    expect(jsmLogs.some((s) => s.includes('projectKey=ITSM') && s.includes('reason=service_desk'))).toBe(true);
  });
});

// ===========================================================================
// Per-project JSM log lines — GET /api/inventory
// ===========================================================================

describe('GET /api/inventory — per-project JSM log lines', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedConnection(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('emits per-project log line for each JSM-deferred project', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manifest = makeManifest({
      jsmDeferredProjects: [
        { projectId: 'p-jsm1', projectKey: 'DESK', projectName: 'Service Desk 1', reason: 'PHASE_2_DEFERRED' },
        { projectId: 'p-jsm2', projectKey: 'HELP2', projectName: 'Help Center', reason: 'PHASE_2_DEFERRED' },
      ],
    });
    seedManifest(db, manifest);

    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), makeRes().res);

    const logCalls = logSpy.mock.calls.map((args) => String(args[0]));
    const jsmLogs = logCalls.filter((s) => s.includes('jsm_excluded'));
    expect(jsmLogs).toHaveLength(2);
    expect(jsmLogs.some((s) => s.includes('projectKey=DESK') && s.includes('reason=service_desk'))).toBe(true);
    expect(jsmLogs.some((s) => s.includes('projectKey=HELP2') && s.includes('reason=service_desk'))).toBe(true);
  });

  it('emits no per-project log line when there are no JSM-deferred projects', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manifest = makeManifest({ jsmDeferredProjects: [] });
    seedManifest(db, manifest);

    handleGetInventory(makeReq({ connectionId: TEST_CONN_ID }), makeRes().res);

    const logCalls = logSpy.mock.calls.map((args) => String(args[0]));
    const jsmLogs = logCalls.filter((s) => s.includes('jsm_excluded'));
    expect(jsmLogs).toHaveLength(0);
  });
});

// ===========================================================================
// Filter facets — GET /api/inventory/Issue
// ===========================================================================

const FACET_CONN_ID = 'facet-conn-001';
const FACET_CLOUD_ID = 'cloud-facet-001';
const FACET_BP_ID = 'bp-facet-001';
const FACET_CAPTURED_AT = '2026-05-04T10:00:00.000Z';

interface FacetItemSeed {
  itemId: string;
  summary?: string;
  status?: string;
  issueType?: string;
  assignee?: string;
  priority?: string;
  updatedAt?: string;
  sprintId?: string;
  boardId?: string;
  labels?: string[];
  changeBadge?: string;
}

function seedFacetConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(FACET_CONN_ID, FACET_CLOUD_ID, 'Facet Test Site', now, now);
}

function seedFacetManifest(db: Database.Database, jsmProjectKeys: string[] = []): void {
  const jsmDeferredProjects = jsmProjectKeys.map((k, i) => ({
    projectId: `jsm-proj-${i}`,
    projectKey: k,
    projectName: `JSM ${k}`,
    reason: 'PHASE_2_DEFERRED',
  }));
  const manifest = {
    manifestId: FACET_BP_ID,
    cloudId: FACET_CLOUD_ID,
    discoveredAt: FACET_CAPTURED_AT,
    projectScope: 'all',
    selectedProjectKeys: [],
    projects: [],
    jsmDeferredProjects,
    fieldContexts: null,
    customFieldsCaptured: null,
    customFieldsSkipped: [],
    coverageInvariant: null,
    diffSummary: null,
  };
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(FACET_BP_ID, FACET_CONN_ID, FACET_CLOUD_ID, FACET_CAPTURED_AT, JSON.stringify(manifest));
}

function seedFacetItem(db: Database.Database, item: FacetItemSeed): void {
  db.prepare(
    `INSERT INTO backup_point_items
       (connectionId, backupPointId, objectType, itemId, displayName, summary,
        changeBadge, capturedAt, status, issueType, assignee, priority, updatedAt,
        sprintId, boardId, labels)
     VALUES (?, ?, 'Issue', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    FACET_CONN_ID,
    FACET_BP_ID,
    item.itemId,
    item.itemId,
    item.summary ?? null,
    item.changeBadge ?? 'unchanged',
    FACET_CAPTURED_AT,
    item.status ?? null,
    item.issueType ?? null,
    item.assignee ?? null,
    item.priority ?? null,
    item.updatedAt ?? null,
    item.sprintId ?? null,
    item.boardId ?? null,
    item.labels ? JSON.stringify(item.labels) : null,
  );
}

function makeFacetReq(query: Record<string, string | string[]>): Request {
  return { params: { type: 'Issue' }, query } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Happy-path — single facet match
// ---------------------------------------------------------------------------

describe('GET /api/inventory/Issue — filter facets (happy path, single facet)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedFacetConnection(db);
    seedFacetManifest(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('filters by status — returns only matching issues', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress' });
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'Done' });
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'In Progress' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, status: 'In Progress' }), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
    expect(body.items.map((i) => i['id'])).toEqual(expect.arrayContaining(['PROJ-1', 'PROJ-3']));
  });

  it('filters by issueType — returns only matching issues', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', issueType: 'Bug' });
    seedFacetItem(db, { itemId: 'PROJ-2', issueType: 'Story' });
    seedFacetItem(db, { itemId: 'PROJ-3', issueType: 'Bug' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, issueType: 'Bug' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('filters by assignee', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', assignee: 'alice' });
    seedFacetItem(db, { itemId: 'PROJ-2', assignee: 'bob' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, assignee: 'alice' }), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('filters by priority', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', priority: 'High' });
    seedFacetItem(db, { itemId: 'PROJ-2', priority: 'Low' });
    seedFacetItem(db, { itemId: 'PROJ-3', priority: 'High' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, priority: 'High' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('filters by sprint', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', sprintId: 'sprint-123' });
    seedFacetItem(db, { itemId: 'PROJ-2', sprintId: 'sprint-999' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, sprint: 'sprint-123' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('filters by board', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', boardId: 'board-42' });
    seedFacetItem(db, { itemId: 'PROJ-2', boardId: 'board-99' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, board: 'board-42' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('filters by label — matches issues whose labels array contains the value', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', labels: ['bug', 'frontend'] });
    seedFacetItem(db, { itemId: 'PROJ-2', labels: ['backend'] });
    seedFacetItem(db, { itemId: 'PROJ-3', labels: ['bug', 'backend'] });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, label: 'bug' }), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
    const ids = body.items.map((i) => i['id'] as string);
    expect(ids).toContain('PROJ-1');
    expect(ids).toContain('PROJ-3');
  });

  it('filters by updatedFrom — only issues updated on or after the date', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', updatedAt: '2026-05-01T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-2', updatedAt: '2026-05-03T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-3', updatedAt: '2026-05-05T00:00:00.000Z' });

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedFrom: '2026-05-03' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('filters by updatedTo — only issues updated on or before the datetime', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', updatedAt: '2026-05-01T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-2', updatedAt: '2026-05-03T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-3', updatedAt: '2026-05-05T00:00:00.000Z' });

    const mock = makeRes();
    // Use end-of-day datetime so that May 3 items are included; a date-only value
    // is lexicographically less than a full ISO datetime on the same day.
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedTo: '2026-05-03T23:59:59.999Z' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('OR within same facet — multiple status values return union', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress' });
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'Done' });
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'To Do' });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, status: ['In Progress', 'Done'] }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('AND within label facet — issue must have all specified labels', () => {
    // PROJ-1 has both 'bug' and 'frontend' → matches AND condition
    seedFacetItem(db, { itemId: 'PROJ-1', labels: ['bug', 'frontend'] });
    // PROJ-2 has only 'bug' — missing 'frontend' → no match
    seedFacetItem(db, { itemId: 'PROJ-2', labels: ['bug'] });
    // PROJ-3 has only 'frontend' — missing 'bug' → no match
    seedFacetItem(db, { itemId: 'PROJ-3', labels: ['frontend'] });
    // PROJ-4 has neither → no match
    seedFacetItem(db, { itemId: 'PROJ-4', labels: ['backend'] });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, label: ['bug', 'frontend'] }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('pagination totalCount reflects filtered result set (not full set)', () => {
    // 5 issues: 3 In Progress, 2 Done
    for (let i = 1; i <= 3; i++) seedFacetItem(db, { itemId: `PROJ-${i}`, status: 'In Progress' });
    for (let i = 4; i <= 5; i++) seedFacetItem(db, { itemId: `PROJ-${i}`, status: 'Done' });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, status: 'In Progress', limit: '2', offset: '0' }),
      mock.res
    );

    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number; limit: number } };
    // total reflects the filtered count (3), not the full count (5)
    expect(body.pagination.total).toBe(3);
    // only 2 items returned due to limit
    expect(body.items).toHaveLength(2);
  });

  it('issues with null label are excluded from label filter results', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', labels: ['bug'] });
    seedFacetItem(db, { itemId: 'PROJ-2' }); // labels is NULL

    const mock = makeRes();
    handleGetInventoryByType(makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, label: 'bug' }), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('no facet params returns all issues (unfiltered)', () => {
    for (let i = 1; i <= 4; i++) seedFacetItem(db, { itemId: `PROJ-${i}`, status: 'In Progress' });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Multi-facet AND test
// ---------------------------------------------------------------------------

describe('GET /api/inventory/Issue — multi-facet AND combination', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedFacetConnection(db);
    seedFacetManifest(db);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('AND across facets — status AND priority narrows result set', () => {
    // PROJ-1: In Progress + High → match
    // PROJ-2: In Progress + Low → no match (priority fails)
    // PROJ-3: Done + High → no match (status fails)
    // PROJ-4: Done + Low → no match
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress', priority: 'High' });
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'In Progress', priority: 'Low' });
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'Done', priority: 'High' });
    seedFacetItem(db, { itemId: 'PROJ-4', status: 'Done', priority: 'Low' });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, status: 'In Progress', priority: 'High' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('AND across three facets — status AND issueType AND assignee', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress', issueType: 'Bug', assignee: 'alice' });
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'In Progress', issueType: 'Bug', assignee: 'bob' });
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'Done', issueType: 'Bug', assignee: 'alice' });
    seedFacetItem(db, { itemId: 'PROJ-4', status: 'In Progress', issueType: 'Story', assignee: 'alice' });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({
        connectionId: FACET_CONN_ID,
        backupPointId: FACET_BP_ID,
        status: 'In Progress',
        issueType: 'Bug',
        assignee: 'alice',
      }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('AND within label combined with status — issue must have all labels and match status', () => {
    // PROJ-1: In Progress + both labels → matches both conditions
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress', labels: ['bug', 'frontend'] });
    // PROJ-2: In Progress + only 'bug' → label condition fails (missing 'frontend')
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'In Progress', labels: ['bug'] });
    // PROJ-3: Done + both labels → status condition fails
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'Done', labels: ['bug', 'frontend'] });
    // PROJ-4: In Progress + unrelated labels → label condition fails
    seedFacetItem(db, { itemId: 'PROJ-4', status: 'In Progress', labels: ['backend'] });

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({
        connectionId: FACET_CONN_ID,
        backupPointId: FACET_BP_ID,
        status: 'In Progress',
        label: ['bug', 'frontend'],
      }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('date-range AND status narrows results', () => {
    seedFacetItem(db, { itemId: 'PROJ-1', status: 'In Progress', updatedAt: '2026-05-01T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-2', status: 'In Progress', updatedAt: '2026-05-04T00:00:00.000Z' });
    seedFacetItem(db, { itemId: 'PROJ-3', status: 'Done', updatedAt: '2026-05-04T00:00:00.000Z' }); // status fails

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({
        connectionId: FACET_CONN_ID,
        backupPointId: FACET_BP_ID,
        status: 'In Progress',
        updatedFrom: '2026-05-03',
      }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('pagination totalCount reflects multi-facet filtered set', () => {
    for (let i = 1; i <= 5; i++) {
      seedFacetItem(db, { itemId: `PROJ-${i}`, status: 'In Progress', priority: 'High' });
    }
    for (let i = 6; i <= 10; i++) {
      seedFacetItem(db, { itemId: `PROJ-${i}`, status: 'Done', priority: 'High' });
    }

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({
        connectionId: FACET_CONN_ID,
        backupPointId: FACET_BP_ID,
        status: 'In Progress',
        priority: 'High',
        limit: '2',
      }),
      mock.res
    );

    const body = mock.jsonBody() as { items: unknown[]; pagination: { total: number } };
    expect(body.pagination.total).toBe(5); // filtered total, not 10
    expect(body.items).toHaveLength(2);    // limited page
  });
});

// ---------------------------------------------------------------------------
// Error-path — invalid date format
// ---------------------------------------------------------------------------

describe('GET /api/inventory/Issue — filter facets error paths', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedFacetConnection(db);
    seedFacetManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('returns 400 with error.code=invalid_date_format for non-ISO updatedFrom', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedFrom: '05/01/2026' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_date_format');
    expect(typeof body['message']).toBe('string');
  });

  it('returns 400 with error.code=invalid_date_format for non-ISO updatedTo', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedTo: 'not-a-date' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    const body = mock.jsonBody() as Record<string, unknown>;
    expect(body['error']).toBe('invalid_date_format');
  });

  it('returns 400 for garbage string in updatedFrom', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedFrom: 'yesterday' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(400);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('invalid_date_format');
  });

  it('accepts valid ISO-8601 date-only string without error', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedFrom: '2026-05-01' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
  });

  it('accepts valid ISO-8601 datetime string without error', () => {
    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, updatedTo: '2026-05-31T23:59:59.000Z' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// JSM exclusion preserved under filter combinations
// ---------------------------------------------------------------------------

describe('GET /api/inventory/Issue — JSM exclusion preserved under facet filters', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedFacetConnection(db);
    seedFacetManifest(db, ['JSMP']); // JSMP is JSM-deferred
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetDb();
  });

  it('JSM issues are excluded even when a facet filter would otherwise match them', () => {
    // Software issue — matches status filter
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status)
       VALUES (?, ?, 'Issue', 'SWPROJ-1', 'SWPROJ-1', 'SW issue', 'unchanged', ?, 'In Progress')`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    // JSM issue — also matches status filter but must be excluded
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status)
       VALUES (?, ?, 'Issue', 'JSMP-1', 'JSMP-1', 'JSM issue', 'unchanged', ?, 'In Progress')`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID, status: 'In Progress' }),
      mock.res
    );

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('SWPROJ-1');
    const ids = body.items.map((i) => i['id'] as string);
    expect(ids).not.toContain('JSMP-1');
  });

  it('JSM exclusion is preserved under multi-facet AND filter', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status, priority)
       VALUES (?, ?, 'Issue', 'SWPROJ-1', 'SWPROJ-1', 'SW issue', 'unchanged', ?, 'In Progress', 'High')`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status, priority)
       VALUES (?, ?, 'Issue', 'JSMP-2', 'JSMP-2', 'JSM issue', 'unchanged', ?, 'In Progress', 'High')`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({
        connectionId: FACET_CONN_ID,
        backupPointId: FACET_BP_ID,
        status: 'In Progress',
        priority: 'High',
      }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('JSM exclusion works when no facet filters are applied', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', 'SWPROJ-1', 'SWPROJ-1', 'unchanged', ?)`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Issue', 'JSMP-3', 'JSMP-3', 'unchanged', ?)`
    ).run(FACET_CONN_ID, FACET_BP_ID, FACET_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      makeFacetReq({ connectionId: FACET_CONN_ID, backupPointId: FACET_BP_ID }),
      mock.res
    );

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });
});

// ===========================================================================
// Search query (q) — Issue key exact-match and summary tokenized search
// ===========================================================================

const SEARCH_CONN_ID = 'search-conn-001';
const SEARCH_CLOUD_ID = 'cloud-search-001';
const SEARCH_BP_ID = 'bp-search-001';
const SEARCH_CAPTURED_AT = '2026-05-04T10:00:00.000Z';

function seedSearchConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(SEARCH_CONN_ID, SEARCH_CLOUD_ID, 'Search Test Site', now, now);
}

function seedSearchManifest(db: Database.Database): void {
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(SEARCH_BP_ID, SEARCH_CONN_ID, SEARCH_CLOUD_ID, SEARCH_CAPTURED_AT, '{}');
}

function seedSearchIssue(db: Database.Database, itemId: string, summary: string): void {
  db.prepare(
    `INSERT INTO backup_point_items
       (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt)
     VALUES (?, ?, 'Issue', ?, ?, ?, 'unchanged', ?)`
  ).run(SEARCH_CONN_ID, SEARCH_BP_ID, itemId, itemId, summary, SEARCH_CAPTURED_AT);
}

function makeSearchReq(q: string | undefined, extra: Record<string, string> = {}): Request {
  const query: Record<string, string> = {
    connectionId: SEARCH_CONN_ID,
    backupPointId: SEARCH_BP_ID,
    ...extra,
  };
  if (q !== undefined) query['q'] = q;
  return { params: { type: 'Issue' }, query } as unknown as Request;
}

describe('GET /api/inventory/Issue — search query (q)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    seedSearchConnection(db);
    seedSearchManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('issue key exact-match returns exactly 1 result', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');
    seedSearchIssue(db, 'PROJ-2', 'Add retry logic');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq('PROJ-1'), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('issue key exact-match returns 0 results when the key does not exist', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq('PROJ-99'), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(0);
  });

  it('single-token case-insensitive summary search returns matching issues', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the Login bug');
    seedSearchIssue(db, 'PROJ-2', 'Add retry logic');
    seedSearchIssue(db, 'PROJ-3', 'LOGIN page error');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq('login'), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
    const ids = body.items.map((i) => i['id'] as string);
    expect(ids).toContain('PROJ-1');
    expect(ids).toContain('PROJ-3');
    expect(ids).not.toContain('PROJ-2');
  });

  it('multi-token summary search applies AND across tokens', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');     // has both "login" and "bug" → match
    seedSearchIssue(db, 'PROJ-2', 'Login page refactor');   // has "login" but not "bug" → no match
    seedSearchIssue(db, 'PROJ-3', 'Null pointer bug');      // has "bug" but not "login" → no match

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq('login bug'), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('does NOT match a token present only in ADF description body (body-content search is disabled)', () => {
    // The token below would appear in the ADF description/comments but is absent from
    // the summary column. backup_point_items stores only summary, not ADF body content,
    // so searching this token must return zero results — proving body-content search
    // is disabled by design.
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq('ZX9_DESCRIPTION_ONLY_TOKEN'), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(0);
  });

  it('empty q string returns the unfiltered list with 200', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');
    seedSearchIssue(db, 'PROJ-2', 'Add retry logic');
    seedSearchIssue(db, 'PROJ-3', 'Update dependencies');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq(''), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(3);
  });

  it('absent q returns the unfiltered list with 200', () => {
    seedSearchIssue(db, 'PROJ-1', 'Fix the login bug');
    seedSearchIssue(db, 'PROJ-2', 'Add retry logic');

    const mock = makeRes();
    handleGetInventoryByType(makeSearchReq(undefined), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });

  it('summary search combined with status facet returns only the intersection', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status)
       VALUES (?, ?, 'Issue', 'PROJ-1', 'PROJ-1', 'Fix the login bug', 'unchanged', ?, 'In Progress')`
    ).run(SEARCH_CONN_ID, SEARCH_BP_ID, SEARCH_CAPTURED_AT);

    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status)
       VALUES (?, ?, 'Issue', 'PROJ-2', 'PROJ-2', 'Login page refactor', 'unchanged', ?, 'Done')`
    ).run(SEARCH_CONN_ID, SEARCH_BP_ID, SEARCH_CAPTURED_AT);

    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, summary,
          changeBadge, capturedAt, status)
       VALUES (?, ?, 'Issue', 'PROJ-3', 'PROJ-3', 'Add retry logic', 'unchanged', ?, 'In Progress')`
    ).run(SEARCH_CONN_ID, SEARCH_BP_ID, SEARCH_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      {
        params: { type: 'Issue' },
        query: {
          connectionId: SEARCH_CONN_ID,
          backupPointId: SEARCH_BP_ID,
          q: 'login',
          status: 'In Progress',
        },
      } as unknown as Request,
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('q does not apply to non-Issue types (Project listing ignores q)', () => {
    db.prepare(
      `INSERT INTO backup_point_items
         (connectionId, backupPointId, objectType, itemId, displayName, changeBadge, capturedAt)
       VALUES (?, ?, 'Project', 'proj-abc', 'ABC', 'unchanged', ?)`
    ).run(SEARCH_CONN_ID, SEARCH_BP_ID, SEARCH_CAPTURED_AT);

    const mock = makeRes();
    handleGetInventoryByType(
      {
        params: { type: 'Project' },
        query: { connectionId: SEARCH_CONN_ID, backupPointId: SEARCH_BP_ID, q: 'nomatch' },
      } as unknown as Request,
      mock.res
    );

    // q is ignored for Project type — all project items are returned
    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });
});

// ===========================================================================
// Attachment filename search — GET /api/inventory/Issue
// ===========================================================================

const ATTACH_CONN_ID = 'attach-conn-001';
const ATTACH_CLOUD_ID = 'cloud-attach-001';
const ATTACH_BP_ID = 'bp-attach-001';
const ATTACH_CAPTURED_AT = '2026-05-04T10:00:00.000Z';

function createTestDbWithAttachments(): Database.Database {
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
    CREATE TABLE backup_manifests (
      id           TEXT    PRIMARY KEY,
      connectionId TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      cloudId      TEXT    NOT NULL,
      createdAt    TEXT    NOT NULL,
      manifestJson TEXT    NOT NULL
    );
    CREATE TABLE backup_point_items (
      rowId         INTEGER PRIMARY KEY AUTOINCREMENT,
      connectionId  TEXT    NOT NULL,
      backupPointId TEXT    NOT NULL,
      objectType    TEXT    NOT NULL CHECK (objectType IN ('Issue', 'Project', 'Board', 'Sprint')),
      itemId        TEXT    NOT NULL,
      displayName   TEXT    NOT NULL,
      summary       TEXT,
      changeBadge   TEXT    NOT NULL DEFAULT 'unchanged' CHECK (changeBadge IN ('added', 'modified', 'deleted', 'unchanged')),
      capturedAt    TEXT    NOT NULL,
      status        TEXT,
      issueType     TEXT,
      assignee      TEXT,
      priority      TEXT,
      updatedAt     TEXT,
      sprintId      TEXT,
      boardId       TEXT,
      labels        TEXT,
      attachments   TEXT,
      FOREIGN KEY (connectionId) REFERENCES connections(connectionId) ON DELETE CASCADE,
      FOREIGN KEY (backupPointId) REFERENCES backup_manifests(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bpi_unique
      ON backup_point_items(backupPointId, objectType, itemId);
    CREATE INDEX IF NOT EXISTS idx_bpi_lookup
      ON backup_point_items(connectionId, backupPointId, objectType);
  `);
  return db;
}

function seedAttachConnection(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'active', ?, ?)`
  ).run(ATTACH_CONN_ID, ATTACH_CLOUD_ID, 'Attach Test Site', now, now);
}

function seedAttachManifest(db: Database.Database): void {
  db.prepare(
    `INSERT INTO backup_manifests (id, connectionId, cloudId, createdAt, manifestJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ATTACH_BP_ID, ATTACH_CONN_ID, ATTACH_CLOUD_ID, ATTACH_CAPTURED_AT, '{}');
}

function seedAttachIssue(db: Database.Database, itemId: string, attachments: string[] | null): void {
  db.prepare(
    `INSERT INTO backup_point_items
       (connectionId, backupPointId, objectType, itemId, displayName, summary, changeBadge, capturedAt, attachments)
     VALUES (?, ?, 'Issue', ?, ?, ?, 'unchanged', ?, ?)`
  ).run(
    ATTACH_CONN_ID,
    ATTACH_BP_ID,
    itemId,
    itemId,
    `Summary for ${itemId}`,
    ATTACH_CAPTURED_AT,
    attachments ? JSON.stringify(attachments) : null,
  );
}

function makeAttachReq(attachmentFilename: string | undefined, extra: Record<string, string> = {}): Request {
  const query: Record<string, string> = {
    connectionId: ATTACH_CONN_ID,
    backupPointId: ATTACH_BP_ID,
    ...extra,
  };
  if (attachmentFilename !== undefined) query['attachmentFilename'] = attachmentFilename;
  return { params: { type: 'Issue' }, query } as unknown as Request;
}

describe('GET /api/inventory/Issue — attachment filename search', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDbWithAttachments();
    _setDbForTesting(db);
    seedAttachConnection(db);
    seedAttachManifest(db);
  });

  afterEach(() => {
    _resetDb();
  });

  it('happy path: single token matches issue with a matching attachment filename', () => {
    seedAttachIssue(db, 'PROJ-1', ['report.pdf', 'screenshot.png']);
    seedAttachIssue(db, 'PROJ-2', ['notes.txt']);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq('report'), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('partial-match: token matches as substring within filename', () => {
    seedAttachIssue(db, 'PROJ-1', ['project_budget_2026.xlsx']);
    seedAttachIssue(db, 'PROJ-2', ['unrelated.csv']);

    const mock = makeRes();
    // "budget" is a substring of "project_budget_2026.xlsx"
    handleGetInventoryByType(makeAttachReq('budget'), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('negative: issue with no attachments (null) does not match any filename search', () => {
    seedAttachIssue(db, 'PROJ-1', null); // no attachments
    seedAttachIssue(db, 'PROJ-2', ['report.pdf']);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq('report'), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-2');
    const ids = body.items.map((i) => i['id'] as string);
    expect(ids).not.toContain('PROJ-1');
  });

  it('case-insensitive: uppercase token matches lowercase filename', () => {
    seedAttachIssue(db, 'PROJ-1', ['screenshot.png']);
    seedAttachIssue(db, 'PROJ-2', ['notes.txt']);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq('SCREENSHOT'), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('AND across tokens: issue matches only when one attachment contains all tokens', () => {
    // PROJ-1 has a file matching both "budget" and "2026" in the same filename
    seedAttachIssue(db, 'PROJ-1', ['budget_report_2026.xlsx']);
    // PROJ-2 has one file with "budget" and another with "2026" but no single file has both
    seedAttachIssue(db, 'PROJ-2', ['budget_draft.xlsx', 'report_2026.pdf']);
    // PROJ-3 only has "budget"
    seedAttachIssue(db, 'PROJ-3', ['budget_only.xlsx']);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq('budget 2026'), mock.res);

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('issue matches when any one of multiple attachments satisfies all tokens', () => {
    // PROJ-1 has two attachments; the second one matches
    seedAttachIssue(db, 'PROJ-1', ['unrelated.txt', 'final_report.pdf']);
    seedAttachIssue(db, 'PROJ-2', ['other.txt']);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq('final'), mock.res);

    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
  });

  it('attachmentFilename combines correctly with status facet filter (AND)', () => {
    // PROJ-1: matching attachment + correct status → match
    seedAttachIssue(db, 'PROJ-1', ['budget.pdf']);
    db.prepare(
      `UPDATE backup_point_items SET status = 'In Progress' WHERE itemId = 'PROJ-1'`
    ).run();

    // PROJ-2: matching attachment + wrong status → no match
    seedAttachIssue(db, 'PROJ-2', ['budget_v2.pdf']);
    db.prepare(
      `UPDATE backup_point_items SET status = 'Done' WHERE itemId = 'PROJ-2'`
    ).run();

    // PROJ-3: non-matching attachment + correct status → no match
    seedAttachIssue(db, 'PROJ-3', ['unrelated.txt']);
    db.prepare(
      `UPDATE backup_point_items SET status = 'In Progress' WHERE itemId = 'PROJ-3'`
    ).run();

    const mock = makeRes();
    handleGetInventoryByType(
      makeAttachReq('budget', { status: 'In Progress' }),
      mock.res
    );

    const body = mock.jsonBody() as { items: Array<Record<string, unknown>>; pagination: { total: number } };
    expect(body.pagination.total).toBe(1);
    expect(body.items[0]['id']).toBe('PROJ-1');
  });

  it('empty attachmentFilename returns the full unfiltered list', () => {
    seedAttachIssue(db, 'PROJ-1', ['report.pdf']);
    seedAttachIssue(db, 'PROJ-2', null);

    const mock = makeRes();
    handleGetInventoryByType(makeAttachReq(''), mock.res);

    expect(mock.statusCode()).toBe(200);
    const body = mock.jsonBody() as { pagination: { total: number } };
    expect(body.pagination.total).toBe(2);
  });
});
