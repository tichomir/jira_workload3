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

type PhaseHandler = (
  options: RestoreRunOptions,
  onEvent: (event: RestoreSseEvent) => void
) => Promise<{ restoredCount: number; errorCount: number; postIssuePassReport?: PostIssuePassReport }>;

/** Injected for testability; defaults to the real DB-backed scope checker. */
export type BoardScopeChecker = (connectionId: string) => GuardResult;

/** Default no-op trash checker: assumes all projects are live (not in trash). */
const defaultTrashChecker: TrashChecker = async (projectKey) => ({
  projectId: projectKey,
  projectKey,
  inTrash: false,
});

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
            `[restore] phase=${phase} outcome=failed jobId=${jobId} guard=board-scope-recheck`
          );
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
      console.log(`[restore] phase=${phase} outcome=started jobId=${jobId}`);
      onEvent({ type: 'phase_started', jobId, ts: startedTs, phase });

      const handler = this.handlers.get(phase)!;

      try {
        const result = await handler(effectiveOptions, onEvent);

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
