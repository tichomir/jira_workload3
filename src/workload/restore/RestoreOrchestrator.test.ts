import { describe, it, expect } from 'vitest';
import { RestoreOrchestrator } from './RestoreOrchestrator.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type RestoreRunOptions,
  type JobFailedEvent,
  type GuardResult,
  type PostIssueSubPhaseEvent,
} from './types.js';
import {
  runPostIssueCreationPass,
  type PostIssueItemData,
  type PostIssueDataLoader,
  type RestoreCommentFn,
  type RestoreIssueLinkFn,
} from './postIssueCreationPass.js';

/** Mock scope checker that always passes — used in phase-ordering tests. */
const alwaysPassChecker = (_connectionId: string): GuardResult => ({
  passed: true,
  guardName: 'board-scope-recheck',
});

/** Mock scope checker that always fails with both scopes missing. */
const alwaysFailChecker = (_connectionId: string): GuardResult => ({
  passed: false,
  guardName: 'board-scope-recheck',
  failureCode: 'scope_missing',
  failureMessage:
    'Missing required board scope(s): write:board-scope:jira-software, write:board-scope.admin:jira-software',
  missingScopes: [
    'write:board-scope:jira-software',
    'write:board-scope.admin:jira-software',
  ],
});

function makeOptions(): RestoreRunOptions {
  return {
    jobId: 'test-job-id',
    connectionId: 'conn-1',
    cloudId: 'cloud-1',
    cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-1',
    backupPointId: 'bp-1',
    selection: ['PROJ-1'],
    conflictMode: 'skip',
    destination: 'original',
  };
}

describe('RestoreOrchestrator', () => {
  it('(a) executes all phases in exact dependency order on success', async () => {
    const phasesStarted: RestorePhase[] = [];
    const phasesCompleted: RestorePhase[] = [];
    const events: RestoreSseEvent[] = [];

    const orchestrator = new RestoreOrchestrator(undefined, alwaysPassChecker);
    const result = await orchestrator.runRestore(makeOptions(), (ev) => {
      events.push(ev);
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
      if (ev.type === 'phase_completed') phasesCompleted.push(ev.phase);
    });

    // All 8 phases started in canonical order
    expect(phasesStarted).toEqual([...RESTORE_PHASE_ORDER]);

    // All 8 phases completed in canonical order
    expect(phasesCompleted).toEqual([...RESTORE_PHASE_ORDER]);

    // Final event is job_completed (not job_failed)
    expect(events[events.length - 1].type).toBe('job_completed');

    // Result has a phase result for every phase
    expect(result.phaseResults).toHaveLength(RESTORE_PHASE_ORDER.length);
    expect(result.phaseResults.every((r) => r.status === 'ok')).toBe(true);

    // No phaseDiagnostic on success
    expect(result.phaseDiagnostic).toBeUndefined();
  });

  it('(b) failure in phase N halts execution — downstream phases N+1..end never run', async () => {
    const phasesStarted: RestorePhase[] = [];
    const events: RestoreSseEvent[] = [];

    // Fail at Workflow (index 2 of 8)
    const failingPhase = RestorePhase.Workflow;
    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.Workflow]: async () => {
          throw new Error('workflow restore error');
        },
      },
      alwaysPassChecker
    );

    const result = await orchestrator.runRestore(makeOptions(), (ev) => {
      events.push(ev);
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
    });

    const failingIndex = RESTORE_PHASE_ORDER.indexOf(failingPhase);

    // Phases up to and including the failing one started
    expect(phasesStarted).toEqual(RESTORE_PHASE_ORDER.slice(0, failingIndex + 1));

    // Downstream phases never started
    const downstream = RESTORE_PHASE_ORDER.slice(failingIndex + 1);
    for (const phase of downstream) {
      expect(phasesStarted).not.toContain(phase);
    }

    // job_failed emitted; job_completed never emitted
    expect(events.some((e) => e.type === 'job_failed')).toBe(true);
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // phaseDiagnostic set and contains the failing phase name
    expect(result.phaseDiagnostic).toBeDefined();
    expect(result.phaseDiagnostic).toContain(failingPhase);

    // Only phases up through the failing one have results
    expect(result.phaseResults).toHaveLength(failingIndex + 1);
    const lastResult = result.phaseResults[failingIndex];
    expect(lastResult.status).toBe('failed');
  });

  it('(c) job_failed event has correct error payload', async () => {
    const events: RestoreSseEvent[] = [];
    const failingPhase = RestorePhase.Issue;
    const options = makeOptions();

    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.Issue]: async () => {
          throw new Error('issue write failed');
        },
      },
      alwaysPassChecker
    );

    await orchestrator.runRestore(options, (ev) => events.push(ev));

    const failedEvent = events.find((e) => e.type === 'job_failed') as JobFailedEvent | undefined;
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.type).toBe('job_failed');
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(failingPhase);
    expect(failedEvent!.error.message).toBe('issue write failed');
    expect(failedEvent!.jobId).toBe(options.jobId);
    expect(typeof failedEvent!.ts).toBe('string');
  });

  it('mid-chain failure: phases after the failed one are not started (first phase failing)', async () => {
    const phasesStarted: RestorePhase[] = [];

    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.SiteReferenceData]: async () => {
          throw new Error('site ref data unavailable');
        },
      },
      alwaysPassChecker
    );

    await orchestrator.runRestore(makeOptions(), (ev) => {
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
    });

    // Only the first phase starts
    expect(phasesStarted).toHaveLength(1);
    expect(phasesStarted[0]).toBe(RestorePhase.SiteReferenceData);
  });
});

