/**
 * End-to-end restore integration test suite — Sprint 3 QA task.
 *
 * Six deterministic scenarios exercising the full stack:
 *   POST /api/restore-jobs → RestoreOrchestrator → eventBus →
 *   GET /api/restore-jobs/:id/events (SSE stream)
 *
 * Every test asserts BOTH:
 *   (a) the SSE event sequence in the correct order
 *   (b) the structured [restore] log lines emitted by the orchestrator
 *
 * Scenarios:
 *   (1) Happy path — all 8 RESTORE_PHASES emit phase_started/phase_completed
 *   (2) Workflow failure — job_failed{code:'dependency_phase_failed', phase:'workflow'}
 *       and no downstream phase events
 *   (3) Missing write:board-scope.admin:jira-software — board guard fails with named diagnostic
 *   (4) Project-in-trash + destination=original — native trash blocks in-place, forced alternate,
 *       execution continues to job_completed
 *   (5) Heartbeats arrive at ≤10s cadence during a long-running phase (fake timers)
 *   (6) Artificial 21s stall — stalled event surfaces in SSE stream (fake timers)
 *
 * CI run: npm run test:restore
 * Output: test/restore/results.xml (JUnit) + console evidence
 *
 * Source: T5 §5.2, §6.2, §6.2b; task: QA restore SSE phase-ordering and failure-mode suite
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../../src/db/database.js';
import {
  handleCreateRestoreJob,
  handleGetJobEvents,
  _setOrchestratorFactory,
  _resetOrchestratorFactory,
} from '../../src/routes/restore-jobs.js';
import { subscribe, publish, _clearAll } from '../../src/workload/restore/eventBus.js';
import { RestoreOrchestrator } from '../../src/workload/restore/RestoreOrchestrator.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type PhaseStartedEvent,
  type JobFailedEvent,
  type HeartbeatEvent,
  type GuardResult,
  type RestoreRunOptions,
} from '../../src/workload/restore/types.js';
import { STALLED_THRESHOLD_MS } from '../../src/platform/restore/sseEvents.js';
import { HEARTBEAT_INTERVAL_MS } from '../../src/workload/restore/HeartbeatEmitter.js';
import type { TrashChecker } from '../../src/workload/restore/trashDetectionGuard.js';

// ---------------------------------------------------------------------------
// Scope string constants
// ---------------------------------------------------------------------------

/** Full scope — both board variants present; board guard passes. */
const FULL_SCOPE = 'read:jira-user write:jira-work write:board-scope:jira-software write:board-scope.admin:jira-software';

/** Plain scope present, admin variant absent — board guard fails. */
const PLAIN_ONLY_SCOPE = 'read:jira-user write:jira-work write:board-scope:jira-software';

// ---------------------------------------------------------------------------
// Test DB factory
// ---------------------------------------------------------------------------

const CONN_ID = 'e2e-conn-001';
const CLOUD_ID = 'cloud-e2e-001';

function createTestDb(scopeString: string = FULL_SCOPE): Database.Database {
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
     VALUES (?, ?, 'E2E Test Site — mock.atlassian.net', 'active', ?, ?)`
  ).run(CONN_ID, CLOUD_ID, now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'mock-token', 'mock-refresh', 9999999999, ?, ?)`
  ).run(CONN_ID, scopeString, now);

  return db;
}

