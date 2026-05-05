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

  it('Project items do not include summary field', () => {
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
