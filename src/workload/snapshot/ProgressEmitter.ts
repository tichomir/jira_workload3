/**
 * ProgressEmitter — backup job heartbeat, stalled detection, and terminal status.
 *
 * Persists ProgressEvents to backup_job_events at ≤10 s cadence.
 * A watchdog timer transitions the job to 'stalled' when no heartbeat is
 * observed for >20 s (STALLED_THRESHOLD_MS).
 *
 * Terminal status logic:
 *   errorsCount > 0  → 'completed_with_errors'
 *   errorsCount === 0 → 'completed'
 *   fatal throw       → 'failed'
 *
 * Structured log format:
 *   [backup-job] op=heartbeat|stalled|completed|failed jobId=<id> errors=<n>
 *
 * Source: T5 §6.2, T5 §6.2b.
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../../db/database.js';
import { STALLED_THRESHOLD_MS } from '../types/ProgressEvent.js';
import type { CaptureProgressEvent } from '../backup/types.js';

const WATCHDOG_POLL_MS = 5_000;

export class ProgressEmitter {
  private lastHeartbeatMs: number = Date.now();
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly jobId: string,
    manifestId: string,
    connectionId: string,
    private readonly db: Database.Database = getDb()
  ) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO backup_jobs (jobId, manifestId, connectionId, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(jobId, manifestId, connectionId, now, now);
  }

  /** Transition job to 'running' and start the stalled-detection watchdog. */
  start(): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE backup_jobs SET status = 'running', updatedAt = ? WHERE jobId = ?`)
      .run(now, this.jobId);

    this.lastHeartbeatMs = Date.now();
    console.log(`[backup-job] op=start jobId=${this.jobId} errors=0`);

    this.watchdog = setInterval(() => {
      const silentMs = Date.now() - this.lastHeartbeatMs;
      if (silentMs > STALLED_THRESHOLD_MS) {
        const row = this.db
          .prepare('SELECT status FROM backup_jobs WHERE jobId = ?')
          .get(this.jobId) as { status: string } | undefined;
        if (row?.status === 'running') {
          const ts = new Date().toISOString();
          this.db
            .prepare(`UPDATE backup_jobs SET status = 'stalled', updatedAt = ? WHERE jobId = ?`)
            .run(ts, this.jobId);
          console.log(`[backup-job] op=stalled jobId=${this.jobId} errors=0`);
        }
      }
    }, WATCHDOG_POLL_MS);
  }

  /**
   * Persist a heartbeat event derived from a CaptureProgressEvent.
   * Updates lastEventTs and resets the stalled-detection clock.
   *
   * @param captureEvent  Raw event from CaptureOrchestrator.runCapture().
   * @param errorsCount   Running total of item-level errors at this moment.
   */
  emit(captureEvent: CaptureProgressEvent, errorsCount: number = 0): void {
    const ts = new Date().toISOString();
    const event = {
      jobId: this.jobId,
      ts,
      phase: captureEvent.phase,
      processed: captureEvent.itemsCaptured,
      total: captureEvent.itemsTotal,
      errorsCount,
    };

    this.db
      .prepare(
        `INSERT INTO backup_job_events (id, jobId, ts, phase, processed, total, errorsCount, eventJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        this.jobId,
        ts,
        captureEvent.phase,
        captureEvent.itemsCaptured,
        captureEvent.itemsTotal,
        errorsCount,
        JSON.stringify(event)
      );

    this.db
      .prepare(
        `UPDATE backup_jobs SET lastEventTs = ?, errorsCount = ?, updatedAt = ? WHERE jobId = ?`
      )
      .run(ts, errorsCount, ts, this.jobId);

    this.lastHeartbeatMs = Date.now();
    console.log(`[backup-job] op=heartbeat jobId=${this.jobId} errors=${errorsCount}`);
  }

  /**
   * Terminate the job with a terminal status.
   * Clears the watchdog. Sets 'completed_with_errors' when errorsCount > 0,
   * 'completed' otherwise.
   */
  complete(errorsCount: number): void {
    this._clearWatchdog();
    const status = errorsCount > 0 ? 'completed_with_errors' : 'completed';
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE backup_jobs SET status = ?, errorsCount = ?, updatedAt = ? WHERE jobId = ?`
      )
      .run(status, errorsCount, now, this.jobId);
    console.log(`[backup-job] op=completed jobId=${this.jobId} errors=${errorsCount}`);
  }

  /** Terminate the job as 'failed' (fatal phase error). Clears the watchdog. */
  fail(reason: string): void {
    this._clearWatchdog();
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE backup_jobs SET status = 'failed', updatedAt = ? WHERE jobId = ?`)
      .run(now, this.jobId);
    console.log(`[backup-job] op=failed jobId=${this.jobId} errors=0 reason=${reason}`);
  }

  private _clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }
}