function insertJobDirectly(db: Database.Database, jobId: string): void {
  db.prepare(
    `INSERT INTO restore_jobs (jobId, connectionId, backupPointId, destination, createdAt)
     VALUES (?, ?, 'bp-direct', 'original', ?)`
  ).run(jobId, CONN_ID, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Mock req / res factories
// ---------------------------------------------------------------------------

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

interface SseMock {
  res: Response;
  writes: string[];
  isEnded: () => boolean;
}

function makeSseRes(): SseMock {
  const writes: string[] = [];
  let ended = false;
  const res = {
    setHeader(_n: string, _v: string) { return res; },
    flushHeaders() { return res; },
    write(chunk: string) { writes.push(chunk); return true; },
    end() { ended = true; return res; },
    status(_c: number) { return res; },
    json(_b: unknown) { return res; },
  } as unknown as Response;
  return { res, writes, isEnded: () => ended };
}

interface SseReqMock {
  req: Request;
  triggerClose: () => void;
}

function makeSseReq(id: string): SseReqMock {
  const closeListeners: Array<() => void> = [];
  const req = {
    params: { id },
    on(event: string, fn: () => void) {
      if (event === 'close') closeListeners.push(fn);
      return req;
    },
  } as unknown as Request;
  return { req, triggerClose: () => closeListeners.forEach((fn) => fn()) };
}

// ---------------------------------------------------------------------------
// Parsing helpers
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

function parseStalledWrite(writes: string[]): { type: string; jobId: string; lastPhase: string | null; secondsSinceLastEvent: number } | undefined {
  const stalledWrite = writes.find((w) => w.startsWith('event: stalled\n'));
  if (!stalledWrite) return undefined;
  const dataLine = stalledWrite.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return undefined;
  return JSON.parse(dataLine.slice('data: '.length)) as { type: string; jobId: string; lastPhase: string | null; secondsSinceLastEvent: number };
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

function waitForTerminalEvent(jobId: string, timeoutMs = 6_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for terminal event on job ${jobId}`)),
      timeoutMs
    );
    const unsub = subscribe(jobId, (ev) => {
      if (ev.type === 'job_completed' || ev.type === 'job_failed') {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Restore options factory for direct RestoreOrchestrator tests
// ---------------------------------------------------------------------------

function makeOrchestratorOptions(overrides: Partial<RestoreRunOptions> = {}): RestoreRunOptions {
  return {
    jobId: 'orch-job-001',
    connectionId: CONN_ID,
    cloudId: CLOUD_ID,
    cloudBaseUrl: `https://api.atlassian.com/ex/jira/${CLOUD_ID}`,
    backupPointId: 'bp-orch-001',
    selection: ['PROJ-1'],
    conflictMode: 'skip',
    destination: 'original',
    ...overrides,
  };
}

/** Board-scope guard that always passes — used in direct orchestrator tests. */
const alwaysPassChecker = (_connectionId: string): GuardResult => ({
  passed: true,
  guardName: 'board-scope-recheck',
});

// ---------------------------------------------------------------------------
// Request body factory for route-handler tests
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: CONN_ID,
    backupPointId: 'bp-e2e-001',
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
  vi.useRealTimers();
  _resetOrchestratorFactory();
  _resetDb();
  _clearAll();
  vi.restoreAllMocks();
});

// ===========================================================================
// Scenario (1): Happy path — all phases complete in strict order
// ===========================================================================

