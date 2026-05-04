import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { InventoryResponse } from '../platform/contracts.js';

const router = Router();

router.get('/', (req, res) => {
  const connectionId = req.query['connectionId'] as string | undefined;

  if (!connectionId) {
    res.status(400).json({ error: 'missing_required_fields', message: 'connectionId query parameter is required' });
    return;
  }

  const db = getDb();
  const conn = db
    .prepare('SELECT connectionId FROM connections WHERE connectionId = ?')
    .get(connectionId) as { connectionId: string } | undefined;

  if (!conn) {
    res.status(404).json({ error: 'connection_not_found', message: `No connection found with id ${connectionId}` });
    return;
  }

  const response: InventoryResponse = {
    manifestId: randomUUID(),
    completedAt: new Date().toISOString(),
    counts: {
      projects: 0,
      issues: 0,
      boards: 0,
      sprints: 0,
    },
  };

  res.status(200).json(response);
});

export { router as inventoryRouter };
