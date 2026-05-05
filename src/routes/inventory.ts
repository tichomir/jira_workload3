import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import type { BackupManifest } from '../workload/backup/types.js';
import type { InventoryResponse, ObjectTypeEntry } from '../platform/contracts.js';

const router = Router();

type ObjectType = ObjectTypeEntry['type'];

const OBJECT_TYPES: ObjectType[] = ['Project', 'Issue', 'Board', 'Sprint', 'Workflow', 'CustomField'];

const DISPLAY_NAMES: Record<ObjectType, string> = {
  Project: 'Projects',
  Issue: 'Issues',
  Board: 'Boards',
  Sprint: 'Sprints',
  Workflow: 'Workflows',
  CustomField: 'Custom Fields',
};

/** Build the inventory response from a parsed manifest (or null when no backup point exists). */
export function buildInventoryResponse(manifest: BackupManifest | null): InventoryResponse {
  if (!manifest) {
    return {
      objectTypes: OBJECT_TYPES.map(type => ({
        type,
        displayName: DISPLAY_NAMES[type],
        count: 0,
        lastBackupAt: null,
      })),
    };
  }

  // manifest.projects already excludes JSM (service_desk) projects —
  // those appear only in jsmDeferredProjects. No further filtering needed here.
  const projects = manifest.projects;
  const lastBackupAt = manifest.discoveredAt;

  const projectCount = projects.length;

  const issueCount = projects.reduce((sum, p) => sum + p.issueCounts.backed, 0);

  // Deduplicate board/sprint IDs across projects (a board may be referenced by multiple projects)
  const boardIds = new Set<string>(projects.flatMap(p => p.boardIds));
  const sprintIds = new Set<string>(projects.flatMap(p => p.sprintIds));

  // Workflows are not stored in the manifest in Phase 1 sprint 1
  const workflowCount = 0;

  const customFieldCount =
    manifest.customFieldsCaptured ?? manifest.fieldContexts?.length ?? 0;

  const countMap: Record<ObjectType, number> = {
    Project: projectCount,
    Issue: issueCount,
    Board: boardIds.size,
    Sprint: sprintIds.size,
    Workflow: workflowCount,
    CustomField: customFieldCount,
  };

  return {
    objectTypes: OBJECT_TYPES.map(type => ({
      type,
      displayName: DISPLAY_NAMES[type],
      count: countMap[type],
      lastBackupAt,
    })),
  };
}

export function handleGetInventory(req: Request, res: Response): void {
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

  const manifestRow = db
    .prepare(
      `SELECT id, manifestJson FROM backup_manifests
        WHERE connectionId = ?
        ORDER BY createdAt DESC
        LIMIT 1`
    )
    .get(connectionId) as { id: string; manifestJson: string } | undefined;

  let manifest: BackupManifest | null = null;
  let backupPointId: string | null = null;

  if (manifestRow) {
    manifest = JSON.parse(manifestRow.manifestJson) as BackupManifest;
    backupPointId = manifestRow.id;
  }

  const jsmExcludedCount = manifest?.jsmDeferredProjects.length ?? 0;

  console.log(
    `[inventory] connectionId=${connectionId} backupPointId=${backupPointId ?? 'none'} jsmExcludedProjects=${jsmExcludedCount}`
  );

  res.status(200).json({ ...buildInventoryResponse(manifest), backupPointId });
}

router.get('/', (req, res) => {
  handleGetInventory(req, res);
});

// ---------------------------------------------------------------------------
// GET /api/inventory/:type — paginated item list for a specific object type
// ---------------------------------------------------------------------------

const VALID_ITEM_TYPES = ['Issue', 'Project', 'Board', 'Sprint'] as const;
type ItemType = (typeof VALID_ITEM_TYPES)[number];

interface InventoryItemRow {
  itemId: string;
  displayName: string;
  summary: string | null;
  changeBadge: string;
  capturedAt: string;
}

export function handleGetInventoryByType(req: Request, res: Response): void {
  const { type } = req.params as { type: string };

  if (!VALID_ITEM_TYPES.includes(type as ItemType)) {
    res.status(400).json({
      error: 'invalid_type',
      message: `type must be one of: ${VALID_ITEM_TYPES.join(', ')}`,
    });
    return;
  }

  const connectionId = req.query['connectionId'] as string | undefined;
  const backupPointId = req.query['backupPointId'] as string | undefined;

  if (!connectionId) {
    res.status(400).json({
      error: 'missing_required_fields',
      message: 'connectionId query parameter is required',
    });
    return;
  }

  if (!backupPointId) {
    res.status(400).json({
      error: 'missing_required_fields',
      message: 'backupPointId query parameter is required',
    });
    return;
  }

  const rawLimit = parseInt((req.query['limit'] as string | undefined) ?? '50', 10);
  const rawOffset = parseInt((req.query['offset'] as string | undefined) ?? '0', 10);
  const limit = Math.min(isNaN(rawLimit) ? 50 : Math.max(1, rawLimit), 200);
  const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

  const db = getDb();

  const connRow = db
    .prepare('SELECT connectionId FROM connections WHERE connectionId = ?')
    .get(connectionId) as { connectionId: string } | undefined;

  if (!connRow) {
    res.status(404).json({ error: 'connection_not_found', message: `No connection found with id ${connectionId}` });
    return;
  }

  const bpRow = db
    .prepare('SELECT id FROM backup_manifests WHERE id = ? AND connectionId = ?')
    .get(backupPointId, connectionId) as { id: string } | undefined;

  if (!bpRow) {
    res.status(404).json({ error: 'backup_point_not_found', message: `No backup point found with id ${backupPointId}` });
    return;
  }

  const { count: total } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM backup_point_items
       WHERE connectionId = ? AND backupPointId = ? AND objectType = ?`
    )
    .get(connectionId, backupPointId, type) as { count: number };

  const rows = db
    .prepare(
      `SELECT itemId, displayName, summary, changeBadge, capturedAt
       FROM backup_point_items
       WHERE connectionId = ? AND backupPointId = ? AND objectType = ?
       ORDER BY rowId
       LIMIT ? OFFSET ?`
    )
    .all(connectionId, backupPointId, type, limit, offset) as InventoryItemRow[];

  const items = rows.map((row) => {
    const item: Record<string, unknown> = {
      id: row.itemId,
      displayName: row.displayName,
      backupPointId,
      backupPointTimestamp: row.capturedAt,
      changeBadge: row.changeBadge,
    };
    if (type === 'Issue') {
      item['summary'] = row.summary ?? '';
    }
    return item;
  });

  res.status(200).json({
    items,
    pagination: { limit, offset, total },
  });
}

router.get('/:type', handleGetInventoryByType);

export { router as inventoryRouter };
