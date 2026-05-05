import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import type { ConflictMode, RestoreDestinationType, RestoreSseEvent, IRestoreOrchestrator } from '../workload/restore/types.js';
import { subscribe, publish } from '../workload/restore/eventBus.js';
import { RestoreOrchestrator } from '../workload/restore/RestoreOrchestrator.js';

const VALID_CONFLICT_MODES: readonly ConflictMode[] = ['override', 'skip', 'ask'];
const VALID_DESTINATIONS: readonly RestoreDestinationType[] = ['original', 'alternate', 'export'];

type OrchestratorFactory = () => IRestoreOrchestrator;
let _orchestratorFactory: OrchestratorFactory = () => new RestoreOrchestrator();

/** For testing only: replace the orchestrator factory. */
export function _setOrchestratorFactory(factory: OrchestratorFactory): void {
  _orchestratorFactory = factory;
}

/** For testing only: reset the orchestrator factory to the default. */
export function _resetOrchestratorFactory(): void {
  _orchestratorFactory = () => new RestoreOrchestrator();
}

interface RestoreJobCreateRequest {
  connectionId?: unknown;
  backupPointId?: unknown;
  conflictMode?: unknown;
  destination?: unknown;
  selection?: unknown;
  targetCloudId?: unknown;
  alternateDestination?: unknown;
}

export async function handleCreateRestoreJob(req: Request, res: Response): Promise<void> {
  const body = req.body as RestoreJobCreateRequest;

  if (!body.connectionId || typeof body.connectionId !== 'string') {
    res.status(400).json({ error: 'missing_required_fields', message: 'connectionId is required' });
    return;
  }

  if (!body.backupPointId || typeof body.backupPointId !== 'string') {
    res.status(400).json({ error: 'missing_required_fields', message: 'backupPointId is required' });
    return;
  }

  if (!Array.isArray(body.selection)) {
    res.status(400).json({ error: 'missing_required_fields', message: 'selection must be an array' });
    return;
  }

  if (!body.destination || typeof body.destination !== 'string') {
    res.status(400).json({ error: 'missing_required_fields', message: 'destination is required' });
    return;
  }

  const conflictMode: ConflictMode =
    body.conflictMode === undefined || body.conflictMode === null
      ? 'skip'
      : (body.conflictMode as ConflictMode);

  if (!VALID_CONFLICT_MODES.includes(conflictMode)) {
    res.status(400).json({
      error: 'invalid_conflict_mode',
      message: `conflictMode must be one of: ${VALID_CONFLICT_MODES.join(', ')}`,
    });
    return;
  }

  const destination = body.destination as RestoreDestinationType;
  if (!VALID_DESTINATIONS.includes(destination)) {
    res.status(400).json({
      error: 'invalid_destination',
      message: `destination must be one of: ${VALID_DESTINATIONS.join(', ')}`,
    });
    return;
  }

  const db = getDb();
  const conn = db
    .prepare('SELECT connectionId, cloudId FROM connections WHERE connectionId = ?')
    .get(body.connectionId) as { connectionId: string; cloudId: string } | undefined;

  if (!conn) {
    res.status(404).json({ error: 'connection_not_found', message: `No connection found with id ${body.connectionId}` });
    return;
  }

  // Reject cross-site restore indicators: targetCloudId or alternateDestination.cloudId
  // that differ from the connection's cloudId (T5 §5.2).
  if (body.targetCloudId !== undefined && body.targetCloudId !== conn.cloudId) {
    res.status(400).json({
      error: 'cross_site_restore_not_supported',
      message: 'Cross-site restore is not supported in Phase 1. targetCloudId must match the connection cloudId.',
    });
    return;
  }

  const altDest = body.alternateDestination as { cloudId?: string; projectKey?: string } | undefined;
  if (altDest && typeof altDest.cloudId === 'string' && altDest.cloudId !== conn.cloudId) {
    res.status(400).json({
      error: 'cross_site_restore_not_supported',
      message: 'Cross-site restore is not supported in Phase 1. alternateDestination.cloudId must match the connection cloudId.',
    });
    return;
  }

  const jobId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO restore_jobs
       (jobId, connectionId, backupPointId, conflictMode, destination, selection,
        alternateDestination, status, restoredCount, errorCount, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, 0, ?)`
  ).run(
    jobId,
    body.connectionId,
    body.backupPointId,
    conflictMode,
    destination,
    JSON.stringify(body.selection),
    altDest ? JSON.stringify(altDest) : null,
    now
  );

  // Launch the orchestrator async (fire-and-forget). Events are published to
  // the in-memory event bus so SSE subscribers receive them in real time.
  const orchestrator = _orchestratorFactory();
  const runOptions = {
    jobId,
    connectionId: body.connectionId,
    cloudId: conn.cloudId,
    cloudBaseUrl: `https://api.atlassian.com/ex/jira/${conn.cloudId}`,
    backupPointId: body.backupPointId,
    selection: body.selection as string[],
    conflictMode,
    destination,
    alternateDestination: altDest as { cloudId: string; projectKey: string } | undefined,
  };

  void orchestrator
    .runRestore(runOptions, (event) => publish(jobId, event))
    .then((result) => {
      const status = result.phaseDiagnostic
        ? 'failed'
        : result.errorCount > 0
        ? 'completed_with_errors'
        : 'completed';
      db.prepare(
        `UPDATE restore_jobs
         SET status = ?, restoredCount = ?, errorCount = ?, phaseDiagnostic = ?, completedAt = ?
         WHERE jobId = ?`
      ).run(status, result.restoredCount, result.errorCount, result.phaseDiagnostic ?? null, result.completedAt, jobId);
    })
    .catch((err: unknown) => {
      console.error(`[restore] jobId=${jobId} unhandled orchestrator error:`, err);
    });

  res.status(201).json({ jobId, status: 'queued' });
}

