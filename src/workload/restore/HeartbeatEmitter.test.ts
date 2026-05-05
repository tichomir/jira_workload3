import { describe, it, expect, vi, afterEach } from 'vitest';
import { HeartbeatEmitter, HEARTBEAT_INTERVAL_MS } from './HeartbeatEmitter.js';
import { RestoreOrchestrator } from './RestoreOrchestrator.js';
import {
  RestorePhase,
  type RestoreSseEvent,
  type HeartbeatEvent,
  type GuardResult,
  type RestoreRunOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const alwaysPassChecker = (_connectionId: string): GuardResult => ({
  passed: true,
  guardName: 'board-scope-recheck',
});

function makeOptions(): RestoreRunOptions {
  return {
    jobId: 'hb-job',
    connectionId: 'conn-1',
    cloudId: 'cloud-1',
    cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-1',
    backupPointId: 'bp-1',
    selection: [],
    conflictMode: 'skip',
    destination: 'original',
  };
}

function heartbeats(events: RestoreSseEvent[]): HeartbeatEvent[] {
  return events.filter((e): e is HeartbeatEvent => e.type === 'heartbeat');
}

// ---------------------------------------------------------------------------
// HeartbeatEmitter — unit tests (standalone)
// ---------------------------------------------------------------------------

describe('HeartbeatEmitter — standalone cadence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits at least one heartbeat within HEARTBEAT_INTERVAL_MS + 1 s of start()', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];
    const emitter = new HeartbeatEmitter('job-1', (ev) => events.push(ev));

    emitter.start(RestorePhase.SiteReferenceData);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);

    const hbs = heartbeats(events);
    expect(hbs.length).toBeGreaterThanOrEqual(1);
    expect(hbs[0].type).toBe('heartbeat');
    expect(hbs[0].jobId).toBe('job-1');
    expect(typeof hbs[0].ts).toBe('string');
    expect(hbs[0].currentPhase).toBe(RestorePhase.SiteReferenceData);

    emitter.stop();
  });

  it('ticks every ~10 s: ≥2 heartbeats after 21 s, ≥3 after 31 s', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];
    const emitter = new HeartbeatEmitter('job-1', (ev) => events.push(ev));

    emitter.start(RestorePhase.Issue);

    await vi.advanceTimersByTimeAsync(21_000);
    expect(heartbeats(events).length).toBeGreaterThanOrEqual(2);

    await vi.advanceTimersByTimeAsync(10_000); // total 31 s
    expect(heartbeats(events).length).toBeGreaterThanOrEqual(3);

    emitter.stop();
  });

  it('stops emitting after stop() — no new events beyond the stop point', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];
    const emitter = new HeartbeatEmitter('job-1', (ev) => events.push(ev));

    emitter.start(RestorePhase.Project);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    const countBefore = heartbeats(events).length;
    expect(countBefore).toBeGreaterThanOrEqual(1);

    emitter.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeats(events).length).toBe(countBefore);
  });

  it('heartbeat carries currentPhase matching the phase passed to start()', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];
    const emitter = new HeartbeatEmitter('job-42', (ev) => events.push(ev));

    emitter.start(RestorePhase.Board);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);

    const hb = heartbeats(events)[0];
    expect(hb).toBeDefined();
    expect(hb.currentPhase).toBe(RestorePhase.Board);
    expect(hb.jobId).toBe('job-42');

    emitter.stop();
  });

  it('re-entrant start() replaces the running interval with the new phase', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];
    const emitter = new HeartbeatEmitter('job-1', (ev) => events.push(ev));

    emitter.start(RestorePhase.Project);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    expect(heartbeats(events).some(e => e.currentPhase === RestorePhase.Project)).toBe(true);

    emitter.start(RestorePhase.Workflow); // replaces the previous interval
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 1_000);
    expect(heartbeats(events).some(e => e.currentPhase === RestorePhase.Workflow)).toBe(true);

    emitter.stop();
  });
});

// ---------------------------------------------------------------------------
// HeartbeatEmitter — integration with RestoreOrchestrator
// ---------------------------------------------------------------------------

describe('HeartbeatEmitter — integration via RestoreOrchestrator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits at least one heartbeat within 11 s of phase start during a long-running phase', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];

    // Long-running handler: resolves after 25 s (timer-controlled so fake timers work)
    const longHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 25_000));
      return { restoredCount: 0, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.SiteReferenceData]: longHandler },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    // Advance to 11 s: heartbeat interval fires at 10 s; handler still running (needs 25 s)
    await vi.advanceTimersByTimeAsync(11_000);

    const hbs = heartbeats(events);
    expect(hbs.length).toBeGreaterThanOrEqual(1);
    expect(hbs[0].currentPhase).toBe(RestorePhase.SiteReferenceData);
    expect(hbs[0].jobId).toBe('hb-job');

    // Let the handler and all remaining phases complete
    await vi.advanceTimersByTimeAsync(25_000);
    await restorePromise;
  });

  it('ticks every ~10 s throughout the phase — at least 2 heartbeats after 21 s', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];

    const longHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 35_000));
      return { restoredCount: 0, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.SiteReferenceData]: longHandler },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    await vi.advanceTimersByTimeAsync(21_000);
    expect(heartbeats(events).length).toBeGreaterThanOrEqual(2);

    await vi.advanceTimersByTimeAsync(20_000); // resolve the long handler
    await restorePromise;
  });

  it('heartbeat stops after phase ends — no heartbeats emitted between phases', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];

    // First phase takes 15 s, second phase is instant
    let secondPhaseStarted = false;
    const firstHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
      return { restoredCount: 0, errorCount: 0 };
    };
    const secondHandler = async () => {
      secondPhaseStarted = true;
      return { restoredCount: 0, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.SiteReferenceData]: firstHandler,
        [RestorePhase.Project]: secondHandler,
      },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    // Run first phase to completion
    await vi.advanceTimersByTimeAsync(16_000);
    expect(secondPhaseStarted).toBe(true);

    // Snapshot heartbeats right after first phase ends — all should carry SiteReferenceData
    const hbsAfterFirstPhase = heartbeats(events);
    expect(hbsAfterFirstPhase.every(h => h.currentPhase === RestorePhase.SiteReferenceData)).toBe(true);

    // Complete the rest of the job
    await vi.runAllTimersAsync();
    await restorePromise;
  });

  it('currentPhase in heartbeat matches the RESTORE_PHASES entry in progress', async () => {
    vi.useFakeTimers();
    const events: RestoreSseEvent[] = [];

    // Make the Board phase long-running so heartbeats carry 'board'
    const boardHandler = async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20_000));
      return { restoredCount: 0, errorCount: 0 };
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.Board]: boardHandler },
      alwaysPassChecker
    );

    const restorePromise = orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    // Run all phases up to Board instantly, then advance into Board phase
    // Board is at index 4; we need to let the first 4 stub phases complete first.
    // Stub handlers return immediately, so one tick is enough.
    await vi.advanceTimersByTimeAsync(0); // let synchronous/microtask phases run

    // Now advance 11 s to get a heartbeat during the Board phase
    await vi.advanceTimersByTimeAsync(11_000);

    const boardHeartbeats = heartbeats(events).filter(
      (h) => h.currentPhase === RestorePhase.Board
    );
    expect(boardHeartbeats.length).toBeGreaterThanOrEqual(1);
    expect(boardHeartbeats[0].currentPhase).toBe(RestorePhase.Board);

    // Complete the job
    await vi.advanceTimersByTimeAsync(20_000);
    await restorePromise;
  });
});
