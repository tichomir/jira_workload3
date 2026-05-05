import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { JiraHttpClient } from '../workload/http/JiraHttpClient.js';
import type { PolicyRequest, JqlParseResponse } from '../workload/types/PolicyRecord.js';

const router = Router();

export async function handleCreatePolicy(req: Request, res: Response): Promise<void> {
  const body = req.body as Partial<PolicyRequest>;

  if (!body.connectionId) {
    res.status(400).json({ error: 'missing_required_fields', message: 'connectionId is required' });
    return;
  }

  if (body.rpoHours === undefined || body.rpoHours === null) {
    res.status(400).json({ error: 'missing_required_fields', message: 'rpoHours is required' });
    return;
  }

  if (body.retentionDays === undefined || body.retentionDays === null) {
    res.status(400).json({ error: 'missing_required_fields', message: 'retentionDays is required' });
    return;
  }

  if (!body.projectScope) {
    res.status(400).json({ error: 'missing_required_fields', message: 'projectScope is required' });
    return;
  }

  if (body.rpoHours <= 0) {
    res.status(400).json({ error: 'validation_error', message: 'rpoHours must be greater than 0' });
    return;
  }

  if (body.retentionDays <= 0) {
    res.status(400).json({ error: 'validation_error', message: 'retentionDays must be greater than 0' });
    return;
  }

  if (body.projectScope !== 'all' && body.projectScope !== 'selected') {
    res.status(400).json({ error: 'invalid_project_scope', message: 'projectScope must be "all" or "selected"' });
    return;
  }

  if (body.projectScope === 'selected' && (!body.selectedProjectKeys || body.selectedProjectKeys.length === 0)) {
    res.status(400).json({ error: 'validation_error', message: 'selectedProjectKeys is required when projectScope is "selected"' });
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

  if (body.jqlFilter) {
    try {
      const cloudBaseUrl = `https://api.atlassian.com/ex/jira/${conn.cloudId}`;
      const client = JiraHttpClient.forConnection(body.connectionId);
      const parseResult = await client.post<JqlParseResponse>(
        cloudBaseUrl,
        '/rest/api/3/jql/parse',
        { queries: [body.jqlFilter] }
      );
      const errors = parseResult.queries[0]?.errors ?? [];
      if (errors.length > 0) {
        console.log(`[jql-validate] connectionId=${body.connectionId} outcome=invalid errorsCount=${errors.length}`);
        res.status(400).json({ error: 'invalid_jql', details: parseResult });
        return;
      }
      console.log(`[jql-validate] connectionId=${body.connectionId} outcome=valid`);
    } catch (err) {
      console.log(`[jql-validate] connectionId=${body.connectionId} outcome=error`);
      res.status(400).json({
        error: 'jql_parse_failed',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  const policyId = randomUUID();
  const now = new Date().toISOString();
  const selectedProjectKeys = body.projectScope === 'selected' ? (body.selectedProjectKeys ?? []) : [];

  db.prepare(
    `INSERT INTO policies (policyId, connectionId, projectScope, selectedProjectKeys, retentionDays, rpoHours, jqlFilter, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    policyId,
    body.connectionId,
    body.projectScope,
    JSON.stringify(selectedProjectKeys),
    body.retentionDays,
    body.rpoHours,
    body.jqlFilter ?? null,
    now
  );

  res.status(201).json({
    policyId,
    connectionId: body.connectionId,
    rpoHours: body.rpoHours,
    projectScope: body.projectScope,
    selectedProjectKeys,
    retentionDays: body.retentionDays,
    jqlFilter: body.jqlFilter,
    updatedAt: now,
  });
}

router.post('/', handleCreatePolicy);

export { router as policiesRouter };
