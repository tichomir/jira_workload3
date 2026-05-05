/**
 * Fault-injection test harness: heartbeat + stalled-alert telemetry.
 *
 * Validates all four telemetry assertions:
 *   (1) Restore path: worker pauses >20s → stalled SSE event fires; stream stays open
 *   (2) Restore path: heartbeat resumption after stall → no further stalled events
 *   (3) Backup path: complete(N) → status='completed_with_errors'; errorsCount = N
 *   (4) Restore path: per-phase errorCount > 0 → job_completed.errors matches total
 *
 * Test both backup and restore paths as required by Sprint 16 QA acceptance criteria.
 *
 * Source: T5 §6.2, T5 §6.2b; Sprint 16 QA task.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../../src/db/database.js';
import {
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
  type HeartbeatEvent,
  type JobCompletedEvent,
  type GuardResult,
  type RestoreRunOptions,
} from '../../src/workload/restore/types.js';
import { STALLED_THRESHOLD_MS } from '../../src/platform/restore/sseEvents.js';
import { HEARTBEAT_INTERVAL_MS } from '../../src/workload/restore/HeartbeatEmitter.js';
import { ProgressEmitter } from '../../src/workload/snapshot/ProgressEmitter.js';
import { STALLED_THRESHOLD_MS as BACKUP_STALLED_THRESHOLD_MS } from '../../src/workload/types/ProgressEvent.js';
import type { CaptureProgressEvent } from '../../src/workload/backup/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONN_ID = 'fi-conn-001';
const CLOUD_ID = 'cloud-fi-001';

// ---------------------------------------------------------------------------
// DB factories
// ---------------------------------------------------------------------------

function createRestoreTestDb(): Database.Database {
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
     VALUES (?, ?, 'FI Test Site', 'active', ?, ?)`
  ).run(CONN_ID, CLOUD_ID, now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'fi-token', 'fi-refresh', 9999999999,
             'read:jira-user write:jira-work write:board-scope:jira-software write:board-scope.admin:jira-software', ?)`
  ).run(CONN_ID, now);

  return db;
}

function createBackupTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE backup_jobs (
      jobId        TEXT    PRIMARY KEY,
      manifestId   TEXT    NOT NULL,
      connectionId TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending',
      createdAt    TEXT    NOT NULL,
      updatedAt    TEXT    NOT NULL,
      lastEventTs  TEXT,
      errorsCount  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE backup_job_events (
      id          TEXT    PRIMARY KEY,
      jobId       TEXT    NOT NULL REFERENCES backup_jobs(jobId) ON DELETE CASCADE,
      ts          TEXT    NOT NULL,
      phase       TEXT    NOT NULL,
      processed   INTEGER NOT NULL,
      total       INTEGER,
      errorsCount INTEGER NOT NULL DEFAULT 0,
      eventJson   TEXT    NOT NULL
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function insertRestoreJobDirectly(db: Database.Database, jobId: string): void {
  db.prepare(
    `INSERT INTO restore_jobs (jobId, connectionId, backupPointId, destination, createdAt)
     VALUES (?, ?, 'bp-fi', 'original', ?)`
  ).run(jobId, CONN_ID, new Date().toISOString());
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

function makeSseReq(jobId: string): SseReqMock {
  const closeListeners: Array<() => void> = [];
  const req = {
    params: { id: jobId },
    on(event: string, fn: () => void) {
      if (event === 'close') closeListeners.push(fn);
      return req;
    },
  } as unknown as Request;
  return { req, triggerClose: () => closeListeners.forEach((fn) => fn()) };
}

function parseStalledPayload(writes: string[]): Array<{
  type: string;
  jobId: string;
  lastPhase: string | null;
  secondsSinceLastEvent: number;
}> {
  return writes
    .filter((w) => w.startsWith('event: stalled\n'))
    .map((w) => {
      const dataLine = w.split('\n').find((l) => l.startsWith('data: '));
      return JSON.parse(dataLine!.slice('data: '.length)) as {
        type: string;
        jobId: string;
        lastPhase: string | null;
        secondsSinceLastEvent: number;
      };
    });
}

function parseSseEvents(writes: string[]): RestoreSseEvent[] {
  const events: RestoreSseEvent[] = [];
  for (const w of writes) {
    const dataLine = w.split('\n').find((l) => l.startsWith('data: '));
    if (dataLine) {
      events.push(JSON.parse(dataLine.slice('data: '.length)) as RestoreSseEvent);
    }
  }
  return events;
}

function captureEvent(phase: string, captured = 1, total = 5): CaptureProgressEvent {
  return {
    phase: phase as CaptureProgressEvent['phase'],
    itemsCaptured: captured,
    itemsTotal: total,
    elapsedMs: 100,
  };
}

function getBackupJob(db: Database.Database, jobId: string) {
  return db
    .prepare('SELECT * FROM backup_jobs WHERE jobId = ?')
    .get(jobId) as {
      jobId: string;
      status: string;
      errorsCount: number;
    } | undefined;
}

const alwaysPassChecker = (_connectionId: string): GuardResult => ({
  passed: true,
  guardName: 'board-scope-recheck',
});

function makeOrchestratorOptions(jobId: string): RestoreRunOptions {
  return {
    jobId,
    connectionId: CONN_ID,
    cloudId: CLOUD_ID,
    cloudBaseUrl: `https://api.atlassian.com/ex/jira/${CLOUD_ID}`,
    backupPointId: 'bp-fi-001',
    selection: ['PROJ-1'],
    conflictMode: 'skip',
    destination: 'original',
  };
}

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

let restoreDb: Database.Database;

beforeEach(() => {
  restoreDb = createRestoreTestDb();
  _setDbForTesting(restoreDb);
  _clearAll();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetOrchestratorFactory();
  _resetDb();
  _clearAll();
});

// ===========================================================================
// (1) Restore path — fault injection: worker pauses >20s → stalled SSE event
// ===========================================================================

describe('(1) Restore path — stalled-alert via fault injection (worker pauses >20s)', () => {
  it('publishing phase_started then pausing >20s → stalled SSE event fires; payload correct; stream stays open', async () => {
    vi.useFakeTimers();

    const jobId = 'fi-stall-restore-001';
    insertRestoreJobDirectly(restoreDb, jobId);

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    // Simulate orchestrator starting the Issue phase then stalling (no further events)
    publish(jobId, {
      type: 'phase_started',
      jobId,
      ts: new Date().toISOString(),
      phase: RestorePhase.Issue,
    });

    // Advance past STALLED_THRESHOLD_MS (20s) without any further events
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    // (a) Stalled SSE event must have fired
    const stalledPayloads = parseStalledPayload(sse.writes);
    expect(stalledPayloads.length, '[ASSERTION-1] stalled event must fire after >20s silence').toBeGreaterThanOrEqual(1);

    const stalled = stalledPayloads[0];
    expect(stalled.type).toBe('stalled');
    expect(stalled.jobId).toBe(jobId);
    expect(stalled.lastPhase, '[ASSERTION-1] lastPhase tracks most-recent phase_started').toBe(RestorePhase.Issue);
    expect(stalled.secondsSinceLastEvent, '[ASSERTION-1] secondsSinceLastEvent ≥ 20').toBeGreaterThanOrEqual(20);

    // (b) Stream is NOT closed — stalled is not a terminal event
    expect(sse.isEnded(), '[ASSERTION-1] stream must remain open after stalled').toBe(false);

    // Close the stream via job_completed
    publish(jobId, {
      type: 'job_completed',
      jobId,
      ts: new Date().toISOString(),
      errors: 0,
      restoredCount: 0,
    });
    expect(sse.isEnded(), '[ASSERTION-1] stream closes after job_completed').toBe(true);

    // Execution evidence
    console.log('[EVIDENCE] (1) stalled payload:', JSON.stringify(stalled));
    console.log('[EVIDENCE] (1) STALLED_THRESHOLD_MS:', STALLED_THRESHOLD_MS);
    console.log('[EVIDENCE] (1) stalled event count:', stalledPayloads.length);
    console.log('[EVIDENCE] (1) stream ended after job_completed:', sse.isEnded());
  });

  it('orchestrator long-running handler (25s) → HeartbeatEmitter fires during pause; no stalled event; job completes cleanly', async () => {
    vi.useFakeTimers();

    const jobId = 'fi-long-handler-001';
    const events: RestoreSseEvent[] = [];

    // Long-running first phase: resolves after 25s (fake-timer controlled)
    const longHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25_000));
      return { restoredCount: 5, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.SiteReferenceData]: longHandler },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(
      makeOrchestratorOptions(jobId),
      (ev) => events.push(ev)
    );

    // At 11s: HeartbeatEmitter fires at 10s cadence, so ≥1 heartbeat
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);

    const heartbeats = events.filter((e): e is HeartbeatEvent => e.type === 'heartbeat');
    expect(heartbeats.length, '[ASSERTION-1b] HeartbeatEmitter fires during long pause').toBeGreaterThanOrEqual(1);
    expect(heartbeats[0].currentPhase).toBe(RestorePhase.SiteReferenceData);
    expect(heartbeats[0].jobId).toBe(jobId);

    // No stalled event because heartbeats keep the watchdog reset
    const hasStalled = events.some((e) => (e as { type: string }).type === 'stalled');
    expect(hasStalled, '[ASSERTION-1b] no stalled when HeartbeatEmitter is running').toBe(false);

    // Complete the job
    await vi.advanceTimersByTimeAsync(25_000);
    await restorePromise;

    const terminalEvents = events.filter(
      (e) => e.type === 'job_completed' || e.type === 'job_failed'
    );
    expect(terminalEvents.length, '[ASSERTION-1b] job completes cleanly').toBe(1);
    expect(terminalEvents[0].type).toBe('job_completed');

    console.log('[EVIDENCE] (1b) heartbeats during 25s pause:', heartbeats.length);
    console.log('[EVIDENCE] (1b) HEARTBEAT_INTERVAL_MS:', HEARTBEAT_INTERVAL_MS);
    console.log('[EVIDENCE] (1b) terminal event:', terminalEvents[0].type);
  });
});

// ===========================================================================
// (2) Restore path — heartbeat resumption clears the stalled alert
// ===========================================================================

describe('(2) Restore path — heartbeat resumption clears stalled alert', () => {
  it('stalled fires → heartbeat event arrives → watchdog resets → no further stalled events for 20s', async () => {
    vi.useFakeTimers();

    const jobId = 'fi-hb-resume-001';
    insertRestoreJobDirectly(restoreDb, jobId);

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    // Orchestrator publishes phase_started then goes silent
    publish(jobId, {
      type: 'phase_started',
      jobId,
      ts: new Date().toISOString(),
      phase: RestorePhase.Sprint,
    });

    // Advance past threshold — stalled fires
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    const stalledCountBefore = parseStalledPayload(sse.writes).length;
    expect(stalledCountBefore, '[ASSERTION-2] stalled fires after threshold').toBeGreaterThanOrEqual(1);
    expect(sse.isEnded(), '[ASSERTION-2] stream stays open after stalled').toBe(false);

    // Resume: orchestrator sends a heartbeat event (simulating HeartbeatEmitter resuming)
    publish(jobId, {
      type: 'heartbeat',
      jobId,
      ts: new Date().toISOString(),
      currentPhase: RestorePhase.Sprint,
    });

    // Advance 19s more — within the new 20s window — no additional stalled event
    await vi.advanceTimersByTimeAsync(19_000);

    const stalledCountAfter = parseStalledPayload(sse.writes).length;
    expect(stalledCountAfter, '[ASSERTION-2] no new stalled events within 19s after heartbeat resumption').toBe(stalledCountBefore);
    expect(sse.isEnded(), '[ASSERTION-2] stream stays open').toBe(false);

    // Publish job_completed → stream closes cleanly
    publish(jobId, {
      type: 'job_completed',
      jobId,
      ts: new Date().toISOString(),
      errors: 0,
      restoredCount: 0,
    });
    expect(sse.isEnded(), '[ASSERTION-2] stream closes after job_completed').toBe(true);

    console.log('[EVIDENCE] (2) stalled count before resumption:', stalledCountBefore);
    console.log('[EVIDENCE] (2) stalled count 19s after heartbeat:', stalledCountAfter);
    console.log('[EVIDENCE] (2) heartbeat resumption cleared stalled watchdog: PASS');
    console.log('[EVIDENCE] (2) stream closed after job_completed:', sse.isEnded());
  });

  it('stalled fires repeatedly while worker is down, then clears after heartbeat — timing evidence', async () => {
    vi.useFakeTimers();

    const jobId = 'fi-hb-resume-002';
    insertRestoreJobDirectly(restoreDb, jobId);

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId).req, sse.res);

    publish(jobId, {
      type: 'phase_started',
      jobId,
      ts: new Date().toISOString(),
      phase: RestorePhase.Issue,
    });

    // First stall: advance past threshold
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);
    const count1 = parseStalledPayload(sse.writes).length;
    expect(count1, '[ASSERTION-2b] first stalled fired').toBeGreaterThanOrEqual(1);

    // Second stall window: advance past another threshold (stalled re-arms itself)
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);
    const count2 = parseStalledPayload(sse.writes).length;
    expect(count2, '[ASSERTION-2b] stalled fires again after second threshold').toBeGreaterThanOrEqual(count1 + 1);

    // Now send a heartbeat — resets the watchdog
    publish(jobId, {
      type: 'heartbeat',
      jobId,
      ts: new Date().toISOString(),
      currentPhase: RestorePhase.Issue,
    });

    // Advance 19s — no new stalled within the new 20s window
    await vi.advanceTimersByTimeAsync(19_000);
    const count3 = parseStalledPayload(sse.writes).length;
    expect(count3, '[ASSERTION-2b] no new stalled within 19s after heartbeat').toBe(count2);

    // End the job
    publish(jobId, {
      type: 'job_completed',
      jobId,
      ts: new Date().toISOString(),
      errors: 0,
      restoredCount: 0,
    });

    console.log('[EVIDENCE] (2b) stalled fires while worker down:', count1, '→', count2, 'times');
    console.log('[EVIDENCE] (2b) stalled count after heartbeat + 19s (no new):', count3);
    console.log('[EVIDENCE] (2b) heartbeat resumption verified: stalled stopped at', count3);
  });
});

// ===========================================================================
// (3) Backup path — "Completed with N errors" status semantics
// ===========================================================================

describe('(3) Backup path — "Completed with N errors" (status=completed_with_errors)', () => {
  let backupDb: Database.Database;

  beforeEach(() => {
    backupDb = createBackupTestDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    backupDb.close();
  });

  it('complete(N) with N=3 → status=completed_with_errors; errorsCount=3; never status=completed', () => {
    const emitter = new ProgressEmitter('fi-backup-err-001', 'manifest-fi-1', 'conn-fi-1', backupDb);
    emitter.start();

    // Emit heartbeats accumulating errors
    emitter.emit(captureEvent('Issue', 4, 5), 1);
    emitter.emit(captureEvent('Issue', 5, 5), 3);

    emitter.complete(3);

    const job = getBackupJob(backupDb, 'fi-backup-err-001');
    expect(job, '[ASSERTION-3] job row must exist').toBeDefined();
    expect(job!.status, '[ASSERTION-3] status must be completed_with_errors when errorsCount>0').toBe('completed_with_errors');
    expect(job!.errorsCount, '[ASSERTION-3] errorsCount must match N=3').toBe(3);
    expect(job!.status, '[ASSERTION-3] must NOT be completed when errors>0').not.toBe('completed');

    // Verify op=completed log contains errors=3
    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [string]) => s);
    const completedLine = logCalls.find((s) => s.includes('op=completed'));
    expect(completedLine, '[ASSERTION-3] op=completed log must exist').toBeDefined();
    expect(completedLine, '[ASSERTION-3] op=completed log must contain errors=3').toContain('errors=3');

    console.log('[EVIDENCE] (3) backup job status:', job!.status);
    console.log('[EVIDENCE] (3) backup job errorsCount:', job!.errorsCount);
    console.log('[EVIDENCE] (3) op=completed log line:', completedLine);
    console.log('[EVIDENCE] (3) "Completed with N errors" N=3 status semantics: PASS');
  });

  it('complete(0) → status=completed; not completed_with_errors (no false positives)', () => {
    const emitter = new ProgressEmitter('fi-backup-ok-001', 'manifest-fi-2', 'conn-fi-1', backupDb);
    emitter.start();
    emitter.emit(captureEvent('Issue', 5, 5), 0);
    emitter.complete(0);

    const job = getBackupJob(backupDb, 'fi-backup-ok-001');
    expect(job!.status, '[ASSERTION-3b] zero errors → status=completed (not completed_with_errors)').toBe('completed');
    expect(job!.errorsCount).toBe(0);

    console.log('[EVIDENCE] (3b) zero-error backup status:', job!.status, '→ renders "Completed successfully"');
  });

  it('complete(5) → errorsCount=5 matches the per-item error count accumulated', () => {
    const emitter = new ProgressEmitter('fi-backup-err-002', 'manifest-fi-3', 'conn-fi-1', backupDb);
    emitter.start();

    // Simulate 5 individual item errors across multiple heartbeats
    emitter.emit(captureEvent('CustomField', 2, 10), 1);
    emitter.emit(captureEvent('Project', 5, 10), 3);
    emitter.emit(captureEvent('Issue', 8, 10), 5);

    emitter.complete(5);

    const job = getBackupJob(backupDb, 'fi-backup-err-002');
    expect(job!.status).toBe('completed_with_errors');
    expect(job!.errorsCount, '[ASSERTION-3c] errorsCount = N = 5').toBe(5);

    console.log('[EVIDENCE] (3c) per-item errors N=5 → errorsCount:', job!.errorsCount);
    console.log('[EVIDENCE] (3c) status:', job!.status, '→ UI renders "Completed with 5 errors"');
  });
});

// ===========================================================================
// (3b) Backup path — stalled detection under fault injection
// ===========================================================================

describe('(3b) Backup path — stalled-alert via fault injection (worker pauses >20s)', () => {
  let backupDb: Database.Database;

  beforeEach(() => {
    backupDb = createBackupTestDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    backupDb.close();
    vi.useRealTimers();
  });

  it('backup worker pauses >20s → backup_jobs.status transitions to stalled; [backup-job] op=stalled logged', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('fi-backup-stall-001', 'manifest-stall-1', 'conn-fi-1', backupDb);
    emitter.start();

    // Advance 25s without calling emit() — simulates worker crash mid-job
    await vi.advanceTimersByTimeAsync(25_000);

    const job = getBackupJob(backupDb, 'fi-backup-stall-001');
    expect(job!.status, '[ASSERTION-3b-stall] backup job must be stalled after 25s silence').toBe('stalled');

    // Verify [backup-job] op=stalled structured log line
    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map(([s]: [string]) => s);
    const stalledLine = logCalls.find((s) => s.includes('[backup-job]') && s.includes('op=stalled'));
    expect(stalledLine, '[ASSERTION-3b-stall] [backup-job] op=stalled log must be emitted').toBeDefined();
    expect(stalledLine).toContain(`jobId=fi-backup-stall-001`);

    // Verify progress events had stopped (no emit() calls during the pause)
    const eventCount = backupDb
      .prepare('SELECT COUNT(*) as cnt FROM backup_job_events WHERE jobId = ?')
      .get('fi-backup-stall-001') as { cnt: number };
    expect(eventCount.cnt, '[ASSERTION-3b-stall] no heartbeat events during the pause').toBe(0);

    emitter.complete(0); // cleanup

    console.log('[EVIDENCE] (3b-stall) backup_jobs.status after 25s silence:', job!.status);
    console.log('[EVIDENCE] (3b-stall) BACKUP_STALLED_THRESHOLD_MS:', BACKUP_STALLED_THRESHOLD_MS);
    console.log('[EVIDENCE] (3b-stall) op=stalled log line:', stalledLine);
    console.log('[EVIDENCE] (3b-stall) heartbeat event count during pause:', eventCount.cnt);
  });

  it('backup watchdog does not fire when heartbeats arrive within threshold (every 8s over 40s)', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('fi-backup-hb-ok-001', 'manifest-hb-1', 'conn-fi-1', backupDb);
    emitter.start();

    // Emit heartbeats every 8s for 40s total — always within 20s threshold
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(8_000);
      emitter.emit(captureEvent('Issue', i + 1, 5), 0);
    }

    const job = getBackupJob(backupDb, 'fi-backup-hb-ok-001');
    expect(job!.status, '[ASSERTION-3b-hb] no stalled under 8s heartbeat cadence over 40s').toBe('running');

    emitter.complete(0);

    const finalJob = getBackupJob(backupDb, 'fi-backup-hb-ok-001');
    expect(finalJob!.status).toBe('completed');

    console.log('[EVIDENCE] (3b-hb) backup status after 40s with 8s heartbeats:', job!.status);
    console.log('[EVIDENCE] (3b-hb) no stalled under normal heartbeat cadence: PASS');
  });
});

// ===========================================================================
// (4) Restore path — "Completed with N errors" in job_completed.errors
// ===========================================================================

describe('(4) Restore path — "Completed with N errors" (job_completed.errors > 0)', () => {
  it('restore phase returns errorCount=2 → job_completed.errors=2; result.errorCount=2; never job_failed', async () => {
    const jobId = 'fi-restore-err-001';
    const events: RestoreSseEvent[] = [];

    // Phase handler that succeeds but reports 2 item-level errors
    const partialHandler = async () => ({ restoredCount: 8, errorCount: 2 });

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.Issue]: partialHandler },
      alwaysPassChecker
    );

    const result = await orchestrator.runRestore(makeOrchestratorOptions(jobId), (ev) => events.push(ev));

    // job_completed (not job_failed) — per-item errors don't halt the job
    const terminalEvent = events[events.length - 1];
    expect(terminalEvent.type, '[ASSERTION-4] terminal event must be job_completed').toBe('job_completed');
    expect(events.some((e) => e.type === 'job_failed'), '[ASSERTION-4] job_failed must NOT be emitted for item-level errors').toBe(false);

    // job_completed.errors must equal the total error count
    const completedEvent = terminalEvent as JobCompletedEvent;
    expect(completedEvent.errors, '[ASSERTION-4] job_completed.errors must be 2').toBe(2);
    expect(completedEvent.restoredCount, '[ASSERTION-4] restoredCount must be 8').toBe(8);

    // result.errorCount reflects the same N
    expect(result.errorCount, '[ASSERTION-4] result.errorCount must be 2').toBe(2);
    expect(result.phaseDiagnostic, '[ASSERTION-4] no phaseDiagnostic for item-level errors').toBeUndefined();

    console.log('[EVIDENCE] (4) terminal event type:', terminalEvent.type);
    console.log('[EVIDENCE] (4) job_completed.errors:', completedEvent.errors, '→ UI renders "Completed with 2 errors"');
    console.log('[EVIDENCE] (4) result.errorCount:', result.errorCount);
    console.log('[EVIDENCE] (4) phaseDiagnostic (should be undefined):', result.phaseDiagnostic);
  });

  it('restore with 0 errors → job_completed.errors=0; UI renders "Completed successfully"', async () => {
    const jobId = 'fi-restore-ok-001';
    const events: RestoreSseEvent[] = [];

    const orchestrator = new RestoreOrchestrator(undefined, alwaysPassChecker);
    const result = await orchestrator.runRestore(makeOrchestratorOptions(jobId), (ev) => events.push(ev));

    const completedEvent = events.find((e) => e.type === 'job_completed') as JobCompletedEvent | undefined;
    expect(completedEvent, '[ASSERTION-4b] job_completed must be emitted').toBeDefined();
    expect(completedEvent!.errors, '[ASSERTION-4b] zero errors on success').toBe(0);
    expect(result.errorCount).toBe(0);

    console.log('[EVIDENCE] (4b) zero-error restore → job_completed.errors:', completedEvent!.errors, '→ "Completed successfully"');
  });

  it('multiple phases with per-item errors → job_completed.errors accumulates across all phases', async () => {
    const jobId = 'fi-restore-multi-err-001';
    const events: RestoreSseEvent[] = [];

    // Two phases each report item-level errors
    const handler2Errors = async () => ({ restoredCount: 3, errorCount: 2 });
    const handler3Errors = async () => ({ restoredCount: 7, errorCount: 3 });

    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.Project]: handler2Errors,
        [RestorePhase.Issue]: handler3Errors,
      },
      alwaysPassChecker
    );

    const result = await orchestrator.runRestore(makeOrchestratorOptions(jobId), (ev) => events.push(ev));

    const completedEvent = events.find((e) => e.type === 'job_completed') as JobCompletedEvent | undefined;
    expect(completedEvent).toBeDefined();
    // Total errors = 2 (project) + 3 (issue) = 5
    expect(completedEvent!.errors, '[ASSERTION-4c] errors accumulate across phases: 2+3=5').toBe(5);
    expect(result.errorCount).toBe(5);

    // All phases still ran (item errors don't halt)
    const startedPhases = events
      .filter((e) => e.type === 'phase_started')
      .map((e) => (e as { phase: string }).phase);
    expect(startedPhases, '[ASSERTION-4c] all phases run despite item errors').toEqual([...RESTORE_PHASE_ORDER]);

    console.log('[EVIDENCE] (4c) total errors across 2 phases (2+3):', completedEvent!.errors);
    console.log('[EVIDENCE] (4c) all phases ran:', startedPhases.length === RESTORE_PHASE_ORDER.length);
    console.log('[EVIDENCE] (4c) job_completed.errors N=5 → UI renders "Completed with 5 errors"');
  });
});

// ===========================================================================
// (5) Cross-path summary: all four assertions CI log evidence
// ===========================================================================

describe('(5) CI evidence summary — all four fault-injection assertions', () => {
  it('summary: logs assertion outcomes as CI-readable evidence lines', async () => {
    // This test documents what each assertion validates and confirms CI evidence format.
    // Actual assertions are in the suites above; this produces a readable CI summary.

    console.log('[CI-EVIDENCE] Assertion (1): Restore stalled-alert — fires within 20s of last heartbeat');
    console.log('[CI-EVIDENCE]   Suite: "(1) Restore path — stalled-alert via fault injection"');
    console.log('[CI-EVIDENCE]   Asserts: event:stalled fires; secondsSinceLastEvent>=20; stream stays open');

    console.log('[CI-EVIDENCE] Assertion (2): Heartbeat resumption — clears stalled alert');
    console.log('[CI-EVIDENCE]   Suite: "(2) Restore path — heartbeat resumption clears stalled alert"');
    console.log('[CI-EVIDENCE]   Asserts: stalled fires, heartbeat arrives, no more stalled events for 19s');

    console.log('[CI-EVIDENCE] Assertion (3): Per-item-error backup — "Completed with N errors"');
    console.log('[CI-EVIDENCE]   Suite: "(3) Backup path — Completed with N errors"');
    console.log('[CI-EVIDENCE]   Asserts: status=completed_with_errors; errorsCount=N; log errors=N');
    console.log('[CI-EVIDENCE]   Also: "(3b) Backup stalled" — backup_jobs.status=stalled after 25s silence');

    console.log('[CI-EVIDENCE] Assertion (4): Restore "Completed with N errors" — job_completed.errors=N');
    console.log('[CI-EVIDENCE]   Suite: "(4) Restore path — Completed with N errors"');
    console.log('[CI-EVIDENCE]   Asserts: terminal=job_completed; errors=N; no job_failed for item errors');

    // Sanity pass
    expect(true).toBe(true);
  });
});
