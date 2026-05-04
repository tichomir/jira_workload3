import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

/**
 * GET /api/jobs/:id
 *
 * Returns the current status and last progress event for a backup job.
 *
 * Response 200:
 *   { jobId, status, manifestId, connectionId, createdAt, updatedAt, errorsCount, lastEvent }
 *
 * Response 404: job not found.
 *
 * Source: T5 §6.2, T5 §6.2b.
 */
router.get('/:id', (req, res) => {
  const db = getDb();
  const jobId = req.params['id'];

  const job = db
    .prepare('SELECT * FROM backup_jobs WHERE jobId = ?')
    .get(jobId) as {
      jobId: string;
      manifestId: string;
      connectionId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      lastEventTs: string | null;
      errorsCount: number;
    } | undefined;

  if (!job) {
    res.status(404).json({ error: 'not_found', message: `job ${jobId} not found` });
    return;
  }

  const lastEventRow = db
    .prepare(
      `SELECT eventJson FROM backup_job_events
        WHERE jobId = ?
        ORDER BY ts DESC
        LIMIT 1`
    )
    .get(jobId) as { eventJson: string } | undefined;

  res.status(200).json({
    jobId: job.jobId,
    status: job.status,
    manifestId: job.manifestId,
    connectionId: job.connectionId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorsCount: job.errorsCount,
    lastEvent: lastEventRow ? (JSON.parse(lastEventRow.eventJson) as unknown) : null,
  });
});

export { router as jobsRouter };
