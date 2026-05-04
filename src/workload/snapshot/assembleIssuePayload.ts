/**
 * Issue payload assembler for the Jira Cloud backup engine.
 *
 * Produces a normalized IssuePayload from a raw search/jql response, satisfying
 * the coverage invariant: every custom field ID from GET /rest/api/3/field
 * (custom: true) must appear in customFieldValues, even when the field value
 * is null for this issue.
 *
 * Source: T3 §3.3, §3.5.
 */

import type { RawIssue, AttachmentRecord } from '../backup/types.js';
import type {
  IssuePayload,
  AdfNode,
  IssueComment,
  IssueLink,
  WorklogEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a normalized IssuePayload from a raw search/jql Issue response.
 *
 * The raw issue must have been fetched with fields=["*all"] and
 * expand=["comments","issuelinks","subtasks","worklog","watchers"].
 *
 * Coverage invariant: every ID in allCustomFieldIds will appear as a key in
 * the returned customFieldValues map. System fields (custom: false) must not
 * be in allCustomFieldIds and will not appear in the map.
 *
 * @param raw              Raw issue from POST /rest/api/3/search/jql
 * @param allCustomFieldIds All custom field IDs from GET /rest/api/3/field
 *                          filtered to custom === true.
 */
export function assembleIssuePayload(
  raw: RawIssue,
  allCustomFieldIds: string[]
): IssuePayload {
  const f = raw.fields;

  // -------------------------------------------------------------------------
  // System fields
  // -------------------------------------------------------------------------
  const summary = asString(f['summary']);
  const description = (f['description'] as AdfNode | null | undefined) ?? null;
  const issueTypeRaw = f['issuetype'] as { id: string; name: string } | null | undefined;
  const statusRaw = f['status'] as { id: string; name: string } | null | undefined;
  const priorityRaw = f['priority'] as { id: string; name: string } | null | undefined;
  const assigneeRaw = f['assignee'] as { accountId: string; displayName: string } | null | undefined;
  const reporterRaw = f['reporter'] as { accountId: string; displayName: string } | null | undefined;
  const created = asString(f['created']);
  const updated = asString(f['updated']);
  const resolutionDate = f['resolutiondate'] != null ? asString(f['resolutiondate']) : null;
  const labels = Array.isArray(f['labels']) ? (f['labels'] as string[]) : [];

  const projectRaw = f['project'] as { id: string } | null | undefined;
  const projectId = projectRaw?.id ?? '';

  // -------------------------------------------------------------------------
  // Comments — expand: comments
  // -------------------------------------------------------------------------
  const commentContainer = f['comment'] as { comments?: unknown[] } | null | undefined;
  const rawComments = commentContainer?.comments ?? [];
  const comments: IssueComment[] = rawComments.map(assembleComment);

  // -------------------------------------------------------------------------
  // Issue links (both inward and outward) — expand: issuelinks
  // -------------------------------------------------------------------------
  const rawLinks = Array.isArray(f['issuelinks']) ? (f['issuelinks'] as unknown[]) : [];
  const issueLinks: IssueLink[] = rawLinks.map(assembleLink);

  // -------------------------------------------------------------------------
  // Subtasks — expand: subtasks
  // -------------------------------------------------------------------------
  const rawSubtasks = Array.isArray(f['subtasks'])
    ? (f['subtasks'] as Array<{ key: string }>)
    : [];
  const subtaskKeys = rawSubtasks.map((s) => s.key);

  // -------------------------------------------------------------------------
  // Watchers — expand: watchers
  // -------------------------------------------------------------------------
  const watchesContainer = f['watches'] as
    | { watchers?: Array<{ accountId: string }> }
    | null
    | undefined;
  const rawWatchers = watchesContainer?.watchers ?? [];
  const watcherAccountIds = rawWatchers.map((w) => w.accountId);

  // -------------------------------------------------------------------------
  // Worklogs — expand: worklog
  // -------------------------------------------------------------------------
  const worklogContainer = f['worklog'] as { worklogs?: unknown[] } | null | undefined;
  const rawWorklogs = worklogContainer?.worklogs ?? [];
  const worklogs: WorklogEntry[] = rawWorklogs.map(assembleWorklog);

  // -------------------------------------------------------------------------
  // Attachment refs (no binary download — contentHash is empty until download)
  // -------------------------------------------------------------------------
  const rawAttachments = Array.isArray(f['attachment'])
    ? (f['attachment'] as unknown[])
    : [];
  const attachments: AttachmentRecord[] = rawAttachments.map(assembleAttachmentRef);

  // -------------------------------------------------------------------------
  // Custom field values — coverage invariant
  //
  // Every ID in allCustomFieldIds must appear as a key in the map, even when
  // the field is absent on this issue (stored as null). System fields must not
  // appear here (T3 §3.5, T2 §6 Constraint 7).
  // -------------------------------------------------------------------------
  const customFieldValues: Record<string, unknown> = {};
  for (const fieldId of allCustomFieldIds) {
    customFieldValues[fieldId] = fieldId in f ? f[fieldId] : null;
  }

  // -------------------------------------------------------------------------
  // Sprint IDs — extracted from sprint-shaped custom field values.
  //
  // Sprint custom field values are arrays of objects with numeric `id` and
  // `state` ∈ { 'active', 'closed', 'future' }. We scan all custom fields
  // rather than hardcoding customfield_10020, since the field ID can vary.
  // -------------------------------------------------------------------------
  const sprintIds = extractSprintIds(f, allCustomFieldIds);

  return {
    id: raw.id,
    key: raw.key,
    projectId,
    summary,
    description,
    issueType: issueTypeRaw ?? { id: '', name: '' },
    status: statusRaw ?? { id: '', name: '' },
    priority: priorityRaw ?? null,
    assignee: assigneeRaw ?? null,
    reporter: reporterRaw ?? null,
    created,
    updated,
    resolutionDate,
    labels,
    customFieldValues,
    comments,
    issueLinks,
    subtaskKeys,
    sprintIds,
    watcherAccountIds,
    worklogs,
    attachments,
  };
}

/**
 * Assert the coverage invariant for a single IssuePayload.
 *
 * The number of keys in payload.customFieldValues must equal the number of
 * custom fields discovered at backup time. Throws with a diagnostic message
 * if the invariant is violated.
 *
 * @returns true when the invariant holds.
 * @throws  Error when capturedCustomFields !== discoveredCustomFields.
 */
export function assertCoverageInvariant(
  payload: IssuePayload,
  allCustomFieldIds: string[]
): true {
  const captured = Object.keys(payload.customFieldValues).length;
  const discovered = allCustomFieldIds.length;
  if (captured !== discovered) {
    throw new Error(
      `Coverage invariant violation for issue ${payload.key}: ` +
        `captured ${captured} custom fields, expected ${discovered}`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Private assembly helpers
// ---------------------------------------------------------------------------

function assembleComment(raw: unknown): IssueComment {
  const c = raw as Record<string, unknown>;
  const author = c['author'] as { accountId: string; displayName: string } | null | undefined;
  return {
    id: asString(c['id']),
    author: {
      accountId: author?.accountId ?? '',
      displayName: author?.displayName ?? '',
    },
    body: (c['body'] as AdfNode) ?? { type: 'doc', content: [] },
    created: asString(c['created']),
    updated: asString(c['updated']),
  };
}

function assembleLink(raw: unknown): IssueLink {
  const l = raw as Record<string, unknown>;
  const type = l['type'] as { name: string; inward: string; outward: string } | undefined;
  const inwardIssue = l['inwardIssue'] as { key: string; id: string } | undefined;
  const outwardIssue = l['outwardIssue'] as { key: string; id: string } | undefined;
  return {
    id: asString(l['id']),
    type: type ?? { name: '', inward: '', outward: '' },
    ...(inwardIssue != null ? { inwardIssue } : {}),
    ...(outwardIssue != null ? { outwardIssue } : {}),
  };
}

function assembleWorklog(raw: unknown): WorklogEntry {
  const w = raw as Record<string, unknown>;
  const author = w['author'] as { accountId: string } | null | undefined;
  return {
    id: asString(w['id']),
    author: { accountId: author?.accountId ?? '' },
    timeSpentSeconds: (w['timeSpentSeconds'] as number) ?? 0,
    started: asString(w['started']),
  };
}

function assembleAttachmentRef(raw: unknown): AttachmentRecord {
  const a = raw as Record<string, unknown>;
  const author = a['author'] as { accountId: string } | null | undefined;
  return {
    id: asString(a['id']),
    filename: asString(a['filename']),
    mimeType: asString(a['mimeType']),
    size: (a['size'] as number) ?? 0,
    contentUrl: a['content'] != null ? asString(a['content']) : undefined,
    contentHash: '',
    created: asString(a['created']),
    author: { accountId: author?.accountId ?? '' },
  };
}

/**
 * Extract sprint IDs from all custom fields in the raw issue fields.
 *
 * A sprint field value is an array of objects where each element has a
 * numeric `id` and a `state` property in { 'active', 'closed', 'future' }.
 * Deduplicates results — an issue should not appear in the same sprint twice.
 */
function extractSprintIds(
  fields: Record<string, unknown>,
  allCustomFieldIds: string[]
): string[] {
  const ids: string[] = [];
  for (const fieldId of allCustomFieldIds) {
    const value = fields[fieldId];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (
        item !== null &&
        typeof item === 'object' &&
        'id' in item &&
        'state' in item
      ) {
        const state = (item as Record<string, unknown>)['state'];
        if (state === 'active' || state === 'closed' || state === 'future') {
          ids.push(String((item as Record<string, unknown>)['id']));
        }
      }
    }
  }
  return [...new Set(ids)];
}

function asString(v: unknown): string {
  return v != null ? String(v) : '';
}
