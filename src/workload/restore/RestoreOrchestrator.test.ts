import { describe, it, expect } from 'vitest';
import { RestoreOrchestrator } from './RestoreOrchestrator.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type RestoreRunOptions,
  type JobFailedEvent,
} from './types.js';

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

    const orchestrator = new RestoreOrchestrator();
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
    const orchestrator = new RestoreOrchestrator({
      [RestorePhase.Workflow]: async () => {
        throw new Error('workflow restore error');
      },
    });

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

    const orchestrator = new RestoreOrchestrator({
      [RestorePhase.Issue]: async () => {
        throw new Error('issue write failed');
      },
    });

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

    const orchestrator = new RestoreOrchestrator({
      [RestorePhase.SiteReferenceData]: async () => {
        throw new Error('site ref data unavailable');
      },
    });

    await orchestrator.runRestore(makeOptions(), (ev) => {
      if (ev.type === 'phase_started') phasesStarted.push(ev.phase);
    });

    // Only the first phase starts
    expect(phasesStarted).toHaveLength(1);
    expect(phasesStarted[0]).toBe(RestorePhase.SiteReferenceData);
  });
});