/**
 * GET /api/restore-jobs/:id/events
 *
 * SSE stream for a restore job. Emits events published by the restore
 * orchestrator via the in-memory event bus. Buffered events are replayed
 * immediately so late-connecting clients receive the full event sequence.
 *
 * Content-Type: text/event-stream
 * Heartbeat: SSE comment line every 9 s (≤10 s interval per T5 §6.2)
 * Stream closes after job_completed or job_failed events. Source: T5 §6.2.
 */
export function handleGetJobEvents(req: Request, res: Response): void {
  const jobId = req.params['id'];
  const db = getDb();

  const job = db.prepare('SELECT jobId FROM restore_jobs WHERE jobId = ?').get(jobId);
  if (!job) {
    res.status(404).json({ error: 'not_found', message: `restore job ${jobId} not found` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let done = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeFn: (() => void) | null = null;

  function cleanup(): void {
    if (done) return;
    done = true;
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    unsubscribeFn?.();
  }

  function onEvent(event: RestoreSseEvent): void {
    if (done) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'job_completed' || event.type === 'job_failed') {
      cleanup();
      res.end();
    }
  }

  // subscribe() replays buffered events synchronously before returning,
  // so done may be true after this call if a terminal event was already buffered.
  unsubscribeFn = subscribe(jobId, onEvent);

  if (!done) {
    heartbeatTimer = setInterval(() => {
      if (!done) res.write(': heartbeat\n\n');
    }, 9_000);
  }

  req.on('close', cleanup);
}

/**
 * GET /api/restore-jobs/trash-check
 *
 * Pre-flight trash status check for a set of project keys before job creation.
 * Returns which project keys are currently in the Atlassian-managed trash window
 * so the wizard can force alternate-location restore and show an inline notice.
 *
 * Stub behaviour: any project key whose uppercase form starts with "TRASH" is
 * treated as in the Atlassian trash window. A real implementation would call
 * GET /rest/api/3/project/{projectIdOrKey} and inspect project.archived / project.deleted.
 *
 * Query params:
 *   connectionId  (required) — the active connection
 *   projectKeys   (required) — comma-separated project keys, e.g. "PROJ,ABC"
 *
 * Response 200: { trashedProjectKeys: string[] }
 * Source: T5 §4.2
 */
export function handleTrashCheck(req: Request, res: Response): void {
  const connectionId =
    typeof req.query['connectionId'] === 'string' ? req.query['connectionId'] : '';
  const projectKeysRaw =
    typeof req.query['projectKeys'] === 'string' ? req.query['projectKeys'] : '';

  if (!connectionId) {
    res
      .status(400)
      .json({ error: 'missing_required_fields', message: 'connectionId is required' });
    return;
  }

  const db = getDb();
  const conn = db
    .prepare('SELECT connectionId FROM connections WHERE connectionId = ?')
    .get(connectionId);
  if (!conn) {
    res.status(404).json({
      error: 'connection_not_found',
      message: `No connection found with id ${connectionId}`,
    });
    return;
  }

  const projectKeys = projectKeysRaw
    ? projectKeysRaw.split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  // Stub: keys whose uppercase form starts with "TRASH" are in the trash window.
  const trashedProjectKeys = projectKeys.filter((k) => k.toUpperCase().startsWith('TRASH'));

  res.json({ trashedProjectKeys });
}

const router = Router();
router.get('/trash-check', handleTrashCheck);
router.post('/', handleCreateRestoreJob);
router.get('/:id/events', handleGetJobEvents);

export { router as restoreJobsRouter };
