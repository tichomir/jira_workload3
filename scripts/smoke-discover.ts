#!/usr/bin/env tsx
/**
 * Discover-flow smoke probe.
 *
 * Exercises JiraWorkload.discover() end-to-end using an in-memory SQLite
 * database and a mocked Atlassian project-search API. No live Atlassian
 * credentials or running API server required.
 *
 * Usage: npx tsx scripts/smoke-discover.ts
 * Exit 0 = all assertions passed. Exit 1 = one or more assertions failed.
 */

import Database from 'better-sqlite3';
import { _setDbForTesting, _resetDb } from '../src/db/database.js';
import { JiraHttpClient } from '../src/workload/http/JiraHttpClient.js';
import { JiraWorkload } from '../src/workload/JiraWorkload.js';

const TEST_CONN_ID = `smoke-discover-${Date.now()}`;
const SMOKE_CLOUD_ID = `cloud-smoke-${Date.now()}`;

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

// ---------------------------------------------------------------------------
// In-memory database with the full schema needed by JiraWorkload.discover()
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
    CREATE TABLE backup_manifests (
      id           TEXT    PRIMARY KEY,
      connectionId TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
      cloudId      TEXT    NOT NULL,
      createdAt    TEXT    NOT NULL,
      manifestJson TEXT    NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  ).run(TEST_CONN_ID, SMOKE_CLOUD_ID, 'Smoke Test Site', now, now);

  db.prepare(
    `INSERT INTO credentials
       (connectionId, accessToken, refreshToken, expiresAt, scopes, clientId, clientSecret, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    TEST_CONN_ID,
    'smoke-access-token',
    'smoke-refresh-token',
    Math.floor(Date.now() / 1000) + 3600,
    'read:jira-work',
    'smoke-client-id',
    'smoke-client-secret',
    now
  );

  return db;
}

// ---------------------------------------------------------------------------
// Mock Atlassian project-search API
// Returns 3 software/business projects + 1 service_desk project (JSM).
// ---------------------------------------------------------------------------

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeMockAtlassianFetch(): FetchFn {
  const mockProjects = [
    { id: '10001', key: 'SMOKE1', name: 'Smoke Software 1', projectTypeKey: 'software' },
    { id: '10002', key: 'SMOKE2', name: 'Smoke Business 1', projectTypeKey: 'business' },
    { id: '10003', key: 'SMOKE3', name: 'Smoke Software 2', projectTypeKey: 'software' },
    { id: '10004', key: 'JSMPROJ', name: 'JSM Service Desk (deferred)', projectTypeKey: 'service_desk' },
  ];

  return async (url: string) => {
    if (url.includes('/rest/api/3/project/search')) {
      return new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 50,
          total: mockProjects.length,
          isLast: true,
          values: mockProjects,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    console.error(`[smoke-discover] unexpected fetch: ${url}`);
    return new Response('Not Found', { status: 404 });
  };
}

// ---------------------------------------------------------------------------
// Smoke probe execution
// ---------------------------------------------------------------------------

console.log('==> [1/4] Set up in-memory database with smoke connection');
const db = createTestDb();
_setDbForTesting(db);
JiraHttpClient._clearInstances();
JiraHttpClient._createForTesting(TEST_CONN_ID, makeMockAtlassianFetch());

console.log('==> [2/4] POST discover — projectScope=all (mock Atlassian: 3 software + 1 JSM project)');
const workload = new JiraWorkload();
const result = await workload.discover(TEST_CONN_ID, { projectScope: 'all' });
console.log(`     backupPointId=${result.backupPointId}`);
console.log(`     projectCount=${result.projectCount}  jsmDeferredCount=${result.jsmDeferredCount}`);

assert(typeof result.backupPointId === 'string' && result.backupPointId.length > 0, 'backupPointId is a non-empty string (UUID)');
assert(result.projectCount === 3, 'projectCount=3 (software + business projects; service_desk excluded)');
assert(result.jsmDeferredCount === 1, 'jsmDeferredCount=1 (one service_desk project deferred to Phase 2)');

console.log('==> [3/4] Verify backup_manifests row written to DB');
const row = db
  .prepare('SELECT id, connectionId, cloudId, manifestJson FROM backup_manifests WHERE id = ?')
  .get(result.backupPointId) as
  | { id: string; connectionId: string; cloudId: string; manifestJson: string }
  | undefined;

assert(row !== undefined, 'backup_manifests row exists for backupPointId');
assert(row!.connectionId === TEST_CONN_ID, 'manifest.connectionId matches smoke connection');
assert(row!.cloudId === SMOKE_CLOUD_ID, 'manifest.cloudId matches smoke cloudId');

const manifest = JSON.parse(row!.manifestJson) as {
  manifestId: string;
  projects: { projectKey: string }[];
  jsmDeferredProjects: { projectKey: string; reason: string }[];
  coverageInvariant: null;
};

assert(manifest.manifestId === result.backupPointId, 'manifest.manifestId matches returned backupPointId');
assert(manifest.projects.length === 3, 'manifest.projects has 3 non-JSM entries');
assert(manifest.jsmDeferredProjects.length === 1, 'manifest.jsmDeferredProjects has 1 entry');
assert(manifest.jsmDeferredProjects[0].reason === 'PHASE_2_DEFERRED', 'deferred entry reason is PHASE_2_DEFERRED');
assert(manifest.coverageInvariant === null, 'coverageInvariant is null (discover-only; snapshot not yet run)');

console.log('==> [4/4] Verify JSM project key in deferred list');
assert(
  manifest.jsmDeferredProjects[0].projectKey === 'JSMPROJ',
  'deferred project key is JSMPROJ'
);
assert(
  !manifest.projects.some(p => p.projectKey === 'JSMPROJ'),
  'JSMPROJ does not appear in manifest.projects'
);

_resetDb();
JiraHttpClient._clearInstances();

console.log('');
console.log('All discover-flow smoke checks passed.');