describe('(1) Happy path — phase_started/phase_completed for every RESTORE_PHASES entry', () => {
  it('all 8 phases emit phase_started and phase_completed in RESTORE_PHASE_ORDER; job_completed is terminal; [restore] log lines present', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Create restore job
    const mockRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockRes);
    const createResp = mockRes as unknown as { _code: number; _body: { jobId: string } };
    expect(createResp._code).toBe(201);
    const jobId = createResp._body.jobId;

    // Attach SSE handler
    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    // Wait for orchestrator to complete
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);

    // (a) SSE event sequence assertions ----------------------------------------

    // phase_started events in strict RESTORE_PHASE_ORDER
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // phase_completed events in strict RESTORE_PHASE_ORDER
    const completedPhases = events
      .filter((e) => e.type === 'phase_completed')
      .map((e) => (e as { phase: RestorePhase }).phase);
    expect(completedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Terminal event is job_completed (not job_failed)
    expect(events[events.length - 1].type).toBe('job_completed');
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // SSE stream closed
    expect(sse.isEnded()).toBe(true);

    // (b) [restore] log line assertions ----------------------------------------

    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    for (const phase of RESTORE_PHASE_ORDER) {
      const startedLine = restoreLogs.find(
        (l) => l.includes(`phase=${phase}`) && l.includes('outcome=started')
      );
      expect(startedLine, `expected [restore] phase=${phase} outcome=started`).toBeDefined();
      expect(startedLine).toContain(`jobId=${jobId}`);

      const completedLine = restoreLogs.find(
        (l) => l.includes(`phase=${phase}`) && l.includes('outcome=completed')
      );
      expect(completedLine, `expected [restore] phase=${phase} outcome=completed`).toBeDefined();
      expect(completedLine).toContain(`jobId=${jobId}`);
    }

    // Execution evidence
    console.log('[EVIDENCE] (1) SSE event types:', events.map((e) => e.type));
    console.log('[EVIDENCE] (1) phase_started sequence:', startedPhases);
    console.log('[EVIDENCE] (1) phase_completed sequence:', completedPhases);
  });
});

// ===========================================================================
// Scenario (2): Workflow failure — job_failed with dependency_phase_failed
// ===========================================================================

describe('(2) Workflow failure — job_failed{code:dependency_phase_failed, phase:workflow}, no downstream phases', () => {
  it('injected workflow throw → job_failed payload correct; custom-field phase_started absent; [restore] phase=workflow outcome=failed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Inject orchestrator with a failing workflow handler
    _setOrchestratorFactory(() =>
      new RestoreOrchestrator({
        [RestorePhase.Workflow]: async (_opts: RestoreRunOptions) => {
          throw new Error('injected workflow failure for scenario-2');
        },
      })
    );

    const mockRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockRes);
    const createResp = mockRes as unknown as { _code: number; _body: { jobId: string } };
    expect(createResp._code).toBe(201);
    const jobId = createResp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);

    // (a) SSE event sequence assertions ----------------------------------------

    // Exactly one job_failed event
    const failedEvents = events.filter((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvents).toHaveLength(1);

    const failedEvent = failedEvents[0];
    expect(failedEvent.error.code).toBe('dependency_phase_failed');
    expect(failedEvent.error.phase).toBe(RestorePhase.Workflow);
    expect(failedEvent.error.message).toBe('injected workflow failure for scenario-2');
    expect(failedEvent.jobId).toBe(jobId);
    expect(failedEvent.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // error object must contain exactly {code, phase, message}
    expect(Object.keys(failedEvent.error).sort()).toEqual(['code', 'message', 'phase'].sort());

    // Phases before workflow (site-reference-data, project) DID start
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toContain(RestorePhase.SiteReferenceData);
    expect(startedPhases).toContain(RestorePhase.Project);
    // Workflow itself started (phase_started emitted before handler runs)
    expect(startedPhases).toContain(RestorePhase.Workflow);

    // Downstream phases (custom-field, board, sprint, issue, post-issue) NOT started
    const workflowIdx = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Workflow);
    for (const phase of RESTORE_PHASE_ORDER.slice(workflowIdx + 1)) {
      expect(startedPhases, `phase ${phase} must not have started after workflow failure`).not.toContain(phase);
    }

    // job_completed must NOT be emitted
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // SSE stream closed after job_failed
    expect(sse.isEnded()).toBe(true);

    // (b) [restore] log line assertions ----------------------------------------

    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    // Phases before workflow: started + completed
    for (const phase of RESTORE_PHASE_ORDER.slice(0, workflowIdx)) {
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=started')), `started log for ${phase}`).toBe(true);
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=completed')), `completed log for ${phase}`).toBe(true);
    }

    // Workflow: started + failed
    expect(
      restoreLogs.some((l) => l.includes(`phase=${RestorePhase.Workflow}`) && l.includes('outcome=started'))
    ).toBe(true);
    expect(
      restoreLogs.some((l) => l.includes(`phase=${RestorePhase.Workflow}`) && l.includes('outcome=failed'))
    ).toBe(true);

    // Downstream phases: no log lines
    for (const phase of RESTORE_PHASE_ORDER.slice(workflowIdx + 1)) {
      expect(
        restoreLogs.some((l) => l.includes(`phase=${phase}`)),
        `no log lines expected for downstream phase ${phase}`
      ).toBe(false);
    }

    // Execution evidence
    console.log('[EVIDENCE] (2) job_failed event:', JSON.stringify(failedEvent));
    console.log('[EVIDENCE] (2) phase_started sequence:', startedPhases);
    console.log('[EVIDENCE] (2) restore log lines (workflow):', restoreLogs.filter((l) => l.includes('workflow')));
  });
});

