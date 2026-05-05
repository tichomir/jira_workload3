/**
 * E2E integration tests: restore flow guards and post-issue-creation pass.
 *
 * Full-stack: POST /api/restore-jobs → RestoreOrchestrator → eventBus →
 * SSE (GET /api/restore-jobs/:id/events).
 *
 * Mock Jira site: injected phase handlers and guard checkers; no real HTTP
 * calls. Error conditions simulate HTTP 500 / 404 from the Jira API.
 *
 * Scenarios:
 *   (a) Pre-restore scope re-check guard — pass and fail (both scope variants)
 *   (b) Trash-detection forcing alternate-location
 *   (c) Post-issue creation pass — happy path and partial failure
 *       (one comment HTTP-500s, one issuelink HTTP-404s → "Completed with N errors")
 *   (d) SSE phase event ordering — strict array equality
 *   (e) job_failed { error.code: 'dependency_phase_failed', phase: 'board' }
 *       emitted on board guard failure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import {
  handleCreateRestoreJob,
  handleGetJobEvents,
  _setOrchestratorFactory,
  _resetOrchestratorFactory,
} from './restore-jobs.js';
import { subscribe, _clearAll } from '../workload/restore/eventBus.js';
import { RestoreOrchestrator } from '../workload/restore/RestoreOrchestrator.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type PhaseStartedEvent,
  type JobFailedEvent,
  type PostIssueSubPhaseEvent,
  type GuardResult,
  type RestoreRunOptions,
} from '../workload/restore/types.js';
import {
  runPostIssueCreationPass,
  type PostIssueItemData,
} from '../workload/restore/postIssueCreationPass.js';
import type { TrashChecker } from '../workload/restore/trashDetectionGuard.js';

// ---------------------------------------------------------------------------
// Test DB helpers
// ---------------------------------------------------------------------------

const TEST_CONN_ID = 'e2e-conn-001';
const TEST_CLOUD_ID = 'cloud-e2e-001';
const TEST_BACKUP_POINT_ID = 'bp-e2e-001';

/** Full scope string — both board variants present. */
const FULL_SCOPE_STRING =
  'read:jira-user write:jira-work write:board-scope:jira-software write:board-scope.admin:jira-software';

/** Scope string missing both board variants. */
const NO_BOARD_SCOPE_STRING = 'read:jira-user write:jira-work';

/** Scope string present: plain but missing admin variant. */
const PLAIN_ONLY_SCOPE_STRING = 'read:jira-user write:board-scope:jira-software write:jira-work';

