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
        jsmExcluded: false,
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

  const jsmExcluded = (manifest.jsmDeferredProjects?.length ?? 0) > 0;

  return {
    objectTypes: OBJECT_TYPES.map(type => ({
      type,
      displayName: DISPLAY_NAMES[type],
      count: countMap[type],
      lastBackupAt,
      jsmExcluded,
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

  for (const jsm of manifest?.jsmDeferredProjects ?? []) {
    console.log(`[inventory] jsm_excluded projectKey=${jsm.projectKey} reason=service_desk`);
  }

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

/** Normalize a query param value to a string array (handles single-string and array forms). */
function normalizeQueryParam(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

/** Accept ISO-8601 date or datetime strings; reject anything else. */
function isValidIso8601(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

/**
 * GET /api/inventory/:type
 *
 * Returns a paginated list of inventory items for the given object type scoped to a
 * specific backup point.
 *
 * Path params:
 *   type  — one of: Issue | Project | Board | Sprint
 *
 * Query params:
 *   connectionId   (required) — the connection the backup point belongs to
 *   backupPointId  (required) — ID of the backup_manifests row to read items from
 *   limit          (optional, default 50, max 200)
 *   offset         (optional, default 0)
 *
 * Issue-only filter facets (OR within facet, AND across facets; filtering against
 * the backup manifest — no live Jira API calls):
 *   status         — one or more Issue status values
 *   issueType      — one or more Issue type names (e.g. Bug, Story)
 *   assignee       — one or more assignee identifiers
 *   sprint         — one or more sprint IDs
 *   board          — one or more board IDs
 *   label          — one or more label strings (matches against stored JSON array)
 *   priority       — one or more priority names
 *   updatedFrom    — ISO-8601 date; items with updatedAt >= this value
 *   updatedTo      — ISO-8601 date; items with updatedAt <= this value
 *
 * Response 200:
 * ```json
 * {
 *   "items": [
 *     {
 *       "id": "PROJ-42",
 *       "displayName": "PROJ-42",
 *       "backupPointId": "bp-uuid",
 *       "backupPointTimestamp": "2026-05-04T10:00:00.000Z",
 *       "changeBadge": "added" | "modified" | "deleted" | "unchanged",
 *       "summary": "..."   // Issue type only
 *     }
 *   ],
 *   "pagination": { "limit": 50, "offset": 0, "total": 120 }
 * }
 * ```
 *
 * Every item in the response carries `backupPointId` and `backupPointTimestamp` to support
 * single-click traceability from any object back to the backup point it was captured in.
 * These values are sourced from the manifest row identified by `backupPointId`; no live
 * Jira API calls are made.
 */
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
    .prepare('SELECT id, manifestJson FROM backup_manifests WHERE id = ? AND connectionId = ?')
    .get(backupPointId, connectionId) as { id: string; manifestJson: string } | undefined;

  if (!bpRow) {
    res.status(404).json({ error: 'backup_point_not_found', message: `No backup point found with id ${backupPointId}` });
    return;
  }

  // Parse JSM deferred projects from the manifest for defense-in-depth exclusion.
  // Items for JSM (service_desk) projects must not appear in any inventory listing.
  const jsmProjectIds: string[] = [];
  const jsmProjectKeys: string[] = [];

  try {
    const parsedManifest = JSON.parse(bpRow.manifestJson) as Partial<BackupManifest>;
    for (const jsm of parsedManifest.jsmDeferredProjects ?? []) {
      jsmProjectIds.push(jsm.projectId);
      jsmProjectKeys.push(jsm.projectKey);
      console.log(`[inventory] jsm_excluded projectKey=${jsm.projectKey} reason=service_desk`);
    }
  } catch {
    // Malformed manifest JSON — skip JSM filtering
  }

  // Validate date-range params before touching SQL.
  const updatedFrom = req.query['updatedFrom'] as string | undefined;
  const updatedTo = req.query['updatedTo'] as string | undefined;

  if (updatedFrom !== undefined && !isValidIso8601(updatedFrom)) {
    res.status(400).json({
      error: 'invalid_date_format',
      message: 'updatedFrom must be an ISO-8601 date string (e.g. 2026-05-01 or 2026-05-01T00:00:00Z)',
    });
    return;
  }

  if (updatedTo !== undefined && !isValidIso8601(updatedTo)) {
    res.status(400).json({
      error: 'invalid_date_format',
      message: 'updatedTo must be an ISO-8601 date string (e.g. 2026-05-31 or 2026-05-31T23:59:59Z)',
    });
    return;
  }

  // Collect all WHERE conditions and positional params into a single list so the
  // COUNT and SELECT queries use the same bind-param sequence.
  const filterConditions: string[] = [];
  const filterParams: (string | number)[] = [];

  // JSM exclusion — Project items by projectId, Issue items by project-key prefix.
  // Board and Sprint items carry no JSM association in this table.
  if (type === 'Project' && jsmProjectIds.length > 0) {
    filterConditions.push(`itemId NOT IN (${jsmProjectIds.map(() => '?').join(', ')})`);
    filterParams.push(...jsmProjectIds);
  } else if (type === 'Issue' && jsmProjectKeys.length > 0) {
    filterConditions.push(
      `SUBSTR(itemId, 1, INSTR(itemId, '-') - 1) NOT IN (${jsmProjectKeys.map(() => '?').join(', ')})`
    );
    filterParams.push(...jsmProjectKeys);
  }

  // Structured filter facets — Issue type only; OR within a facet, AND across facets.
  if (type === 'Issue') {
    const statusValues = normalizeQueryParam(req.query['status']);
    if (statusValues.length > 0) {
      filterConditions.push(`status IN (${statusValues.map(() => '?').join(', ')})`);
      filterParams.push(...statusValues);
    }

    const issueTypeValues = normalizeQueryParam(req.query['issueType']);
    if (issueTypeValues.length > 0) {
      filterConditions.push(`issueType IN (${issueTypeValues.map(() => '?').join(', ')})`);
      filterParams.push(...issueTypeValues);
    }

    const assigneeValues = normalizeQueryParam(req.query['assignee']);
    if (assigneeValues.length > 0) {
      filterConditions.push(`assignee IN (${assigneeValues.map(() => '?').join(', ')})`);
      filterParams.push(...assigneeValues);
    }

    const priorityValues = normalizeQueryParam(req.query['priority']);
    if (priorityValues.length > 0) {
      filterConditions.push(`priority IN (${priorityValues.map(() => '?').join(', ')})`);
      filterParams.push(...priorityValues);
    }

    const sprintValues = normalizeQueryParam(req.query['sprint']);
    if (sprintValues.length > 0) {
      filterConditions.push(`sprintId IN (${sprintValues.map(() => '?').join(', ')})`);
      filterParams.push(...sprintValues);
    }

    const boardValues = normalizeQueryParam(req.query['board']);
    if (boardValues.length > 0) {
      filterConditions.push(`boardId IN (${boardValues.map(() => '?').join(', ')})`);
      filterParams.push(...boardValues);
    }

    const labelValues = normalizeQueryParam(req.query['label']);
    if (labelValues.length > 0) {
      // AND semantics: issue must have ALL specified labels present in the JSON array.
      // One EXISTS condition per label value ensures each must individually match.
      for (const label of labelValues) {
        filterConditions.push(
          `(labels IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(labels) WHERE value = ?))`
        );
        filterParams.push(label);
      }
    }

    if (updatedFrom !== undefined) {
      filterConditions.push(`updatedAt >= ?`);
      filterParams.push(updatedFrom);
    }

    if (updatedTo !== undefined) {
      filterConditions.push(`updatedAt <= ?`);
      filterParams.push(updatedTo);
    }

    const q = req.query['q'] as string | undefined;
    if (q !== undefined && q.trim().length > 0) {
      const trimmedQ = q.trim();
      const issueKeyRegex = /^[A-Z][A-Z0-9_]+-\d+$/;
      if (issueKeyRegex.test(trimmedQ)) {
        filterConditions.push('itemId = ?');
        filterParams.push(trimmedQ);
      } else {
        const tokens = trimmedQ.split(/\s+/).filter(t => t.length > 0);
        for (const token of tokens) {
          filterConditions.push('LOWER(summary) LIKE ?');
          filterParams.push(`%${token.toLowerCase()}%`);
        }
      }
    }

    const attachmentFilename = req.query['attachmentFilename'] as string | undefined;
    if (attachmentFilename !== undefined && attachmentFilename.trim().length > 0) {
      const tokens = attachmentFilename.trim().split(/\s+/).filter(t => t.length > 0);
      const tokenConditions = tokens.map(() => 'LOWER(value) LIKE ?').join(' AND ');
      filterConditions.push(
        `(attachments IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(attachments) WHERE ${tokenConditions}))`
      );
      for (const token of tokens) {
        filterParams.push(`%${token.toLowerCase()}%`);
      }
    }
  }

  const whereExtra = filterConditions.length > 0
    ? `AND ${filterConditions.join(' AND ')}`
    : '';

  const { count: total } = db
    .prepare(
      `SELECT COUNT(*) AS count FROM backup_point_items
       WHERE connectionId = ? AND backupPointId = ? AND objectType = ?
       ${whereExtra}`
    )
    .get(connectionId, backupPointId, type, ...filterParams) as { count: number };

  const rows = db
    .prepare(
      `SELECT itemId, displayName, summary, changeBadge, capturedAt
       FROM backup_point_items
       WHERE connectionId = ? AND backupPointId = ? AND objectType = ?
       ${whereExtra}
       ORDER BY rowId
       LIMIT ? OFFSET ?`
    )
    .all(connectionId, backupPointId, type, ...filterParams, limit, offset) as InventoryItemRow[];

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
      const dashIdx = row.itemId.indexOf('-');
      if (dashIdx > 0) {
        item['projectKey'] = row.itemId.slice(0, dashIdx);
        item['issueNumber'] = parseInt(row.itemId.slice(dashIdx + 1), 10);
      }
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