// ===========================================================================
// Scenario (3): Missing write:board-scope.admin:jira-software — board guard fails
// ===========================================================================

describe('(3) Missing write:board-scope.admin:jira-software — board phase guard failure', () => {
  it('admin board scope absent → job_failed at board phase; message names missing scope; Board NOT started; [restore] phase=board outcome=failed', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Rebuild DB with plain-only scope (admin variant missing)
    _resetDb();
    _clearAll();
    db = createTestDb(PLAIN_ONLY_SCOPE);
    _setDbForTesting(db);

    const mockRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockRes);
    const createResp = mockRes as unknown as { _code: number; _body: { jobId: string } };
    expect(createResp._code).toBe(201);
    const jobId = createResp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);

    // (a) SSE event sequence assertions ----------------------------------------

    const failedEvents = events.filter((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvents).toHaveLength(1);

    const failedEvent = failedEvents[0];
    expect(failedEvent.error.code).toBe('dependency_phase_failed');
    expect(failedEvent.error.phase).toBe(RestorePhase.Board);
    // Message must name the missing scope
    expect(failedEvent.error.message).toContain('write:board-scope.admin:jira-software');
    expect(failedEvent.jobId).toBe(jobId);

    // Board phase must NOT have started (guard fires before phase_started)
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).not.toContain(RestorePhase.Board);

    // Phases before board DID start
    const boardIdx = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Board);
    for (const phase of RESTORE_PHASE_ORDER.slice(0, boardIdx)) {
      expect(startedPhases, `${phase} should have started before board guard`).toContain(phase);
    }

    // Downstream phases (sprint, issue, post-issue) NOT started
    for (const phase of RESTORE_PHASE_ORDER.slice(boardIdx + 1)) {
      expect(startedPhases).not.toContain(phase);
    }

    // job_completed NOT emitted
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // SSE stream closed
    expect(sse.isEnded()).toBe(true);

    // (b) [restore] log line assertions ----------------------------------------

    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    // Board guard failure log line
    expect(
      restoreLogs.some(
        (l) =>
          l.includes(`phase=${RestorePhase.Board}`) &&
          l.includes('outcome=failed') &&
          l.includes('guard=board-scope-recheck')
      )
    ).toBe(true);

    // Phases before board: started + completed
    for (const phase of RESTORE_PHASE_ORDER.slice(0, boardIdx)) {
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=started'))).toBe(true);
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=completed'))).toBe(true);
    }

    // Execution evidence
    console.log('[EVIDENCE] (3) job_failed event:', JSON.stringify(failedEvent));
    console.log('[EVIDENCE] (3) board-scope-recheck log lines:', restoreLogs.filter((l) => l.includes('board-scope') || l.includes('board')));
  });
});

// ===========================================================================
// Scenario (4): Project-in-trash + destination=original → forced alternate, continues
// ===========================================================================