// ---------------------------------------------------------------------------
// Board-scope re-check guard tests
// ---------------------------------------------------------------------------

describe('RestoreOrchestrator — board-scope-recheck guard', () => {
  it('happy path: both scopes present — Board phase proceeds normally', async () => {
    const phasesStarted: RestorePhase[] = [];
    const events: RestoreSseEvent[] = [];

    // Both scopes present
    const scopeChecker = (_connectionId: string): GuardResult => ({
      passed: true,
      guardName: 'board-scope-recheck',
    });

    const orchestrator = new RestoreOrchestrator(undefined, scopeChecker);
    const result = await orchestrator.runRestore(makeOptions(), (ev) => {
      events.push(ev);
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
    });

    // Board phase was started
    expect(phasesStarted).toContain(RestorePhase.Board);

    // No job_failed emitted
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // job_completed emitted
    expect(events[events.length - 1].type).toBe('job_completed');

    // All phases have results
    expect(result.phaseResults).toHaveLength(RESTORE_PHASE_ORDER.length);
    expect(result.phaseDiagnostic).toBeUndefined();
  });

  it('missing scope: job_failed emitted with phase=board, downstream phases not started', async () => {
    const phasesStarted: RestorePhase[] = [];
    const events: RestoreSseEvent[] = [];

    const orchestrator = new RestoreOrchestrator(undefined, alwaysFailChecker);
    const result = await orchestrator.runRestore(makeOptions(), (ev) => {
      events.push(ev);
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
    });

    // Board phase was NOT started (guard fired before phase_started)
    expect(phasesStarted).not.toContain(RestorePhase.Board);

    // Phases before Board were started
    const boardIndex = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Board);
    for (const phase of RESTORE_PHASE_ORDER.slice(0, boardIndex)) {
      expect(phasesStarted).toContain(phase);
    }

    // Phases after Board were NOT started
    for (const phase of RESTORE_PHASE_ORDER.slice(boardIndex + 1)) {
      expect(phasesStarted).not.toContain(phase);
    }

    // job_failed emitted
    const failedEvent = events.find((e) => e.type === 'job_failed') as JobFailedEvent | undefined;
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(RestorePhase.Board);
    expect(failedEvent!.error.message).toContain('Missing required board scope');

    // job_completed NOT emitted
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // phaseDiagnostic present and references the board phase
    expect(result.phaseDiagnostic).toBeDefined();
    expect(result.phaseDiagnostic).toContain(RestorePhase.Board);

    // Phase result for board is 'failed'
    const boardResult = result.phaseResults.find((r) => r.phase === RestorePhase.Board);
    expect(boardResult).toBeDefined();
    expect(boardResult!.status).toBe('failed');
  });

  it('missing only one scope: job_failed still emitted with scope listed in message', async () => {
    const events: RestoreSseEvent[] = [];

    // Only the .admin variant is missing
    const partialFailChecker = (_connectionId: string): GuardResult => ({
      passed: false,
      guardName: 'board-scope-recheck',
      failureCode: 'scope_missing',
      failureMessage:
        'Missing required board scope(s): write:board-scope.admin:jira-software',
      missingScopes: ['write:board-scope.admin:jira-software'],
    });

    const orchestrator = new RestoreOrchestrator(undefined, partialFailChecker);
    await orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    const failedEvent = events.find((e) => e.type === 'job_failed') as JobFailedEvent | undefined;
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(RestorePhase.Board);
    expect(failedEvent!.error.message).toContain('write:board-scope.admin:jira-software');
  });

  it('guard connectionId is forwarded to the scope checker', async () => {
    const capturedConnectionIds: string[] = [];
    const options = { ...makeOptions(), connectionId: 'conn-42' };

    const capturingChecker = (connectionId: string): GuardResult => {
      capturedConnectionIds.push(connectionId);
      return { passed: true, guardName: 'board-scope-recheck' };
    };

    const orchestrator = new RestoreOrchestrator(undefined, capturingChecker);
    await orchestrator.runRestore(options, () => {});

    expect(capturedConnectionIds).toContain('conn-42');
  });
});

