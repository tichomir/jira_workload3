/**
 * Integration tests for GET /api/restore-jobs/:id/events (SSE endpoint).
 *
 * Tests the SSE handler and event bus together:
 *   - Content-Type header
 *   - 404 for unknown job
 *   - Events published to the bus appear in SSE format
 *   - Events arrive in RESTORE_PHASE_ORDER (phase_started → phase_completed per phase → job_completed)
 *   - job_failed terminates the stream
 *   - job_completed terminates the stream
 *   - Heartbeat sent at ≤10 s intervals (fake clock)
 *   - Late-connecting client replays buffered events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import { handleGetJobEvents } from './restore-jobs.js';
import { publish, _clearAll } from '../workload/restore/eventBus.js';
import { STALLED_THRESHOLD_MS } from '../platform/restore/sseEvents.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type PhaseStartedEvent,
  type PhaseCompletedEvent,
  type JobCompletedEvent,
  type JobFailedEvent,
  type HeartbeatEvent,
} from '../workload/restore/types.js';

// ---------------------------------------------------------------------------
// Test DB setup
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
    CREATE TABLE restore_jobs (
      jobId                TEXT    PRIMARY KEY,
      connectionId         TEXT    NOT NULL REFERENCES connections(connectionId),
      backupPointId        TEXT    NOT NULL,
      conflictMode         TEXT    NOT NULL DEFAULT 'skip',
      destination          TEXT    NOT NULL,
      selection            TEXT    NOT NULL DEFAULT '[]',
      alternateDestination TEXT,
      status               TEXT    NOT NULL DEFAULT 'queued',
      restoredCount        INTEGER NOT NULL DEFAULT 0,
      errorCount           INTEGER NOT NULL DEFAULT 0,
      phaseDiagnostic      TEXT,
      createdAt            TEXT    NOT NULL,
      completedAt          TEXT
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES ('conn-1', 'cloud-1', 'test.atlassian.net', 'active', ?, ?)`
  ).run(now, now);

  return db;
}

function insertJob(db: Database.Database, jobId: string): void {
  db.prepare(
    `INSERT INTO restore_jobs (jobId, connectionId, backupPointId, destination, createdAt)
     VALUES (?, 'conn-1', 'bp-1', 'original', ?)`
  ).run(jobId, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Mock req / res helpers
// ---------------------------------------------------------------------------

interface SseMockRes {
  res: Response;
  headers: Record<string, string>;
  writes: string[];
  isEnded: () => boolean;
  isFlushed: () => boolean;
  statusCode: () => number;
  jsonBody: () => unknown;
}

function makeSseRes(): SseMockRes {
  const headers: Record<string, string> = {};
  const writes: string[] = [];
  let ended = false;
  let flushed = false;
  let code = 200;
  let jsonBodyValue: unknown;

  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return res;
    },
    flushHeaders() {
      flushed = true;
      return res;
    },
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
    end() {
      ended = true;
      return res;
    },
    status(c: number) {
      code = c;
      return res;
    },
    json(body: unknown) {
      jsonBodyValue = body;
      return res;
    },
  } as unknown as Response;

  return {
    res,
    headers,
    writes,
    isEnded: () => ended,
    isFlushed: () => flushed,
    statusCode: () => code,
    jsonBody: () => jsonBodyValue,
  };
}

interface SseMockReq {
  req: Request;
  triggerClose: () => void;
}

function makeSseReq(id: string): SseMockReq {
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
// Helpers to build SSE events
// ---------------------------------------------------------------------------

function phaseStarted(jobId: string, phase: RestorePhase): PhaseStartedEvent {
  return { type: 'phase_started', jobId, ts: new Date().toISOString(), phase };
}

function phaseCompleted(jobId: string, phase: RestorePhase): PhaseCompletedEvent {
  return { type: 'phase_completed', jobId, ts: new Date().toISOString(), phase, restoredCount: 0, errorCount: 0 };
}

function jobCompleted(jobId: string): JobCompletedEvent {
  return { type: 'job_completed', jobId, ts: new Date().toISOString(), errors: 0, restoredCount: 0 };
}

function jobFailed(jobId: string, phase: RestorePhase): JobFailedEvent {
  return {
    type: 'job_failed',
    jobId,
    ts: new Date().toISOString(),
    error: { code: 'dependency_phase_failed', phase, message: 'test failure' },
  };
}

/** Parse SSE messages (event:/data: blocks) into RestoreSseEvent objects. */
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
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/restore-jobs/:id/events (SSE)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    _clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDb();
    _clearAll();
  });

  it('returns 404 for an unknown jobId', () => {
    const { req } = makeSseReq('no-such-job');
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);
    expect(mock.statusCode()).toBe(404);
    expect((mock.jsonBody() as Record<string, unknown>)['error']).toBe('not_found');
  });

  it('sets Content-Type: text/event-stream and flushes headers', () => {
    insertJob(db, 'job-headers');
    const { req } = makeSseReq('job-headers');
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);
    expect(mock.headers['Content-Type']).toBe('text/event-stream');
    expect(mock.headers['Cache-Control']).toBe('no-cache');
    expect(mock.isFlushed()).toBe(true);
  });

  it('emits events in SSE data format', () => {
    insertJob(db, 'job-format');
    const { req } = makeSseReq('job-format');
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    const event = phaseStarted('job-format', RestorePhase.SiteReferenceData);
    publish('job-format', event);
    publish('job-format', jobCompleted('job-format'));

    // SSE format: event: <type>\ndata: <json>\n\n
    expect(mock.writes.some((w) => w.startsWith('event: '))).toBe(true);
    expect(mock.writes[0]).toMatch(/^event: phase_started\ndata: /);
    const events = parseSseWrites(mock.writes);
    expect(events[0]).toMatchObject({ type: 'phase_started', phase: RestorePhase.SiteReferenceData });
  });

  it('emits all phase events in RESTORE_PHASE_ORDER then job_completed', () => {
    const jobId = 'job-order';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    // Simulate orchestrator emitting phases in canonical order
    for (const phase of RESTORE_PHASE_ORDER) {
      publish(jobId, phaseStarted(jobId, phase));
      publish(jobId, phaseCompleted(jobId, phase));
    }
    publish(jobId, jobCompleted(jobId));

    const events = parseSseWrites(mock.writes);

    // Verify phase_started events appear in RESTORE_PHASE_ORDER
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Verify phase_completed events appear in RESTORE_PHASE_ORDER
    const completedPhases = events
      .filter((e): e is PhaseCompletedEvent => e.type === 'phase_completed')
      .map((e) => e.phase);
    expect(completedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Last event is job_completed
    expect(events[events.length - 1].type).toBe('job_completed');
  });

  it('job_completed terminates the stream (res.end called)', () => {
    const jobId = 'job-completed-term';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, jobCompleted(jobId));
    expect(mock.isEnded()).toBe(true);
  });

  it('job_failed terminates the stream (res.end called)', () => {
    const jobId = 'job-failed-term';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, jobFailed(jobId, RestorePhase.Project));
    expect(mock.isEnded()).toBe(true);
  });

  it('job_failed: no further events are written after the terminal event', () => {
    const jobId = 'job-failed-no-more';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, phaseStarted(jobId, RestorePhase.SiteReferenceData));
    publish(jobId, jobFailed(jobId, RestorePhase.SiteReferenceData));

    const writeCountAfterFailed = mock.writes.length;
    // These should be ignored — stream is already done
    publish(jobId, phaseStarted(jobId, RestorePhase.Project));
    publish(jobId, phaseCompleted(jobId, RestorePhase.Project));

    expect(mock.writes.length).toBe(writeCountAfterFailed);
  });

  it('job_failed event has correct error payload in the SSE stream', () => {
    const jobId = 'job-failed-payload';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, jobFailed(jobId, RestorePhase.Workflow));

    const events = parseSseWrites(mock.writes);
    const failed = events.find((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failed).toBeDefined();
    expect(failed!.error.code).toBe('dependency_phase_failed');
    expect(failed!.error.phase).toBe(RestorePhase.Workflow);
  });

  it('late subscriber replays buffered events immediately on connect', () => {
    const jobId = 'job-replay';
    insertJob(db, jobId);

    // Publish events before the SSE client connects
    publish(jobId, phaseStarted(jobId, RestorePhase.SiteReferenceData));
    publish(jobId, phaseCompleted(jobId, RestorePhase.SiteReferenceData));
    publish(jobId, jobCompleted(jobId));

    // SSE client connects after events are already buffered
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    const events = parseSseWrites(mock.writes);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('phase_started');
    expect(events[1].type).toBe('phase_completed');
    expect(events[2].type).toBe('job_completed');
    // Stream is terminated (terminal event was replayed)
    expect(mock.isEnded()).toBe(true);
  });

  it('heartbeat comment is written every 9 s with fake clock', () => {
    vi.useFakeTimers();

    const jobId = 'job-heartbeat';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    const heartbeatsBefore = mock.writes.filter((w) => w === ': heartbeat\n\n').length;
    expect(heartbeatsBefore).toBe(0);

    // Advance 9 s — one heartbeat fires
    vi.advanceTimersByTime(9_000);
    expect(mock.writes.filter((w) => w === ': heartbeat\n\n').length).toBe(1);

    // Advance another 9 s — second heartbeat
    vi.advanceTimersByTime(9_000);
    expect(mock.writes.filter((w) => w === ': heartbeat\n\n').length).toBe(2);
  });

  it('heartbeat stops after job_completed', () => {
    vi.useFakeTimers();

    const jobId = 'job-heartbeat-stop';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, jobCompleted(jobId));
    expect(mock.isEnded()).toBe(true);

    const writesAfterEnd = mock.writes.length;
    // Advance time — no more heartbeats since interval was cleared
    vi.advanceTimersByTime(27_000);
    expect(mock.writes.length).toBe(writesAfterEnd);
  });

  it('heartbeat interval is ≤10 s (9 s satisfies constraint)', () => {
    vi.useFakeTimers();

    const jobId = 'job-hb-interval';
    insertJob(db, jobId);
    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    // After 8 s (< 9 s interval) no heartbeat yet
    vi.advanceTimersByTime(8_999);
    expect(mock.writes.filter((w) => w === ': heartbeat\n\n').length).toBe(0);

    // At exactly 9 s the first heartbeat fires
    vi.advanceTimersByTime(1);
    expect(mock.writes.filter((w) => w === ': heartbeat\n\n').length).toBe(1);
  });

  it('client disconnect (req close) does not cause further writes', () => {
    const jobId = 'job-disconnect';
    insertJob(db, jobId);
    const { req, triggerClose } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, phaseStarted(jobId, RestorePhase.SiteReferenceData));
    const writesBeforeClose = mock.writes.length;

    triggerClose();

    // Events published after disconnect should not appear
    publish(jobId, phaseCompleted(jobId, RestorePhase.SiteReferenceData));
    publish(jobId, jobCompleted(jobId));

    expect(mock.writes.length).toBe(writesBeforeClose);
  });
});

