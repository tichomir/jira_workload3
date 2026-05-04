import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import type { PolicyRequest, PolicyResponse } from '../platform/contracts.js';

const router = Router();

router.post('/', (req, res) => {
  const body = req.body as Partial<PolicyRequest>;

  if (!body.connectionId || !body.projectScope || body.retentionDays === undefined) {
    res.status(400).json({ error: 'missing_required_fields', message: 'connectionId, projectScope, and retentionDays are required' });
    return;
  }

  if (body.projectScope !== 'all' && body.projectScope !== 'selected') {
    res.status(400).json({ error: 'invalid_project_scope', message: 'projectScope must be "all" or "selected"' });
    return;
  }

  const db = getDb();
  const conn = db
    .prepare('SELECT connectionId FROM connections WHERE connectionId = ?')
    .get(body.connectionId) as { connectionId: string } | undefined;

  if (!conn) {
    res.status(404).json({ error: 'connection_not_found', message: `No connection found with id ${body.connectionId}` });
    return;
  }

  const policyId = randomUUID();
  const now = new Date().toISOString();
  const selectedProjectKeys = body.projectScope === 'selected' ? (body.selectedProjectKeys ?? []) : [];

  db.prepare(
    `INSERT INTO policies (policyId, connectionId, projectScope, selectedProjectKeys, retentionDays, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(policyId, body.connectionId, body.projectScope, JSON.stringify(selectedProjectKeys), body.retentionDays, now);

  const response: PolicyResponse = {
    policyId,
    connectionId: body.connectionId,
    projectScope: body.projectScope,
    selectedProjectKeys,
    retentionDays: body.retentionDays,
    updatedAt: now,
  };

  res.status(201).json(response);
});

export { router as policiesRouter };
