/**
 * Integration tests: POST /api/restore-jobs → SSE event stream phase ordering.
 *
 * Exercises the full stack from route handler → RestoreOrchestrator → eventBus
 * → SSE handler, asserting:
 *   1. phase_started events arrive in exact RESTORE_PHASE_ORDER on success
 *   2. Fault injection into 'workflow' emits job_failed with the correct payload
 *      and downstream phases (custom-field onward) are NEVER started
 *   3. [restore] log lines are emitted for each phase transition
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import {
  handleCreateRestoreJob,
  handleGetJobEvents,
  _setOrchestratorFactory,
  _resetOrchestratorFactory,
} from './restore-jobs.js';
import { subscribe, _clearAll } from '../workload/restore/eventBus.js';
import { RestoreOrchestrator } from '../workload/restore/RestoreOrchestrator.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type PhaseStartedEvent,
  type JobFailedEvent,
  type RestoreRunOptions,
} from '../workload/restore/types.js';

// ---------------------------------------------------------------------------
// Test DB helpers
// ---------------------------------------------------------------------------

const TEST_CONN_ID = 'int-conn-001';
const TEST_CLOUD_ID = 'cloud-int-001';
const TEST_BACKUP_POINT_ID = 'bp-int-001';

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
    CREATE TABLE restore_jobs (
      jobId                TEXT    PRIMARY KEY,
      connectionId         TEXT    NOT NULL REFERENCES connections(connectionId),
      backupPointId        TEXT    NOT NULL,
      conflictMode         TEXT    NOT NULL DEFAULT 'skip'
                                   CHECK (conflictMode IN ('override', 'skip', 'ask')),
      destination          TEXT    NOT NULL
                                   CHECK (destination IN ('original', 'alternate', 'export')),
      selection            TEXT    NOT NULL DEFAULT '[]',
      alternateDestination TEXT,
      status               TEXT    NOT NULL DEFAULT 'queued',
      restoredCount        INTEGER NOT NULL DEFAULT 0,
      errorCount           INTEGER NOT NULL DEFAULT 0,
      phaseDiagnostic      TEXT,
      createdAt            TEXT    NOT NULL,
      completedAt          TEXT
    );
    CREATE TABLE credentials (
      connectionId TEXT PRIMARY KEY,
      accessToken  TEXT,
      refreshToken TEXT,
      expiresAt    INTEGER,
      scopes       TEXT,
      updatedAt    TEXT,
      clientId     TEXT,
      clientSecret TEXT
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, 'Integration Test Site', 'active', ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'test-access-token', 'test-refresh-token', 9999999999,
             'write:board-scope:jira-software write:board-scope.admin:jira-software', ?)`
  ).run(TEST_CONN_ID, now);

  return db;
}

// ---------------------------------------------------------------------------
// Mock req/res helpers
// ---------------------------------------------------------------------------

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

interface SseMockRes {
  res: Response;
  writes: string[];
  isEnded: () => boolean;
}

function makeSseRes(): SseMockRes {
  const writes: string[] = [];
  let ended = false;

  const res = {
    setHeader(_name: string, _value: string) { return res; },
    flushHeaders() { return res; },
    write(chunk: string) { writes.push(chunk); return true; },
    end() { ended = true; return res; },
    status(_c: number) { return res; },
    json(_body: unknown) { return res; },
  } as unknown as Response;

  return { res, writes, isEnded: () => ended };
}

function makeSseReq(id: string): Request {
  return {
    params: { id },
    on(_event: string, _fn: () => void) { return this; },
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// SSE parse helper
// ---------------------------------------------------------------------------

function parseSseWrites(writes: string[]): RestoreSseEvent[] {
  const events: RestoreSseEvent[] = [];
  for (const w of writes) {
    const dataLine = w.split('\n').find((l) => l.startsWith('data: '));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice('data: '.length)) as RestoreSseEvent);
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Wait for terminal event via eventBus subscription
// ---------------------------------------------------------------------------

function waitForTerminalEvent(jobId: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for terminal event on job ${jobId}`)),
      timeoutMs
    );

    const unsub = subscribe(jobId, (event) => {
      if (event.type === 'job_completed' || event.type === 'job_failed') {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Valid request body factory
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: TEST_CONN_ID,
    backupPointId: TEST_BACKUP_POINT_ID,
    conflictMode: 'skip',
    destination: 'original',
    selection: ['PROJ-1'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _setDbForTesting(db);
  _clearAll();
});

afterEach(() => {
  _resetOrchestratorFactory();
  _resetDb();
  _clearAll();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('restore job integration — phase ordering and fault injection', () => {
  it('(1) phase_started events arrive in exact RESTORE_PHASE_ORDER for a successful run', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Create restore job via the route handler
    let jobId: string;
    {
      const mockRes = {
        _code: 200,
        _body: undefined as unknown,
        status(c: number) { this._code = c; return this; },
        json(b: unknown) { this._body = b; return this; },
      } as unknown as Response;
      await handleCreateRestoreJob(makeReq(validBody()), mockRes);
      const resp = mockRes as unknown as { _code: number; _body: { jobId: string; status: string } };
      expect(resp._code).toBe(201);
      jobId = resp._body.jobId;
    }

    // Attach SSE handler BEFORE waiting, so events are not missed
    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);

    // Wait for orchestrator to finish
    await waitForTerminalEvent(jobId);

    // (3) Assert exact phase_started order
    const events = parseSseWrites(sse.writes);
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);

    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Verify all 8 phases completed
    const completedPhases = events
      .filter((e) => e.type === 'phase_completed')
      .map((e) => (e as { phase: RestorePhase }).phase);
    expect(completedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Last data event is job_completed
    const dataEvents = parseSseWrites(sse.writes);
    expect(dataEvents[dataEvents.length - 1].type).toBe('job_completed');
    expect(sse.isEnded()).toBe(true);

    // (5) Assert [restore] log lines for every phase transition (started + completed)
    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    for (const phase of RESTORE_PHASE_ORDER) {
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=start'))
      ).toBe(true);
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=complete'))
      ).toBe(true);
    }
  });

  it('(2+4) fault injection into workflow phase: job_failed is emitted with correct payload; custom-field phase_started is NEVER seen', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Inject a failing workflow handler via the factory
    _setOrchestratorFactory(() =>
      new RestoreOrchestrator({
        [RestorePhase.Workflow]: async (_opts: RestoreRunOptions) => {
          throw new Error('injected workflow failure');
        },
      })
    );

    // Create restore job via the route handler
    let jobId: string;
    {
      const mockRes = {
        _code: 200,
        _body: undefined as unknown,
        status(c: number) { this._code = c; return this; },
        json(b: unknown) { this._body = b; return this; },
      } as unknown as Response;
      await handleCreateRestoreJob(makeReq(validBody()), mockRes);
      const resp = mockRes as unknown as { _code: number; _body: { jobId: string; status: string } };
      expect(resp._code).toBe(201);
      jobId = resp._body.jobId;
    }

    // Attach SSE handler
    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);

    // Wait for the terminal event (job_failed)
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);

    // job_failed must be emitted
    const failedEvents = events.filter((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvents).toHaveLength(1);

    // Exact error payload shape
    const failedEvent = failedEvents[0];
    expect(failedEvent.error.code).toBe('dependency_phase_failed');
    expect(failedEvent.error.phase).toBe(RestorePhase.Workflow);
    expect(typeof failedEvent.error.message).toBe('string');
    expect(failedEvent.error.message).toBe('injected workflow failure');
    expect(failedEvent.jobId).toBe(jobId);
    expect(typeof failedEvent.ts).toBe('string');

    // custom-field phase_started MUST NOT appear
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).not.toContain(RestorePhase.CustomField);

    // No downstream phases after workflow should have started
    const workflowIndex = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Workflow);
    const downstreamPhases = RESTORE_PHASE_ORDER.slice(workflowIndex + 1);
    for (const phase of downstreamPhases) {
      expect(startedPhases).not.toContain(phase);
    }

    // Phases before and including workflow did start
    expect(startedPhases).toContain(RestorePhase.SiteReferenceData);
    expect(startedPhases).toContain(RestorePhase.Project);
    expect(startedPhases).toContain(RestorePhase.Workflow);

    // job_completed must NOT be emitted (job_failed is terminal)
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // Stream is closed after job_failed
    expect(sse.isEnded()).toBe(true);

    // (5) [restore] log lines: started for phases up to workflow, failed for workflow
    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    // Phases before workflow: started + completed
    const phasesBefore = RESTORE_PHASE_ORDER.slice(0, workflowIndex);
    for (const phase of phasesBefore) {
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=start'))
      ).toBe(true);
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=complete'))
      ).toBe(true);
    }

    // Workflow: started + failed
    expect(
      restoreLogs.some((l) => l.includes(`phase=${RestorePhase.Workflow}`) && l.includes('outcome=start'))
    ).toBe(true);
    expect(
      restoreLogs.some((l) => l.includes(`phase=${RestorePhase.Workflow}`) && l.includes('outcome=fail'))
    ).toBe(true);

    // Downstream phases: no log lines at all
    for (const phase of downstreamPhases) {
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`))
      ).toBe(false);
    }
  });

  it('(3) job_failed payload shape matches spec exactly', async () => {
    _setOrchestratorFactory(() =>
      new RestoreOrchestrator({
        [RestorePhase.Workflow]: async () => {
          throw new Error('spec-check failure');
        },
      })
    );

    const mockRes = {
      _code: 200,
      _body: undefined as unknown,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b; return this; },
    } as unknown as Response;
    await handleCreateRestoreJob(makeReq(validBody()), mockRes);
    const resp = mockRes as unknown as { _code: number; _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);
    const failedEvent = events.find((e): e is JobFailedEvent => e.type === 'job_failed');

    expect(failedEvent).toBeDefined();
    // Exact required shape from T5 §5.2
    expect(failedEvent!.type).toBe('job_failed');
    expect(failedEvent!.jobId).toBe(jobId);
    expect(failedEvent!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
    expect(failedEvent!.error).toMatchObject({
      code: 'dependency_phase_failed',
      phase: RestorePhase.Workflow,
      message: 'spec-check failure',
    });
    // Ensure no extra undocumented fields on error object
    expect(Object.keys(failedEvent!.error)).toEqual(['code', 'phase', 'message']);
  });

  it('(5) [restore] log lines are emitted for every started transition on a full successful run', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const mockRes = {
      _code: 200,
      _body: undefined as unknown,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b; return this; },
    } as unknown as Response;
    await handleCreateRestoreJob(makeReq(validBody()), mockRes);
    const resp = mockRes as unknown as { _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminalEvent(jobId);

    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    // Every phase must have both a 'started' and a 'completed' log line
    for (const phase of RESTORE_PHASE_ORDER) {
      const startedLine = restoreLogs.find(
        (l) => l.includes(`phase=${phase}`) && l.includes('outcome=start')
      );
      expect(startedLine, `expected [restore] started log for phase=${phase}`).toBeDefined();
      expect(startedLine).toContain(`jobId=${jobId}`);

      const completedLine = restoreLogs.find(
        (l) => l.includes(`phase=${phase}`) && l.includes('outcome=complete')
      );
      expect(completedLine, `expected [restore] completed log for phase=${phase}`).toBeDefined();
      expect(completedLine).toContain(`jobId=${jobId}`);
    }
  });
});