// ---------------------------------------------------------------------------
// Stalled-alert watchdog
// ---------------------------------------------------------------------------

function heartbeatEvent(jobId: string, phase: RestorePhase): HeartbeatEvent {
  return { type: 'heartbeat', jobId, ts: new Date().toISOString(), currentPhase: phase };
}

interface StalledPayload {
  type: string;
  jobId: string;
  lastPhase: string | null;
  secondsSinceLastEvent: number;
}

function parseStalledEvent(writes: string[]): StalledPayload | undefined {
  const stalledWrite = writes.find((w) => w.startsWith('event: stalled\n'));
  if (!stalledWrite) return undefined;
  const dataLine = stalledWrite.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return undefined;
  return JSON.parse(dataLine.slice('data: '.length)) as StalledPayload;
}

describe('stalled-alert watchdog', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
    _clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetDb();
    _clearAll();
  });

  it('emits stalled event after >20s of silence from a paused orchestrator', async () => {
    vi.useFakeTimers();

    const jobId = 'job-stalled-basic';
    insertJob(db, jobId);

    // Manually-resolved promise simulates a paused orchestrator phase handler
    let resolvePause!: () => void;
    const _pausePromise = new Promise<void>((resolve) => { resolvePause = resolve; });
    void _pausePromise; // referenced so linter knows it's used

    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    // Orchestrator started the Issue phase then stalled (promise not yet resolved)
    publish(jobId, phaseStarted(jobId, RestorePhase.Issue));

    // Advance past the stalled threshold without resolving the pause or publishing events
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    const payload = parseStalledEvent(mock.writes);
    expect(payload).toBeDefined();
    expect(payload!.type).toBe('stalled');
    expect(payload!.jobId).toBe(jobId);
    expect(payload!.lastPhase).toBe(RestorePhase.Issue);
    expect(payload!.secondsSinceLastEvent).toBeGreaterThanOrEqual(20);

    // Stream is NOT closed — stalled is not a terminal event
    expect(mock.isEnded()).toBe(false);

    // Clean up: resolve the pause (no-op for the test, just avoids dangling promise)
    resolvePause();
  });

  it('stalled event fires within 21s of the last received event', async () => {
    vi.useFakeTimers();

    const jobId = 'job-stalled-timing';
    insertJob(db, jobId);

    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    // Simulate orchestrator active then silent
    publish(jobId, phaseStarted(jobId, RestorePhase.Sprint));
    publish(jobId, heartbeatEvent(jobId, RestorePhase.Sprint)); // last event from orchestrator

    // Advance exactly STALLED_THRESHOLD_MS + 1s — stalled must have fired by now
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    expect(parseStalledEvent(mock.writes)).toBeDefined();
    expect(mock.isEnded()).toBe(false);
  });

  it('watchdog resets on each forwarded event — no stalled fires under normal heartbeat cadence', async () => {
    vi.useFakeTimers();

    const jobId = 'job-no-stalled';
    insertJob(db, jobId);

    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, phaseStarted(jobId, RestorePhase.Project));

    // Simulate heartbeats every 9s for 63s total (7 ticks) — always within 20s threshold
    for (let i = 0; i < 7; i++) {
      await vi.advanceTimersByTimeAsync(9_000);
      publish(jobId, heartbeatEvent(jobId, RestorePhase.Project));
    }

    // No stalled event should have fired
    expect(mock.writes.find((w) => w.startsWith('event: stalled\n'))).toBeUndefined();
    expect(mock.isEnded()).toBe(false);
  });

  it('stalled event carries lastPhase: null when no phase_started was seen before the stall', async () => {
    vi.useFakeTimers();

    const jobId = 'job-stalled-nophase';
    insertJob(db, jobId);

    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    // No events published at all
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);

    const payload = parseStalledEvent(mock.writes);
    expect(payload).toBeDefined();
    expect(payload!.lastPhase).toBeNull();
    expect(mock.isEnded()).toBe(false);
  });

  it('stream remains open after stalled and closes normally on job_completed', async () => {
    vi.useFakeTimers();

    const jobId = 'job-stalled-recover';
    insertJob(db, jobId);

    const { req } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, phaseStarted(jobId, RestorePhase.Board));

    // Trigger stalled
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 1_000);
    expect(parseStalledEvent(mock.writes)).toBeDefined();
    expect(mock.isEnded()).toBe(false);

    // Orchestrator recovers and completes
    publish(jobId, jobCompleted(jobId));
    expect(mock.isEnded()).toBe(true);
  });

  it('cleanup on disconnect stops the stalled watchdog — no stalled fires after close', async () => {
    vi.useFakeTimers();

    const jobId = 'job-stalled-disconnect';
    insertJob(db, jobId);

    const { req, triggerClose } = makeSseReq(jobId);
    const mock = makeSseRes();
    handleGetJobEvents(req, mock.res);

    publish(jobId, phaseStarted(jobId, RestorePhase.Workflow));

    // Client disconnects before stalled threshold
    triggerClose();

    // Advance well past threshold — no stalled should fire
    await vi.advanceTimersByTimeAsync(STALLED_THRESHOLD_MS + 10_000);
    expect(mock.writes.find((w) => w.startsWith('event: stalled\n'))).toBeUndefined();
  });
});
