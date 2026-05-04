import { Router } from 'express';
import { jiraWorkload } from '../workload/JiraWorkload.js';
import { WorkloadAuthError } from '../workload/JiraWorkload.js';
import type { DiscoverPolicy } from '../platform_workload_iface.js';

const router = Router();

/**
 * POST /api/discover
 *
 * Triggers project discovery for a connected Jira site and writes a
 * backup-point manifest to the backup_manifests table.
 *
 * Body: { connectionId, projectScope, selectedProjectKeys? }
 * Response 200: { backupPointId, completedAt, projectCount, jsmDeferredCount }
 */
router.post('/', async (req, res) => {
  const body = req.body as Partial<{ connectionId: string; projectScope: string; selectedProjectKeys: string[] }>;

  if (!body.connectionId || !body.projectScope) {
    res.status(400).json({
      error: 'missing_required_fields',
      message: 'connectionId and projectScope are required',
    });
    return;
  }

  if (body.projectScope !== 'all' && body.projectScope !== 'selected') {
    res.status(400).json({
      error: 'invalid_project_scope',
      message: 'projectScope must be "all" or "selected"',
    });
    return;
  }

  const policy: DiscoverPolicy = {
    projectScope: body.projectScope,
    selectedProjectKeys: body.projectScope === 'selected' ? (body.selectedProjectKeys ?? []) : undefined,
  };

  try {
    const result = await jiraWorkload.discover(body.connectionId, policy);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof WorkloadAuthError) {
      res.status(401).json({ error: 'auth_failure', message: err.message });
      return;
    }
    console.error('[discover-route] error', err);
    res.status(500).json({ error: 'discover_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

export { router as discoverRouter };
