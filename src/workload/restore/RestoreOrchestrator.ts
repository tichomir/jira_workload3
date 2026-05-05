/**
 * Restore orchestrator — executes dependency-ordered restore phases.
 *
 * Iterates RESTORE_PHASE_ORDER strictly in sequence. On any phase handler
 * throw, emits job_failed { error.code: 'dependency_phase_failed' } and
 * halts — subsequent phases are never started. Emits a structured log line
 * for every phase transition.
 *
 * Before the Board phase, a pre-restore scope re-check guard verifies that
 * both write:board-scope:jira-software variants are present in the stored
 * token scopes. A missing scope emits job_failed and halts identically to a
 * phase handler throw. Source: T1 §1, T5 §5.2, §6.2.
 *
 * ## Interface contract
 *
 * `RestoreOrchestrator` is the concrete implementation of `IRestoreOrchestrator`
 * (src/workload/restore/types.ts). Consumers that require only the interface
 * shape should type variables as `IRestoreOrchestrator`.
 *
 * ## Phase sequence
 *
 * Use `RESTORE_PHASES` (re-exported below) to iterate phases in the mandatory
 * dependency order. Never hardcode the phase list — always iterate this tuple.
 *
 * @example
 * ```ts
 * const orch: RestoreOrchestrator = new RestoreOrchestrator();
 * const result = await orch.runRestore(options, onEvent);
 * ```
 */

import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type IRestoreOrchestrator,
  type RestoreRunOptions,
  type RestoreRunResult,
  type RestoreSseEvent,
  type RestorePhaseResult,
  type GuardResult,
  type TrashStatus,
  type PostIssuePassReport,
} from './types.js';

// ---------------------------------------------------------------------------
// RESTORE_PHASES — canonical, immutable phase sequence (re-export)
// ---------------------------------------------------------------------------

/**
 * Canonical, ordered tuple of all restore phases.
 *
 * Identical to `RESTORE_PHASE_ORDER` from `./types.ts` but re-exported here
 * so that any module importing the orchestrator also gets the phase sequence
 * without a separate import from types.
 *
 * **Invariant**: phases MUST be executed in this exact order; no phase may be
 * skipped or reordered. A failure in any phase halts execution and surfaces a
 * named diagnostic (`phaseDiagnostic`) in `RestoreRunResult`.
 *
 * @example
 * ```ts
 * for (const phase of RESTORE_PHASES) {
 *   // execute phase in dependency order
 * }
 * ```
 *
 * Inputs:  none (compile-time constant)
 * Outputs: readonly tuple of `RestorePhase` values in dependency order
 * Failure: never — constant cannot fail; type error if caller attempts mutation
 *
 * Source: T1 §1, T5 §5.2.
 */
import { checkBoardScopes } from './boardScopeRecheck.js';
import {
  runTrashDetection,
  extractProjectKeys,
  type TrashChecker,
} from './trashDetectionGuard.js';
import {
  runPostIssueCreationPass,
  defaultPostIssuePassDeps,
} from './postIssueCreationPass.js';
import { HeartbeatEmitter } from './HeartbeatEmitter.js';

export const RESTORE_PHASES: readonly RestorePhase[] = RESTORE_PHASE_ORDER;

type PhaseHandler = (
  options: RestoreRunOptions,
  onEvent: (event: RestoreSseEvent) => void
) => Promise<{ restoredCount: number; errorCount: number; postIssuePassReport?: PostIssuePassReport }>;

/**
 * Dependency injection seam for the board-scope guard.
 *
 * Inputs:  `connectionId` — the connection whose stored token scopes to read
 * Outputs: `GuardResult` with `passed: true` when both board-scope variants
 *          are present; `passed: false` with `missingScopes[]` otherwise
 * Failure: synchronous — never throws; always returns `GuardResult`
 */
export type BoardScopeChecker = (connectionId: string) => GuardResult;

/** Default no-op trash checker: assumes all projects are live (not in trash). */
const defaultTrashChecker: TrashChecker = async (projectKey) => ({
  projectId: projectKey,
  projectKey,
  inTrash: false,
  alternateLocationRequired: false,
});

/**
 * Concrete implementation of `IRestoreOrchestrator`.
 *
 * Executes restore phases in the order defined by `RESTORE_PHASES`. On any
 * phase failure it emits `job_failed` with `error.code: 'dependency_phase_failed'`
 * and halts — no subsequent phase is started.
 *
 * ## Constructor injection
 *
 * All three constructor parameters are optional; defaults are production-ready.
 * Replace them in tests to avoid DB/HTTP side effects.
 *
 * @param handlers        Per-phase handler map. Phases absent from the map run
 *                        a no-op stub (returns restoredCount=0, errorCount=0).
 * @param boardScopeChecker Guard function called immediately before the Board
 *                        phase. Defaults to the DB-backed `checkBoardScopes`.
 * @param trashChecker    Async checker called for each project in the selection
 *                        during the Project phase. Defaults to a no-op (treats
 *                        all projects as live, not in trash).
 *
 * ## runRestore inputs
 *
 * @param options `RestoreRunOptions` — jobId, connectionId, cloudId, cloudBaseUrl,
 *                backupPointId, selection, conflictMode, destination,
 *                alternateDestination (when destination==='alternate').
 * @param onEvent Callback invoked with every `RestoreSseEvent` in phase order.
 *                The router layer forwards these to the SSE stream.
 *
 * ## runRestore outputs
 *
 * Returns `RestoreRunResult` with:
 *  - `restoredCount` — total items successfully restored across all phases
 *  - `errorCount` — total item-level errors; when >0 the UI shows "Completed with N errors"
 *  - `phaseDiagnostic` — human-readable halt reason; present when any phase failed
 *  - `trashDetectionResults` — one entry per project found in native trash
 *  - `postIssuePassReport` — per-item counts from the post-issue-creation pass
 *
 * ## Failure modes
 *
 * - Phase handler throws → emits `job_failed`, populates `phaseDiagnostic`, returns immediately.
 * - Board scope re-check fails → same `job_failed` path; Sprint/Issue phases are never started.
 * - Trash detection (Project phase) → NOT a failure; forces `destination='alternate'` and continues.
 *
 * Source: T1 §1, T5 §5.2, §6.2.
 */
