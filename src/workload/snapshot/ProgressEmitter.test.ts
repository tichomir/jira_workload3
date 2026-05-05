import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProgressEmitter } from './ProgressEmitter.js';
import type { CaptureProgressEvent } from '../backup/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh in-memory SQLite DB with only the tables ProgressEmitter needs. */
function makeDb(): Database.Database {
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

function getJob(db: Database.Database, jobId: string) {
  return db
    .prepare('SELECT * FROM backup_jobs WHERE jobId = ?')
    .get(jobId) as {
      jobId: string;
      manifestId: string;
      connectionId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      lastEventTs: string | null;
      errorsCount: number;
    } | undefined;
}

function getEvents(db: Database.Database, jobId: string) {
  return db
    .prepare('SELECT * FROM backup_job_events WHERE jobId = ? ORDER BY ts ASC')
    .all(jobId) as Array<{
      id: string;
      jobId: string;
      ts: string;
      phase: string;
      processed: number;
      total: number | null;
      errorsCount: number;
      eventJson: string;
    }>;
}

function captureEvent(phase: string, captured = 1, total: number | null = 1): CaptureProgressEvent {
  return {
    phase: phase as CaptureProgressEvent['phase'],
    itemsCaptured: captured,
    itemsTotal: total,
    elapsedMs: 100,
  };
}

// ---------------------------------------------------------------------------
// Happy path — completes with no errors
// ---------------------------------------------------------------------------

describe('ProgressEmitter — happy path (no errors)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates a pending job row on construction', () => {
    new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    const job = getJob(db, 'job-1');
    expect(job).toBeDefined();
    expect(job!.status).toBe('pending');
    expect(job!.manifestId).toBe('manifest-1');
    expect(job!.connectionId).toBe('conn-1');
  });

  it('transitions to running on start()', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    const job = getJob(db, 'job-1');
    expect(job!.status).toBe('running');
    emitter.complete(0);
  });

  it('persists heartbeat events to backup_job_events', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('CustomField', 5, 5));
    emitter.emit(captureEvent('Issue', 10, 10));
    emitter.complete(0);

    const events = getEvents(db, 'job-1');
    expect(events).toHaveLength(2);
    expect(events[0].phase).toBe('CustomField');
    expect(events[0].processed).toBe(5);
    expect(events[1].phase).toBe('Issue');
    expect(events[1].processed).toBe(10);
  });

  it('sets terminal status to "completed" when errorsCount === 0', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('Issue', 3, 3));
    emitter.complete(0);

    const job = getJob(db, 'job-1');
    expect(job!.status).toBe('completed');
    expect(job!.errorsCount).toBe(0);
  });

  it('emits [backup-job] op=heartbeat structured log lines', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('Issue', 1, 1));
    emitter.complete(0);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: any[]) => args[0] as string);
    expect(logCalls.some((s) => s.includes('[backup-job]') && s.includes('op=heartbeat'))).toBe(true);
  });

  it('emits [backup-job] op=completed structured log on complete()', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    emitter.complete(0);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: any[]) => args[0] as string);
    expect(logCalls.some((s) => s.includes('op=completed') && s.includes('errors=0'))).toBe(true);
  });

  it('stores correct eventJson shape per event', () => {
    const emitter = new ProgressEmitter('job-1', 'manifest-1', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('Project', 2, 2));
    emitter.complete(0);

    const events = getEvents(db, 'job-1');
    const parsed = JSON.parse(events[0].eventJson) as {
      jobId: string; ts: string; phase: string;
      processed: number; total: number | null; errorsCount: number;
    };
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.phase).toBe('Project');
    expect(parsed.processed).toBe(2);
    expect(parsed.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Completion with errors — status must be 'completed_with_errors'
// ---------------------------------------------------------------------------

describe('ProgressEmitter — completion with errors', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sets status to "completed_with_errors" when errorsCount > 0', () => {
    const emitter = new ProgressEmitter('job-2', 'manifest-2', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('Issue', 4, 5), 1);
    emitter.complete(1);

    const job = getJob(db, 'job-2');
    expect(job!.status).toBe('completed_with_errors');
    expect(job!.errorsCount).toBe(1);
  });

  it('never sets status to "completed" when errorsCount > 0', () => {
    const emitter = new ProgressEmitter('job-2', 'manifest-2', 'conn-1', db);
    emitter.start();
    emitter.complete(3);

    const job = getJob(db, 'job-2');
    expect(job!.status).not.toBe('completed');
    expect(job!.status).toBe('completed_with_errors');
  });

  it('logs "errors=N" in op=completed line when errorsCount > 0', () => {
    const emitter = new ProgressEmitter('job-2', 'manifest-2', 'conn-1', db);
    emitter.start();
    emitter.complete(5);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: any[]) => args[0] as string);
    const completedLine = logCalls.find((s) => s.includes('op=completed'));
    expect(completedLine).toBeDefined();
    expect(completedLine).toContain('errors=5');
  });

  it('persists errorsCount in the heartbeat event row', () => {
    const emitter = new ProgressEmitter('job-2', 'manifest-2', 'conn-1', db);
    emitter.start();
    emitter.emit(captureEvent('Issue', 9, 10), 2);
    emitter.complete(2);

    const events = getEvents(db, 'job-2');
    expect(events[0].errorsCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fatal error — status must be 'failed'
// ---------------------------------------------------------------------------

describe('ProgressEmitter — fatal failure', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('sets status to "failed" on fail()', () => {
    const emitter = new ProgressEmitter('job-3', 'manifest-3', 'conn-1', db);
    emitter.start();
    emitter.fail('CustomField phase: API down');

    const job = getJob(db, 'job-3');
    expect(job!.status).toBe('failed');
  });

  it('logs [backup-job] op=failed on fail()', () => {
    const emitter = new ProgressEmitter('job-3', 'manifest-3', 'conn-1', db);
    emitter.start();
    emitter.fail('network error');

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: any[]) => args[0] as string);
    expect(logCalls.some((s) => s.includes('op=failed'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stalled detection — watchdog transitions job to 'stalled' after >20 s silence
// ---------------------------------------------------------------------------

describe('ProgressEmitter — stalled detection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('transitions to "stalled" when watchdog fires after >20 s of silence', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('job-4', 'manifest-4', 'conn-1', db);
    emitter.start();

    // Advance 25 seconds without emitting any heartbeat
    await vi.advanceTimersByTimeAsync(25_000);

    const job = getJob(db, 'job-4');
    expect(job!.status).toBe('stalled');

    emitter.complete(0); // clear watchdog
  });

  it('does NOT stall when heartbeats keep arriving within the threshold', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('job-4', 'manifest-4', 'conn-1', db);
    emitter.start();

    // Emit a heartbeat at t=8s (within 20s threshold)
    await vi.advanceTimersByTimeAsync(8_000);
    emitter.emit(captureEvent('Issue', 1, null));

    // Advance another 15 s — total 23 s from start, but only 15 s since last heartbeat
    await vi.advanceTimersByTimeAsync(15_000);

    const job = getJob(db, 'job-4');
    expect(job!.status).toBe('running');

    emitter.complete(0);
  });

  it('emits [backup-job] op=stalled structured log line', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('job-4', 'manifest-4', 'conn-1', db);
    emitter.start();

    await vi.advanceTimersByTimeAsync(25_000);

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((args: any[]) => args[0] as string);
    expect(logCalls.some((s) => s.includes('op=stalled'))).toBe(true);

    emitter.complete(0);
  });

  it('watchdog stops after complete() — does not flip stalled after terminal', async () => {
    vi.useFakeTimers();

    const emitter = new ProgressEmitter('job-5', 'manifest-5', 'conn-1', db);
    emitter.start();
    emitter.complete(0);

    // Advance well past stalled threshold — watchdog should be cleared
    await vi.advanceTimersByTimeAsync(60_000);

    const job = getJob(db, 'job-5');
    expect(job!.status).toBe('completed'); // still 'completed', not 'stalled'
  });
});