// ---------------------------------------------------------------------------
// Post-issue-creation pass tests
// ---------------------------------------------------------------------------

function makePostIssueHandler(
  items: PostIssueItemData[],
  restoreComment: RestoreCommentFn = async () => {},
  restoreIssueLink: RestoreIssueLinkFn = async () => {}
) {
  return async (
    options: RestoreRunOptions,
    onEvent: (event: RestoreSseEvent) => void
  ) => {
    const loader: PostIssueDataLoader = async () => items;
    const { restoredCount, errorCount, report } = await runPostIssueCreationPass(
      options,
      onEvent,
      { loadItems: loader, restoreComment, restoreIssueLink }
    );
    return { restoredCount, errorCount, postIssuePassReport: report };
  };
}

describe('RestoreOrchestrator — post-issue-creation pass', () => {
  it('happy path: emits comment → subtask → issuelink sub-phase events strictly after issue phase_completed', async () => {
    const events: RestoreSseEvent[] = [];

    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [{ id: 'c1', body: 'hello' }],
        subtaskLinks: [{ linkType: 'subtask', inwardIssueKey: 'PROJ-2' }],
        issueLinks: [{ linkType: 'blocks', outwardIssueKey: 'PROJ-3' }],
      },
    ];

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssueHandler(items) },
      alwaysPassChecker
    );
    await orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    // Find the issue phase_completed event index
    const issueCompletedIdx = events.findIndex(
      (e) => e.type === 'phase_completed' && (e as { phase?: string }).phase === RestorePhase.Issue
    );
    expect(issueCompletedIdx).toBeGreaterThanOrEqual(0);

    // All three sub-phase events must appear after issue phase_completed
    const subPhaseEvents = events
      .slice(issueCompletedIdx + 1)
      .filter((e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase');

    expect(subPhaseEvents).toHaveLength(3);
    expect(subPhaseEvents[0].subPhase).toBe('comment');
    expect(subPhaseEvents[1].subPhase).toBe('subtask');
    expect(subPhaseEvents[2].subPhase).toBe('issuelink');

    // Terminal event is job_completed
    expect(events[events.length - 1].type).toBe('job_completed');
  });

  it('happy path: postIssuePassReport counts are correct', async () => {
    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [{ id: 'c1' }, { id: 'c2' }],
        subtaskLinks: [{ linkType: 'subtask', inwardIssueKey: 'PROJ-2' }],
        issueLinks: [
          { linkType: 'blocks', outwardIssueKey: 'PROJ-3' },
          { linkType: 'relates to', outwardIssueKey: 'PROJ-4' },
        ],
      },
    ];

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssueHandler(items) },
      alwaysPassChecker
    );
    const result = await orchestrator.runRestore(makeOptions(), () => {});

    expect(result.postIssuePassReport).toBeDefined();
    const report = result.postIssuePassReport!;
    expect(report.commentsRestored).toBe(2);
    expect(report.commentErrors).toBe(0);
    expect(report.subtaskLinksRestored).toBe(1);
    expect(report.subtaskLinkErrors).toBe(0);
    expect(report.issueLinksRestored).toBe(2);
    expect(report.issueLinkErrors).toBe(0);
    expect(report.adfMediaLinkWarning).toBe(false);
    expect(report.adfMediaLinkAffectedIssueKeys).toHaveLength(0);

    // aggregate counts flow through
    expect(result.restoredCount).toBe(5); // 2 comments + 1 subtask + 2 links
    expect(result.errorCount).toBe(0);
  });

  it('partial failure: per-item errors are counted and logged but do not halt the pass', async () => {
    const events: RestoreSseEvent[] = [];
    let errorLogCount = 0;
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      if (String(args[0]).includes('[restore] post-issue-pass')) errorLogCount++;
      origLog(...args);
    };

    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [{ id: 'c1' }, { id: 'c2' }],
        subtaskLinks: [{ linkType: 'subtask', inwardIssueKey: 'PROJ-2' }],
        issueLinks: [{ linkType: 'blocks', outwardIssueKey: 'PROJ-3' }],
      },
    ];

    // First comment and the subtask link fail; second comment and issue link succeed
    let commentCallCount = 0;
    const restoreComment: RestoreCommentFn = async (_key, _comment) => {
      commentCallCount++;
      if (commentCallCount === 1) throw new Error('comment API error');
    };

    let subtaskCallCount = 0;
    const restoreIssueLink: RestoreIssueLinkFn = async (linkType) => {
      if (linkType === 'subtask') {
        subtaskCallCount++;
        throw new Error('subtask link API error');
      }
    };

    try {
      const orchestrator = new RestoreOrchestrator(
        { [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssueHandler(items, restoreComment, restoreIssueLink) },
        alwaysPassChecker
      );
      const result = await orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

      // Terminal event is job_completed (NOT job_failed — errors are item-level, not phase-level)
      const terminal = events[events.length - 1];
      expect(terminal.type).toBe('job_completed');

      const completed = terminal as { type: string; errors: number; restoredCount: number };
      expect(completed.errors).toBeGreaterThan(0);

      const report = result.postIssuePassReport!;
      expect(report.commentsRestored).toBe(1);   // second comment succeeded
      expect(report.commentErrors).toBe(1);       // first comment failed
      expect(report.subtaskLinksRestored).toBe(0);
      expect(report.subtaskLinkErrors).toBe(1);
      expect(report.issueLinksRestored).toBe(1);  // blocks link succeeded
      expect(report.issueLinkErrors).toBe(0);

      // All three sub-phase events were still emitted (pass was not halted)
      const subPhases = events
        .filter((e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase')
        .map((e) => e.subPhase);
      expect(subPhases).toEqual(['comment', 'subtask', 'issuelink']);

      // Error counts visible in sub-phase events
      const commentSubPhase = events.find(
        (e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase' && e.subPhase === 'comment'
      )!;
      expect(commentSubPhase.errors).toBe(1);
      expect(commentSubPhase.restored).toBe(1);
      expect(commentSubPhase.attempted).toBe(2);

      // Aggregate error count propagates to job result
      expect(result.errorCount).toBeGreaterThan(0);
    } finally {
      console.log = origLog;
    }
  });

  it('Completed with N errors: job_completed.errors reflects total error count', async () => {
    const events: RestoreSseEvent[] = [];

    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [{ id: 'c1' }],
        subtaskLinks: [],
        issueLinks: [],
      },
    ];

    const alwaysFailComment: RestoreCommentFn = async () => {
      throw new Error('network timeout');
    };

    const orchestrator = new RestoreOrchestrator(
      { [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssueHandler(items, alwaysFailComment) },
      alwaysPassChecker
    );
    const result = await orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    const completedEvent = events.find((e) => e.type === 'job_completed') as
      | { type: string; errors: number; restoredCount: number }
      | undefined;

    expect(completedEvent).toBeDefined();
    expect(completedEvent!.errors).toBe(1);

    // Phase result for the pass is 'partial' (errors > 0 but did not throw)
    const passResult = result.phaseResults.find(
      (r) => r.phase === RestorePhase.CommentAttachmentSubtaskIssuelink
    );
    expect(passResult).toBeDefined();
    expect(passResult!.status).toBe('partial');
    expect(passResult!.errorCount).toBe(1);

    // Aggregate errorCount > 0 → UI should display "Completed with N errors"
    expect(result.errorCount).toBe(1);
    expect(result.phaseDiagnostic).toBeUndefined(); // not a hard failure
  });

  it('empty selection: no sub-phase errors, zero counts in report', async () => {
    const events: RestoreSseEvent[] = [];

    // No items (empty backup point)
    const orchestrator = new RestoreOrchestrator(
      {
        [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssueHandler([]),
      },
      alwaysPassChecker
    );
    const result = await orchestrator.runRestore(makeOptions(), (ev) => events.push(ev));

    const subPhases = events.filter(
      (e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase'
    );
    // Still emits 3 sub-phase events (comment, subtask, issuelink) with zero counts
    expect(subPhases).toHaveLength(3);
    expect(subPhases.every((e) => e.restored === 0 && e.errors === 0 && e.attempted === 0)).toBe(true);

    expect(result.postIssuePassReport!.commentsRestored).toBe(0);
    expect(result.postIssuePassReport!.subtaskLinksRestored).toBe(0);
    expect(result.postIssuePassReport!.issueLinksRestored).toBe(0);
    expect(result.errorCount).toBe(0);
  });
});
