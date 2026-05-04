import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { RestoreRequest } from '../platform/contracts.js';

const router = Router();

router.post('/', (req, res) => {
  const body = req.body as Partial<RestoreRequest>;

  if (!body.connectionId || !body.backupPointId || !Array.isArray(body.itemIds)) {
    res.status(400).json({ error: 'missing_required_fields' });
    return;
  }

  const db = getDb();
  const restoreId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO restores
       (restoreId, connectionId, backupPointId, status, conflictMode, destination, itemIds, restoredCount, errorCount, createdAt)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, 0, ?)`
  ).run(
    restoreId,
    body.connectionId,
    body.backupPointId,
    body.conflictMode ?? 'skip',
    JSON.stringify(body.destination ?? { type: 'original' }),
    JSON.stringify(body.itemIds),
    now
  );

  res.status(201).json({ restoreId, status: 'pending' });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const row = db
    .prepare('SELECT * FROM restores WHERE restoreId = ?')
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    res.status(404).json({ error: 'restore_not_found' });
    return;
  }

  const response: Record<string, unknown> = {
    restoreId: row['restoreId'],
    connectionId: row['connectionId'],
    backupPointId: row['backupPointId'],
    status: row['status'],
    restoredCount: row['restoredCount'],
    errorCount: row['errorCount'],
    createdAt: row['createdAt'],
    completedAt: row['completedAt'] ?? null,
  };

  if (row['phaseDiagnostic'] != null) {
    response['phaseDiagnostic'] = row['phaseDiagnostic'];
  }

  res.json(response);
});

router.get('/:id/events', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const row = db
    .prepare('SELECT restoreId, status FROM restores WHERE restoreId = ?')
    .get(id) as { restoreId: string; status: string } | undefined;

  if (!row) {
    res.status(404).json({ error: 'restore_not_found' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const event = {
    phase: 'pending',
    restoreId: row.restoreId,
    status: row.status,
    timestamp: new Date().toISOString(),
  };

  res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
});

export { router as restoresRouter };
