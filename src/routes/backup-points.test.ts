import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { handleGetSdiTeaser } from './backup-points.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE backup_point_sdi_summary (
      backupPointId TEXT PRIMARY KEY,
      issueCount    INTEGER NOT NULL DEFAULT 0,
      projectCount  INTEGER NOT NULL DEFAULT 0,
      regulations   TEXT    NOT NULL DEFAULT '{}',
      createdAt     TEXT    NOT NULL
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

function makeReq(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

describe('GET /api/backup-points/:id/sdi-teaser', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
    db.close();
  });

  it('returns 404 for unknown backupPointId', () => {
    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-unknown' }), res);
    expect(statusCode()).toBe(404);
    expect((jsonBody() as { error: string }).error).toBe('not_found');
  });

  it('returns 200 with correct shape including GDPR active and PCI_DSS inactive', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bp-001', 5, 2, JSON.stringify({ gdpr: 'active', pciDss: 'inactive' }), new Date().toISOString());

    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-001' }), res);
    expect(statusCode()).toBe(200);

    const body = jsonBody() as {
      backupPointId: string;
      issueCount: number;
      projectCount: number;
      regulations: Array<{ code: string; status: string }>;
    };
    expect(body.backupPointId).toBe('bp-001');
    expect(body.issueCount).toBe(5);
    expect(body.projectCount).toBe(2);
    expect(body.regulations).toHaveLength(2);
    expect(body.regulations.find((r) => r.code === 'GDPR')?.status).toBe('active');
    expect(body.regulations.find((r) => r.code === 'PCI_DSS')?.status).toBe('inactive');
    expect(body.regulations.find((r) => r.code === 'HIPAA')).toBeUndefined();
  });

  it('returns 200 with all-zero counts and both regulations inactive when no detections', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bp-002', 0, 0, JSON.stringify({ gdpr: 'inactive', pciDss: 'inactive' }), new Date().toISOString());

    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-002' }), res);
    expect(statusCode()).toBe(200);

    const body = jsonBody() as {
      backupPointId: string;
      issueCount: number;
      projectCount: number;
      regulations: Array<{ code: string; status: string }>;
    };
    expect(body.issueCount).toBe(0);
    expect(body.projectCount).toBe(0);
    expect(body.regulations.find((r) => r.code === 'GDPR')?.status).toBe('inactive');
    expect(body.regulations.find((r) => r.code === 'PCI_DSS')?.status).toBe('inactive');
    expect(body.regulations.find((r) => r.code === 'HIPAA')).toBeUndefined();
  });

  it('regulations array contains exactly GDPR and PCI_DSS — never HIPAA', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bp-003', 3, 1, JSON.stringify({ gdpr: 'active', pciDss: 'active' }), new Date().toISOString());

    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-003' }), res);
    expect(statusCode()).toBe(200);

    const body = jsonBody() as { regulations: Array<{ code: string; status: string }> };
    const codes = body.regulations.map((r) => r.code);
    expect(codes).toContain('GDPR');
    expect(codes).toContain('PCI_DSS');
    expect(codes).not.toContain('HIPAA');
    expect(codes).toHaveLength(2);
  });
});