export class RestoreOrchestrator implements IRestoreOrchestrator {
  private readonly handlers: Map<RestorePhase, PhaseHandler>;
  private readonly boardScopeChecker: BoardScopeChecker;
  private readonly trashChecker: TrashChecker;

  constructor(
    handlers?: Partial<Record<RestorePhase, PhaseHandler>>,
    boardScopeChecker?: BoardScopeChecker,
    trashChecker?: TrashChecker
  ) {
    this.handlers = new Map<RestorePhase, PhaseHandler>();
    for (const phase of RESTORE_PHASE_ORDER) {
      if (phase === RestorePhase.CommentAttachmentSubtaskIssuelink) {
        this.handlers.set(phase, handlers?.[phase] ?? makePostIssuePassHandler());
      } else {
        this.handlers.set(phase, handlers?.[phase] ?? makeStubHandler(phase));
      }
    }
    this.boardScopeChecker = boardScopeChecker ?? checkBoardScopes;
    this.trashChecker = trashChecker ?? defaultTrashChecker;
  }

  async runRestore(
    options: RestoreRunOptions,
    onEvent: (event: RestoreSseEvent) => void
  ): Promise<RestoreRunResult> {
    const { jobId } = options;
    const phaseResults: RestorePhaseResult[] = [];
    let totalRestoredCount = 0;
    let totalErrorCount = 0;
    const allTrashStatuses: TrashStatus[] = [];
    let capturedPostIssuePassReport: PostIssuePassReport | undefined;

    // effectiveOptions may be updated by guards (e.g. trash detection forces alternate).
    let effectiveOptions: RestoreRunOptions = { ...options };

    const heartbeat = new HeartbeatEmitter(jobId, onEvent);

    for (const phase of RESTORE_PHASE_ORDER) {
      // -----------------------------------------------------------------------
      // Pre-phase guard: trash detection (runs immediately before Project phase)
      // Forces destination to 'alternate' when a project is in the 30–60d
      // Atlassian trash window and destination === 'original'. Does NOT halt.
      // Source: T5 §4.2.
      // -----------------------------------------------------------------------
      if (phase === RestorePhase.Project) {
        const projectKeys = extractProjectKeys(effectiveOptions.selection);
        if (projectKeys.length > 0) {
          const { trashStatuses, forcedAlternate } = await runTrashDetection(
            projectKeys,
            effectiveOptions.destination,
            this.trashChecker
          );
          allTrashStatuses.push(...trashStatuses);
          if (forcedAlternate) {
            console.log(
              `[restore] guard=trash-detection jobId=${jobId} forcing destination=alternate`
            );
            effectiveOptions = { ...effectiveOptions, destination: 'alternate' };
          }
        }
      }

      // Pre-restore scope re-check guard runs immediately before Board phase.
      if (phase === RestorePhase.Board) {
        const guardResult = this.boardScopeChecker(effectiveOptions.connectionId);
        if (!guardResult.passed) {
          const failedTs = new Date().toISOString();
          const message = guardResult.failureMessage ?? 'board scope check failed';
          const diagnostic = `${phase} phase: ${message}`;

          console.log(
            `[restore] phase=${phase} outcome=fail jobId=${jobId} guard=board-scope-recheck`
          );
          heartbeat.stop();
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
            trashDetectionResults: allTrashStatuses.length > 0 ? allTrashStatuses : undefined,
          };
        }
      }

      const startedTs = new Date().toISOString();
      console.log(`[restore] phase=${phase} outcome=start jobId=${jobId}`);
      onEvent({ type: 'phase_started', jobId, ts: startedTs, phase });
      heartbeat.start(phase);

      const handler = this.handlers.get(phase)!;

      try {
        const result = await handler(effectiveOptions, onEvent);

        heartbeat.stop();
        const completedTs = new Date().toISOString();
        console.log(`[restore] phase=${phase} outcome=complete jobId=${jobId}`);
        onEvent({
          type: 'phase_completed',
          jobId,
          ts: completedTs,
          phase,
          restoredCount: result.restoredCount,
          errorCount: result.errorCount,
        });

        if (result.postIssuePassReport) {
          capturedPostIssuePassReport = result.postIssuePassReport;
        }

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

        heartbeat.stop();
        console.log(`[restore] phase=${phase} outcome=fail jobId=${jobId}`);
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
          trashDetectionResults: allTrashStatuses.length > 0 ? allTrashStatuses : undefined,
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
      trashDetectionResults: allTrashStatuses.length > 0 ? allTrashStatuses : undefined,
      postIssuePassReport: capturedPostIssuePassReport,
    };
  }
}

function makePostIssuePassHandler(): PhaseHandler {
  return async (options, onEvent) => {
    const { restoredCount, errorCount, report } = await runPostIssueCreationPass(
      options,
      onEvent,
      defaultPostIssuePassDeps
    );
    return { restoredCount, errorCount, postIssuePassReport: report };
  };
}

function makeStubHandler(phase: RestorePhase): PhaseHandler {
  return async (_options, _onEvent) => {
    console.log(`[restore] phase=${phase} stub-handler running`);
    return { restoredCount: 0, errorCount: 0 };
  };
}