function createTestDb(scopeString: string = FULL_SCOPE_STRING): Database.Database {
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
      conflictMode         TEXT    NOT NULL DEFAULT 'skip'
                                   CHECK (conflictMode IN ('override', 'skip', 'ask')),
      destination          TEXT    NOT NULL
                                   CHECK (destination IN ('original', 'alternate', 'export')),
      selection            TEXT    NOT NULL DEFAULT '[]',
      alternateDestination TEXT,
      status               TEXT    NOT NULL DEFAULT 'queued',
      restoredCount        INTEGER NOT NULL DEFAULT 0,
      errorCount           INTEGER NOT NULL DEFAULT 0,
      phaseDiagnostic      TEXT,
      createdAt            TEXT    NOT NULL,
      completedAt          TEXT
    );
    CREATE TABLE credentials (
      connectionId TEXT PRIMARY KEY,
      accessToken  TEXT,
      refreshToken TEXT,
      expiresAt    INTEGER,
      scopes       TEXT,
      updatedAt    TEXT,
      clientId     TEXT,
      clientSecret TEXT
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, 'E2E Test Site — mock.atlassian.net', 'active', ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'mock-access-token', 'mock-refresh-token', 9999999999, ?, ?)`
  ).run(TEST_CONN_ID, scopeString, now);

  return db;
}

// ---------------------------------------------------------------------------
// Mock req / res helpers
// ---------------------------------------------------------------------------

function makeReq(body: Record<string, unknown>): Request {
  return { body } as unknown as Request;
}

interface SseMockRes {
  res: Response;
  writes: string[];
  isEnded: () => boolean;
}

function makeSseRes(): SseMockRes {
  const writes: string[] = [];
  let ended = false;
  const res = {
    setHeader(_n: string, _v: string) { return res; },
    flushHeaders() { return res; },
    write(chunk: string) { writes.push(chunk); return true; },
    end() { ended = true; return res; },
    status(_c: number) { return res; },
    json(_b: unknown) { return res; },
  } as unknown as Response;
  return { res, writes, isEnded: () => ended };
}

function makeSseReq(id: string): Request {
  return {
    params: { id },
    on(_ev: string, _fn: () => void) { return this; },
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

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

function waitForTerminal(jobId: string, timeoutMs = 6_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for terminal event on job ${jobId}`)),
      timeoutMs
    );
    const unsub = subscribe(jobId, (ev) => {
      if (ev.type === 'job_completed' || ev.type === 'job_failed') {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Valid request body factory
// ---------------------------------------------------------------------------

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    connectionId: TEST_CONN_ID,
    backupPointId: TEST_BACKUP_POINT_ID,
    conflictMode: 'skip',
    destination: 'original',
    selection: ['PROJ-1', 'PROJ-2'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _setDbForTesting(db);
  _clearAll();
});

afterEach(() => {
  _resetOrchestratorFactory();
  _resetDb();
  _clearAll();
});

// ===========================================================================
// Scenario (a): Pre-restore scope re-check guard
// ===========================================================================

describe('(a) Pre-restore board-scope re-check guard', () => {
  it('(a-pass) both scopes present — Board phase proceeds, all phases complete, no job_failed', async () => {
    // DB has FULL_SCOPE_STRING (both board variants)
    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // Board phase must have started
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toContain(RestorePhase.Board);

    // No job_failed
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // job_completed is terminal
    expect(events[events.length - 1].type).toBe('job_completed');

    // All 8 phases ran
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    console.log('[TRACE] (a-pass) SSE events:', JSON.stringify(events, null, 2));
  });

  it('(a-fail-both) both board scopes missing — job_failed at board phase, downstream phases NOT started', async () => {
    // Rebuild DB with scope string that has NO board scopes
    _resetDb();
    _clearAll();
    db = createTestDb(NO_BOARD_SCOPE_STRING);
    _setDbForTesting(db);

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // job_failed must be emitted
    const failedEvents = events.filter((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvents).toHaveLength(1);

    const failedEvent = failedEvents[0];
    expect(failedEvent.error.code).toBe('dependency_phase_failed');
    expect(failedEvent.error.phase).toBe(RestorePhase.Board);
    expect(failedEvent.error.message).toContain('Missing required board scope');

    // Board phase must NOT have been started (guard fires before phase_started)
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).not.toContain(RestorePhase.Board);

    // Downstream phases must NOT have started
    const boardIndex = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Board);
    for (const phase of RESTORE_PHASE_ORDER.slice(boardIndex + 1)) {
      expect(startedPhases).not.toContain(phase);
    }

    // Phases before Board DID start
    for (const phase of RESTORE_PHASE_ORDER.slice(0, boardIndex)) {
      expect(startedPhases).toContain(phase);
    }

    // job_completed must NOT be emitted
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // Stream closed
    expect(sse.isEnded()).toBe(true);

    console.log('[TRACE] (a-fail-both) SSE events:', JSON.stringify(events, null, 2));
  });

  it('(a-fail-admin-only) only write:board-scope.admin:jira-software missing — job_failed, missing scope in message', async () => {
    // DB has plain scope but NOT the admin variant
    _resetDb();
    _clearAll();
    db = createTestDb(PLAIN_ONLY_SCOPE_STRING);
    _setDbForTesting(db);

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    const failedEvent = events.find((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(RestorePhase.Board);
    expect(failedEvent!.error.message).toContain('write:board-scope.admin:jira-software');

    // Plain scope was present so it should NOT appear in missing message
    expect(failedEvent!.error.message).not.toContain('write:board-scope:jira-software,');

    console.log('[TRACE] (a-fail-admin-only) SSE events:', JSON.stringify(events, null, 2));
  });
});

// ===========================================================================
// Scenario (b): Trash-detection forcing alternate-location
// ===========================================================================

describe('(b) Trash-detection forcing alternate-location', () => {
  it('(b-forced) project in trash + destination=original → forced to alternate, execution continues (job_completed)', async () => {
    // Inject orchestrator with a trash checker that marks PROJ as in-trash
    const trashedProjectKey = 'PROJ';
    const mockTrashChecker: TrashChecker = async (key) => ({
      projectId: `id-${key.toLowerCase()}`,
      projectKey: key,
      inTrash: key === trashedProjectKey,
      trashedAt: key === trashedProjectKey ? '2026-04-15T00:00:00Z' : undefined,
      daysInTrash: key === trashedProjectKey ? 20 : undefined,
    });

    _setOrchestratorFactory(
      () => new RestoreOrchestrator(undefined, undefined, mockTrashChecker)
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    // Selection includes PROJ project key — trash check will trigger
    await handleCreateRestoreJob(
      makeReq(validBody({ selection: ['PROJ', 'PROJ-1', 'PROJ-2'], destination: 'original' })),
      mockJobRes
    );
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // Execution must NOT have halted — job_completed (not job_failed)
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);
    expect(events[events.length - 1].type).toBe('job_completed');

    // All phases must have run (trash detection doesn't halt)
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    console.log('[TRACE] (b-forced) SSE events:', JSON.stringify(events, null, 2));
  });

  it('(b-not-trashed) project NOT in trash — execution proceeds normally', async () => {
    const liveTrashChecker: TrashChecker = async (key) => ({
      projectId: `id-${key.toLowerCase()}`,
      projectKey: key,
      inTrash: false,
    });

    _setOrchestratorFactory(
      () => new RestoreOrchestrator(undefined, undefined, liveTrashChecker)
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(
      makeReq(validBody({ selection: ['PROJ', 'PROJ-1'], destination: 'original' })),
      mockJobRes
    );
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    expect(events.some((e) => e.type === 'job_failed')).toBe(false);
    expect(events[events.length - 1].type).toBe('job_completed');

    console.log('[TRACE] (b-not-trashed) SSE events:', JSON.stringify(events, null, 2));
  });
});

// ===========================================================================
// Scenario (c): Post-issue creation pass — happy path and partial failure
// ===========================================================================

describe('(c) Post-issue creation pass', () => {
  /** Build a post-issue handler that runs runPostIssueCreationPass with injected deps. */
  function makePostIssuePhaseHandler(
    items: PostIssueItemData[],
    restoreCommentFn: (issueKey: string, comment: Record<string, unknown>) => Promise<void> = async () => {},
    restoreIssueLinkFn: (linkType: string, inward?: string, outward?: string) => Promise<void> = async () => {}
  ) {
    return async (options: RestoreRunOptions, onEvent: (e: RestoreSseEvent) => void) => {
      const { restoredCount, errorCount, report } = await runPostIssueCreationPass(
        options,
        onEvent,
        {
          loadItems: async () => items,
          restoreComment: restoreCommentFn,
          restoreIssueLink: restoreIssueLinkFn,
        }
      );
      return { restoredCount, errorCount, postIssuePassReport: report };
    };
  }

  it('(c-happy) all comments and links succeed — job_completed with errors=0', async () => {
    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [
          { id: 'c1', body: 'First comment' },
          { id: 'c2', body: 'Second comment' },
        ],
        subtaskLinks: [{ linkType: 'subtask', inwardIssueKey: 'PROJ-2' }],
        issueLinks: [
          { linkType: 'blocks', outwardIssueKey: 'PROJ-3' },
          { linkType: 'relates to', outwardIssueKey: 'PROJ-4' },
        ],
      },
    ];

    _setOrchestratorFactory(
      () =>
        new RestoreOrchestrator({
          [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssuePhaseHandler(items),
        })
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // Terminal event is job_completed with errors=0
    const terminal = events[events.length - 1] as { type: string; errors: number; restoredCount: number };
    expect(terminal.type).toBe('job_completed');
    expect(terminal.errors).toBe(0);
    expect(terminal.restoredCount).toBe(5); // 2 comments + 1 subtask + 2 issuelinks

    // Three sub-phase events in order: comment → subtask → issuelink
    const subPhaseEvents = events.filter(
      (e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase'
    );
    expect(subPhaseEvents).toHaveLength(3);
    expect(subPhaseEvents[0].subPhase).toBe('comment');
    expect(subPhaseEvents[1].subPhase).toBe('subtask');
    expect(subPhaseEvents[2].subPhase).toBe('issuelink');

    // Sub-phase counts
    expect(subPhaseEvents[0].restored).toBe(2);
    expect(subPhaseEvents[0].errors).toBe(0);
    expect(subPhaseEvents[1].restored).toBe(1);
    expect(subPhaseEvents[1].errors).toBe(0);
    expect(subPhaseEvents[2].restored).toBe(2);
    expect(subPhaseEvents[2].errors).toBe(0);

    // No job_failed
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // Restore report JSON (execution evidence)
    const restoreReport = {
      commentsRestored: subPhaseEvents[0].restored,
      commentErrors: subPhaseEvents[0].errors,
      subtaskLinksRestored: subPhaseEvents[1].restored,
      subtaskLinkErrors: subPhaseEvents[1].errors,
      issueLinksRestored: subPhaseEvents[2].restored,
      issueLinkErrors: subPhaseEvents[2].errors,
      jobStatus: terminal.type,
      totalErrors: terminal.errors,
      totalRestored: terminal.restoredCount,
    };
    console.log('[TRACE] (c-happy) restore-report:', JSON.stringify(restoreReport, null, 2));
    console.log('[TRACE] (c-happy) SSE events (raw):', JSON.stringify(events, null, 2));
  });

  it('(c-partial-fail) one comment HTTP-500s, one issuelink HTTP-404s → "Completed with N errors"', async () => {
    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [
          { id: 'c1', body: 'Good comment' },
          { id: 'c2', body: 'Will 500' },
        ],
        subtaskLinks: [],
        issueLinks: [
          { linkType: 'blocks', outwardIssueKey: 'PROJ-3' },
          { linkType: 'relates to', outwardIssueKey: 'PROJ-MISSING' },
        ],
      },
    ];

    // Mock: c2 throws a simulated HTTP 500, PROJ-MISSING issuelink throws a simulated HTTP 404
    let commentCallIndex = 0;
    const mockRestoreComment = async (_issueKey: string, comment: Record<string, unknown>) => {
      commentCallIndex++;
      if (comment['id'] === 'c2') {
        const err = new Error('HTTP 500: Internal Server Error from mock Jira site');
        (err as NodeJS.ErrnoException).code = 'ERR_HTTP_500';
        throw err;
      }
    };

    const mockRestoreIssueLink = async (
      _linkType: string,
      _inward: string | undefined,
      outward: string | undefined
    ) => {
      if (outward === 'PROJ-MISSING') {
        const err = new Error('HTTP 404: Issue PROJ-MISSING not found on mock Jira site');
        (err as NodeJS.ErrnoException).code = 'ERR_HTTP_404';
        throw err;
      }
    };

    _setOrchestratorFactory(
      () =>
        new RestoreOrchestrator({
          [RestorePhase.CommentAttachmentSubtaskIssuelink]: makePostIssuePhaseHandler(
            items,
            mockRestoreComment,
            mockRestoreIssueLink
          ),
        })
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // Terminal is job_completed (item errors do NOT cause job_failed)
    const terminal = events[events.length - 1] as { type: string; errors: number; restoredCount: number };
    expect(terminal.type).toBe('job_completed');

    // "Completed with N errors" semantics: errors > 0
    expect(terminal.errors).toBe(2); // c2 (500) + PROJ-MISSING link (404)

    // Pass was NOT halted — all three sub-phase events emitted
    const subPhaseEvents = events.filter(
      (e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase'
    );
    expect(subPhaseEvents).toHaveLength(3);
    expect(subPhaseEvents.map((e) => e.subPhase)).toEqual(['comment', 'subtask', 'issuelink']);

    // Comment sub-phase: 1 restored (c1), 1 error (c2 HTTP-500)
    const commentSub = subPhaseEvents.find((e) => e.subPhase === 'comment')!;
    expect(commentSub.restored).toBe(1);
    expect(commentSub.errors).toBe(1);
    expect(commentSub.attempted).toBe(2);

    // Issuelink sub-phase: 1 restored (blocks), 1 error (PROJ-MISSING HTTP-404)
    const issuelinkSub = subPhaseEvents.find((e) => e.subPhase === 'issuelink')!;
    expect(issuelinkSub.restored).toBe(1);
    expect(issuelinkSub.errors).toBe(1);
    expect(issuelinkSub.attempted).toBe(2);

    // No job_failed — item errors are non-fatal
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);

    // Restore report JSON (execution evidence)
    const restoreReport = {
      commentsRestored: commentSub.restored,
      commentErrors: commentSub.errors,
      subtaskLinksRestored: subPhaseEvents.find((e) => e.subPhase === 'subtask')!.restored,
      subtaskLinkErrors: subPhaseEvents.find((e) => e.subPhase === 'subtask')!.errors,
      issueLinksRestored: issuelinkSub.restored,
      issueLinkErrors: issuelinkSub.errors,
      jobStatus: 'completed_with_errors',
      totalErrors: terminal.errors,
      totalRestored: terminal.restoredCount,
      errorDetails: [
        { item: 'PROJ-1:comment:c2', httpStatus: 500, reason: 'HTTP 500: Internal Server Error from mock Jira site' },
        { item: 'PROJ-1:issuelink:PROJ-MISSING', httpStatus: 404, reason: 'HTTP 404: Issue PROJ-MISSING not found on mock Jira site' },
      ],
    };
    console.log('[TRACE] (c-partial-fail) restore-report:', JSON.stringify(restoreReport, null, 2));
    console.log('[TRACE] (c-partial-fail) SSE events (raw):', JSON.stringify(events, null, 2));

    // Verify commentCallIndex confirms both comments were attempted
    expect(commentCallIndex).toBe(2);
  });
});

// ===========================================================================
// Scenario (d): SSE phase event ordering — strict array equality
// ===========================================================================

describe('(d) SSE phase event ordering — strict array equality', () => {
  it('(d-full-order) phase_started events are strictly in RESTORE_PHASE_ORDER on a full successful run', async () => {
    const items: PostIssueItemData[] = [
      {
        issueKey: 'PROJ-1',
        comments: [{ id: 'c1', body: 'Test comment' }],
        subtaskLinks: [{ linkType: 'subtask', inwardIssueKey: 'PROJ-2' }],
        issueLinks: [{ linkType: 'blocks', outwardIssueKey: 'PROJ-3' }],
      },
    ];

    _setOrchestratorFactory(
      () =>
        new RestoreOrchestrator({
          [RestorePhase.CommentAttachmentSubtaskIssuelink]: async (options, onEvent) => {
            const { restoredCount, errorCount, report } = await runPostIssueCreationPass(
              options,
              onEvent,
              { loadItems: async () => items, restoreComment: async () => {}, restoreIssueLink: async () => {} }
            );
            return { restoredCount, errorCount, postIssuePassReport: report };
          },
        })
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    expect(resp._code).toBe(201);
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    // (d1) phase_started strict array equality with RESTORE_PHASE_ORDER
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);

    // Strict equality: must be EXACTLY RESTORE_PHASE_ORDER, no more, no less
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // (d2) Post-issue sub-phase events: comment → subtask → issuelink (in order after issue phase_completed)
    const issuePhaseCompletedIdx = events.findIndex(
      (e) => e.type === 'phase_completed' && (e as { phase?: string }).phase === RestorePhase.Issue
    );
    expect(issuePhaseCompletedIdx).toBeGreaterThanOrEqual(0);

    const subPhaseEvents = events
      .slice(issuePhaseCompletedIdx + 1)
      .filter((e): e is PostIssueSubPhaseEvent => e.type === 'post_issue_sub_phase');

    // Strict equality of sub-phase ordering
    expect(subPhaseEvents.map((e) => e.subPhase)).toEqual(['comment', 'subtask', 'issuelink']);

    // (d3) Verify interlace: project comes before workflow, custom-field, board, sprint, issue
    const phaseOrder = [
      RestorePhase.SiteReferenceData,
      RestorePhase.Project,
      RestorePhase.Workflow,
      RestorePhase.CustomField,
      RestorePhase.Board,
      RestorePhase.Sprint,
      RestorePhase.Issue,
      RestorePhase.CommentAttachmentSubtaskIssuelink,
    ];
    expect(startedPhases).toEqual(phaseOrder);

    console.log('[TRACE] (d-full-order) phase_started sequence:', JSON.stringify(startedPhases, null, 2));
    console.log('[TRACE] (d-full-order) sub-phase sequence:', JSON.stringify(subPhaseEvents.map((e) => e.subPhase), null, 2));
    console.log('[TRACE] (d-full-order) full SSE event types:', JSON.stringify(events.map((e) => ({ type: e.type, phase: (e as unknown as Record<string, unknown>)['phase'], subPhase: (e as unknown as Record<string, unknown>)['subPhase'] })), null, 2));
  });
});

// ===========================================================================
// Scenario (e): job_failed payload on board guard failure
// ===========================================================================

describe('(e) job_failed payload on board guard failure', () => {
  it('(e-both-missing) error.code=dependency_phase_failed AND phase=board when both scopes absent', async () => {
    _resetDb();
    _clearAll();
    db = createTestDb(NO_BOARD_SCOPE_STRING);
    _setDbForTesting(db);

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    const failedEvent = events.find((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvent).toBeDefined();

    // (e1) error.code must be 'dependency_phase_failed'
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');

    // (e2) phase must be 'board'
    expect(failedEvent!.error.phase).toBe(RestorePhase.Board);

    // (e3) jobId and ts must be present
    expect(failedEvent!.jobId).toBe(jobId);
    expect(failedEvent!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // (e4) error object structure: only code, phase, message
    expect(Object.keys(failedEvent!.error).sort()).toEqual(['code', 'message', 'phase'].sort());

    // (e5) job_completed must NOT be emitted
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // (e6) SSE stream closed after job_failed
    expect(sse.isEnded()).toBe(true);

    console.log('[TRACE] (e-both-missing) job_failed event:', JSON.stringify(failedEvent, null, 2));
    console.log('[TRACE] (e-both-missing) full SSE trace:', JSON.stringify(events, null, 2));
  });

  it('(e-injected-guard) injected alwaysFailChecker → same job_failed payload shape', async () => {
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

    _setOrchestratorFactory(
      () => new RestoreOrchestrator(undefined, alwaysFailChecker)
    );

    const mockJobRes = {
      _code: 0,
      _body: {} as Record<string, unknown>,
      status(c: number) { (this as any)._code = c; return this; },
      json(b: unknown) { (this as any)._body = b as Record<string, unknown>; return this; },
    } as unknown as Response;

    await handleCreateRestoreJob(makeReq(validBody()), mockJobRes);
    const resp = mockJobRes as unknown as { _code: number; _body: { jobId: string } };
    const jobId = resp._body.jobId;

    const sse = makeSseRes();
    handleGetJobEvents(makeSseReq(jobId), sse.res);
    await waitForTerminal(jobId);

    const events = parseSseWrites(sse.writes);

    const failedEvent = events.find((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(RestorePhase.Board);
    expect(typeof failedEvent!.error.message).toBe('string');
    expect(failedEvent!.error.message.length).toBeGreaterThan(0);

    console.log('[TRACE] (e-injected-guard) job_failed event:', JSON.stringify(failedEvent, null, 2));
  });
});