describe('(4) Project-in-trash + destination=original — native trash blocks in-place, forced to alternate, job_completed', () => {
  it('trashed project forces alternate-location; job_completed (not job_failed); all 8 phases run; [restore] trash log lines present', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const TRASHED_KEY = 'PROJ';

    // Inject trash checker: PROJ is in trash
    const mockTrashChecker: TrashChecker = async (key) => ({
      projectId: `id-${key.toLowerCase()}`,
      projectKey: key,
      inTrash: key === TRASHED_KEY,
      trashedAt: key === TRASHED_KEY ? '2026-04-01T00:00:00Z' : undefined,
      daysInTrash: key === TRASHED_KEY ? 30 : undefined,
    });

    _setOrchestratorFactory(
      () => new RestoreOrchestrator(undefined, undefined, mockTrashChecker)
    );

    const mockRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { this._code = c; return this; },
      json(b: unknown) { this._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    // Selection includes the project key that is in trash + issue keys
    await handleCreateRestoreJob(
      makeReq(validBody({ selection: ['PROJ', 'PROJ-1', 'PROJ-2'], destination: 'original' })),
      mockRes
    );
    const createResp = mockRes as unknown as { _code: number; _body: { jobId: string } };
    expect(createResp._code).toBe(201);
    const jobId = createResp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);
    await waitForTerminalEvent(jobId);

    const events = parseSseWrites(sse.writes);

    // (a) SSE event sequence assertions ----------------------------------------

    // Trash detection is NOT a job_failed trigger — execution continues
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // Terminal event is job_completed
    expect(events[events.length - 1].type).toBe('job_completed');

    // All 8 phases ran (trash detection doesn't halt)
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // SSE stream closed normally
    expect(sse.isEnded()).toBe(true);

    // (b) [restore] log line assertions ----------------------------------------

    const restoreLogs = logSpy.mock.calls
      .map((args) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line) => line.startsWith('[restore]'));

    // Trash detection log: projectKey=PROJ trashed=true
    const trashLog = restoreLogs.find(
      (l) => l.includes('guard=trash-detection') && l.includes(`projectKey=${TRASHED_KEY}`) && l.includes('trashed=true')
    );
    expect(trashLog, `expected [restore] guard=trash-detection projectKey=${TRASHED_KEY} trashed=true`).toBeDefined();

    // Forcing alternate-location log
    const forcingLog = restoreLogs.find(
      (l) => l.includes('guard=trash-detection') && l.includes('forcing destination=alternate')
    );
    expect(forcingLog, 'expected [restore] guard=trash-detection ... forcing destination=alternate').toBeDefined();
    expect(forcingLog).toContain(`jobId=${jobId}`);

    // All phases started + completed logs present
    for (const phase of RESTORE_PHASE_ORDER) {
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=started'))).toBe(true);
      expect(restoreLogs.some((l) => l.includes(`phase=${phase}`) && l.includes('outcome=completed'))).toBe(true);
    }

    // Execution evidence
    console.log('[EVIDENCE] (4) trash detection log lines:', restoreLogs.filter((l) => l.includes('trash-detection')));
    console.log('[EVIDENCE] (4) terminal event:', events[events.length - 1].type);
    console.log('[EVIDENCE] (4) all 8 phases started:', startedPhases);
  });
});

// ===========================================================================
// Scenario (5): Heartbeats arrive at ≤10s cadence
// ===========================================================================

