/**
 * HeartbeatEmitter — periodic heartbeat for the restore SSE event stream.
 *
 * Fires {type:'heartbeat', jobId, ts, currentPhase} every HEARTBEAT_INTERVAL_MS
 * (10 s) while a restore phase handler is executing. Call stop() at each phase
 * boundary to clear the interval and avoid duplicate events.
 *
 * Source: T5 §6.2.
 */

import type { HeartbeatEvent, RestorePhase, RestoreSseEvent } from './types.js';

/** Heartbeat cadence: emitted every 10 s during an active phase. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Emits periodic heartbeat events into the restore SSE stream.
 *
 * Usage inside RestoreOrchestrator.runRestore():
 *   1. Call start(phase) immediately after emitting the phase_started event.
 *   2. Call stop() immediately before emitting phase_completed or job_failed.
 *
 * The emitter is re-entrant: calling start() while already running stops the
 * previous interval before starting a new one.
 */
export class HeartbeatEmitter {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jobId: string,
    private readonly onEvent: (event: RestoreSseEvent) => void
  ) {}

  /** Start ticking heartbeats for the given phase. Clears any previous interval. */
  start(phase: RestorePhase): void {
    this.stop();
    this.timer = setInterval(() => {
      const event: HeartbeatEvent = {
        type: 'heartbeat',
        jobId: this.jobId,
        ts: new Date().toISOString(),
        currentPhase: phase,
      };
      this.onEvent(event);
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat ticker. Safe to call when already stopped. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
