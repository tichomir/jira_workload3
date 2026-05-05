/**
 * Restore orchestrator — executes dependency-ordered restore phases.
 *
 * Iterates RESTORE_PHASE_ORDER strictly in sequence. On any phase handler
 * throw, emits job_failed { error.code: 'dependency_phase_failed' } and
 * halts — subsequent phases are never started. Emits a structured log line
 * for every phase transition. Source: T1 §1, T5 §5.2, §6.2.
 */

import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type IRestoreOrchestrator,
  type RestoreRunOptions,
  type RestoreRunResult,
  type RestoreSseEvent,
  type RestorePhaseResult,
} from './types.js';

type PhaseHandler = (
  options: RestoreRunOptions,
  onEvent: (event: RestoreSseEvent) => void
) => Promise<{ restoredCount: number; errorCount: number }>;

export class RestoreOrchestrator implements IRestoreOrchestrator {
  private readonly handlers: Map<RestorePhase, PhaseHandler>;

  constructor(handlers?: Partial<Record<RestorePhase, PhaseHandler>>) {
    this.handlers = new Map<RestorePhase, PhaseHandler>();
    for (const phase of RESTORE_PHASE_ORDER) {
      this.handlers.set(phase, handlers?.[phase] ?? makeStubHandler(phase));
    }
  }

  async runRestore(
    options: RestoreRunOptions,
    onEvent: (event: RestoreSseEvent) => void
  ): Promise<RestoreRunResult> {
    const { jobId } = options;
    const phaseResults: RestorePhaseResult[] = [];
    let totalRestoredCount = 0;
    let totalErrorCount = 0;

    for (const phase of RESTORE_PHASE_ORDER) {
      const startedTs = new Date().toISOString();
      console.log(`[restore] phase=${phase} outcome=started jobId=${jobId}`);
      onEvent({ type: 'phase_started', jobId, ts: startedTs, phase });

      const handler = this.handlers.get(phase)!;

      try {
        const result = await handler(options, onEvent);

        const completedTs = new Date().toISOString();
        console.log(`[restore] phase=${phase} outcome=completed jobId=${jobId}`);
        onEvent({
          type: 'phase_completed',
          jobId,
          ts: completedTs,
          phase,
          restoredCount: result.restoredCount,
          errorCount: result.errorCount,
        });

        phaseResults.push({
          phase,
          status: result.errorCount > 0 ? 'partial' : 'ok',
          restoredCount: result.restoredCount,
          errorCount: result.errorCount,
        });
        totalRestoredCount += result.restoredCount;
        totalErrorCount += result.errorCount;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failedTs = new Date().toISOString();
        const diagnostic = `${phase} phase: ${message}`;

        console.log(`[restore] phase=${phase} outcome=failed jobId=${jobId}`);
        onEvent({
          type: 'job_failed',
          jobId,
          ts: failedTs,
          error: { code: 'dependency_phase_failed', phase, message },
        });

        phaseResults.push({
          phase,
          status: 'failed',
          restoredCount: 0,
          errorCount: 1,
          diagnostic,
        });
        totalErrorCount++;

        return {
          jobId,
          completedAt: failedTs,
          phaseResults,
          restoredCount: totalRestoredCount,
          errorCount: totalErrorCount,
          phaseDiagnostic: diagnostic,
        };
      }
    }

    const completedAt = new Date().toISOString();
    onEvent({
      type: 'job_completed',
      jobId,
      ts: completedAt,
      errors: totalErrorCount,
      restoredCount: totalRestoredCount,
    });

    return {
      jobId,
      completedAt,
      phaseResults,
      restoredCount: totalRestoredCount,
      errorCount: totalErrorCount,
    };
  }
}

function makeStubHandler(phase: RestorePhase): PhaseHandler {
  return async (_options, _onEvent) => {
    console.log(`[restore] phase=${phase} stub-handler running`);
    return { restoredCount: 0, errorCount: 0 };
  };
}