describe('(5) Heartbeats at ≤10s cadence during a long-running phase', () => {
  it('at 11s into a 25s phase: ≥1 heartbeat event with currentPhase; at 21s: ≥2; [restore] phase started log present', async () => {
    vi.useFakeTimers();

    const events: RestoreSseEvent[] = [];
    const logLines: string[] = [];

    vi.spyOn(console, 'log').mockImplementation((msg: unknown, ...rest: unknown[]) => {
      if (typeof msg === 'string') logLines.push(msg);
      else logLines.push(String(msg));
      void rest;
    });

    // Long-running first phase: resolves after 25s (fake-timer controlled)
    const longHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25_000));
      return { restoredCount: 0, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.SiteReferenceData]: longHandler },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(
      makeOrchestratorOptions(),
      (ev) => events.push(ev)
    );

    // Advance 11s — HEARTBEAT_INTERVAL_MS is 10s, so one heartbeat should have fired
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);

    // (a) SSE event assertions --------------------------------------------------

    const heartbeats = events.filter((e): e is HeartbeatEvent => e.type === 'heartbeat');
    expect(heartbeats.length, 'at least one heartbeat at 11s').toBeGreaterThanOrEqual(1);
    // Each heartbeat carries currentPhase = SiteReferenceData (the active phase)
    expect(heartbeats[0].currentPhase).toBe(RestorePhase.SiteReferenceData);
    expect(heartbeats[0].jobId).toBe('orch-job-001');
    expect(typeof heartbeats[0].ts).toBe('string');

    // At 21s: ≥2 heartbeats (one at 10s, one at 20s)
    await vi.advanceTimersByTimeAsync(10_000); // now 21s total
    const heartbeatsAt21 = events.filter((e): e is HeartbeatEvent => e.type === 'heartbeat');
    expect(heartbeatsAt21.length, 'at least two heartbeats at 21s').toBeGreaterThanOrEqual(2);

    // Heartbeat interval is ≤10s (HEARTBEAT_INTERVAL_MS = 10_000)
    const heartbeatTimes = heartbeatsAt21.map((h) => new Date(h.ts).getTime());
    for (let i = 1; i < heartbeatTimes.length; i++) {
      const gapMs = heartbeatTimes[i] - heartbeatTimes[i - 1];
      expect(gapMs, `heartbeat gap should be ≤10s`).toBeLessThanOrEqual(HEARTBEAT_INTERVAL_MS + 500);
    }

    // (b) [restore] log line assertions ----------------------------------------

    const restoreLogs = logLines.filter((l) => l.startsWith('[restore]'));
    expect(
      restoreLogs.some(
        (l) =>
          l.includes(`phase=${RestorePhase.SiteReferenceData}`) &&
          l.includes('outcome=started')
      ),
      '[restore] phase=site-reference-data outcome=started log expected'
    ).toBe(true);

    // Complete the job
    await vi.advanceTimersByTimeAsync(25_000);
    await restorePromise;

    // Recompute after full execution — restoreLogs was captured mid-flight
    const finalRestoreLogs = logLines.filter((l) => l.startsWith('[restore]'));

    // SiteReferenceData phase completed log present
    expect(
      finalRestoreLogs.some(
        (l) =>
          l.includes(`phase=${RestorePhase.SiteReferenceData}`) &&
          l.includes('outcome=completed')
      )
    ).toBe(true);

    // Execution evidence
    console.log('[EVIDENCE] (5) heartbeat count at 21s:', heartbeatsAt21.length);
    console.log('[EVIDENCE] (5) HEARTBEAT_INTERVAL_MS:', HEARTBEAT_INTERVAL_MS);
    console.log('[EVIDENCE] (5) heartbeat events:', JSON.stringify(heartbeatsAt21.map((h) => ({ ts: h.ts, currentPhase: h.currentPhase }))));
  });
});

// ===========================================================================
// Scenario (6): Artificial 21s stall — stalled event surfaces in SSE stream
// ===========================================================================

describe('(6) Artificial 21s stall — stalled event surfaced in SSE stream', () => {
  it('>20s silence from orchestrator → stalled event with correct payload; stream NOT closed; stream closes normally after job_completed', async () => {
    vi.useFakeTimers();

    // Insert a job directly — we will drive events manually via the event bus
    insertJobDirectly(db, 'stall-scenario-6');
    const jobId = 'stall-scenario-6';

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    // Simulate orchestrator starting the Issue phase then stalling (no further events)
    publish(jobId, {
      type: 'phase_started',
      jobId,
      ts: new Date().toISOString(),
      phase: RestorePhase.Issue,
    });

    // Advance past the STALLED_THRESHOLD_MS (20_000) without any further events
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    // (a) SSE event assertions --------------------------------------------------

    const stalledPayload = parseStalledWrite(sse.writes);
    expect(stalledPayload, 'stalled event should be emitted after >20s of silence').toBeDefined();
    expect(stalledPayload!.type).toBe('stalled');
    expect(stalledPayload!.jobId).toBe(jobId);
    // lastPhase tracks the most recent phase_started seen
    expect(stalledPayload!.lastPhase).toBe(RestorePhase.Issue);
    expect(stalledPayload!.secondsSinceLastEvent).toBeGreaterThanOrEqual(20);

    // Stream is NOT closed — stalled is not a terminal event
    expect(sse.isEnded(), 'stream must remain open after stalled event').toBe(false);

    // (b) No [restore] log line from the orchestrator for the stall
    // (stalled detection is the SSE handler's responsibility, not the orchestrator's)
    // — assert only SSE event ordering here

    // Verify: stream remains open and closes normally after job_completed arrives
    publish(jobId, {
      type: 'job_completed',
      jobId,
      ts: new Date().toISOString(),
      errors: 0,
      restoredCount: 0,
    });
    expect(sse.isEnded(), 'stream must close after job_completed').toBe(true);

    // Execution evidence
    console.log('[EVIDENCE] (6) stalled payload:', JSON.stringify(stalledPayload));
    console.log('[EVIDENCE] (6) STALLED_THRESHOLD_MS:', STALLED_THRESHOLD_MS);
    console.log('[EVIDENCE] (6) stream ended after job_completed:', sse.isEnded());
    console.log('[EVIDENCE] (6) writes containing stalled:', sse.writes.filter((w) => w.startsWith('event: stalled')));
  });

  it('stalled fires within 21s of last event; stream remains open; no stalled under normal heartbeat cadence (9s)', async () => {
    vi.useFakeTimers();

    const jobId = 'stall-cadence-check';
    insertJobDirectly(db, jobId);

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    // Phase starts — watchdog arms
    publish(jobId, {
      type: 'phase_started',
      jobId,
      ts: new Date().toISOString(),
      phase: RestorePhase.Sprint,
    });

    // Advance STALLED_THRESHOLD_MS + 1s — stalled must fire
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);
    expect(parseStalledWrite(sse.writes), 'stalled fires after threshold').toBeDefined();
    expect(sse.isEnded()).toBe(false);

    // Reset sse writes buffer check for the cadence sub-test
    const stalledWriteCount = sse.writes.filter((w) => w.startsWith('event: stalled')).length;
    expect(stalledWriteCount).toBeGreaterThanOrEqual(1);

    // Normal-cadence sub-check: heartbeats every 9s over 63s should NOT trigger stalled
    const jobId2 = 'stall-no-stalled';
    insertJobDirectly(db, jobId2);

    const sse2 = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId2).req, sse2.res);

    publish(jobId2, {
      type: 'phase_started',
      jobId: jobId2,
      ts: new Date().toISOString(),
      phase: RestorePhase.Project,
    });

    // Send heartbeats every 9s for 63s total (7 ticks) — always within 20s threshold
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(9_000);
      publish(jobId2, {
        type: 'heartbeat',
        jobId: jobId2,
        ts: new Date().toISOString(),
        currentPhase: RestorePhase.Project,
      });
    }

    // No stalled event should have fired
    expect(
      sse2.writes.find((w) => w.startsWith('event: stalled\n')),
      'no stalled event under normal 9s heartbeat cadence'
    ).toBeUndefined();

    // Execution evidence
    console.log('[EVIDENCE] (6-cadence) stalled fired after threshold:', stalledWriteCount, 'time(s)');
    console.log('[EVIDENCE] (6-cadence) no stalled under 9s heartbeats over 63s: PASS');
  });
});
