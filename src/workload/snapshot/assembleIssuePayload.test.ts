import { describe, it, expect } from 'vitest';
import { assembleIssuePayload, assertCoverageInvariant } from './assembleIssuePayload.js';
import type { RawIssue } from '../backup/types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ALL_CUSTOM_FIELD_IDS = ['customfield_10016', 'customfield_10020', 'customfield_10000'];

function makeFullRawIssue(): RawIssue {
  return {
    id: '10001',
    key: 'PROJ-1',
    fields: {
      // System fields
      summary: 'Test issue summary',
      description: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Description text' }] }],
      },
      issuetype: { id: '10001', name: 'Bug' },
      status: { id: '10000', name: 'To Do' },
      priority: { id: '3', name: 'Medium' },
      assignee: { accountId: 'acc-alice', displayName: 'Alice' },
      reporter: { accountId: 'acc-bob', displayName: 'Bob' },
      created: '2024-01-01T00:00:00.000Z',
      updated: '2024-01-15T12:00:00.000Z',
      resolutiondate: null,
      labels: ['backend', 'urgent'],
      project: { id: '20001', key: 'PROJ', name: 'Project' },

      // Comments
      comment: {
        comments: [
          {
            id: 'cmt-001',
            author: { accountId: 'acc-alice', displayName: 'Alice' },
            body: { type: 'doc', version: 1, content: [] },
            created: '2024-01-02T09:00:00.000Z',
            updated: '2024-01-02T09:00:00.000Z',
          },
          {
            id: 'cmt-002',
            author: { accountId: 'acc-bob', displayName: 'Bob' },
            body: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LGTM' }] }],
            },
            created: '2024-01-03T10:00:00.000Z',
            updated: '2024-01-03T10:30:00.000Z',
          },
        ],
      },

      // Issue links — outward AND inward directions
      issuelinks: [
        {
          id: 'link-001',
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          outwardIssue: { id: '10002', key: 'PROJ-2' },
        },
        {
          id: 'link-002',
          type: { name: 'Relates', inward: 'is related to', outward: 'relates to' },
          inwardIssue: { id: '10003', key: 'PROJ-3' },
        },
      ],

      // Subtasks
      subtasks: [
        { id: '10004', key: 'PROJ-4' },
        { id: '10005', key: 'PROJ-5' },
      ],

      // Watchers
      watches: {
        watchers: [
          { accountId: 'acc-watcher-1' },
          { accountId: 'acc-watcher-2' },
          { accountId: 'acc-watcher-3' },
        ],
      },

      // Worklogs
      worklog: {
        worklogs: [
          {
            id: 'wl-001',
            author: { accountId: 'acc-alice' },
            timeSpentSeconds: 3600,
            started: '2024-01-10T09:00:00.000Z',
          },
          {
            id: 'wl-002',
            author: { accountId: 'acc-bob' },
            timeSpentSeconds: 7200,
            started: '2024-01-11T14:00:00.000Z',
          },
        ],
      },

      // Attachments (refs only — no binary download in assembler)
      attachment: [
        {
          id: 'att-001',
          filename: 'screenshot.png',
          mimeType: 'image/png',
          size: 10240,
          created: '2024-01-01T12:00:00.000Z',
          author: { accountId: 'acc-alice' },
          content: 'https://example.atlassian.net/rest/api/3/attachment/content/att-001',
        },
      ],

      // Custom fields
      customfield_10016: 5,         // Story Points
      customfield_10020: [          // Sprint
        { id: 42, name: 'Sprint 1', state: 'active', boardId: 1 },
      ],
      customfield_10000: 'team-alpha',
    },
  };
}

// ---------------------------------------------------------------------------
// System fields
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — system fields', () => {
  it('captures id, key, and projectId', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.id).toBe('10001');
    expect(payload.key).toBe('PROJ-1');
    expect(payload.projectId).toBe('20001');
  });

  it('captures summary', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.summary).toBe('Test issue summary');
  });

  it('captures description as AdfNode', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.description).not.toBeNull();
    expect((payload.description as { type: string }).type).toBe('doc');
  });

  it('captures issueType id and name', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.issueType).toEqual({ id: '10001', name: 'Bug' });
  });

  it('captures status id and name', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.status).toEqual({ id: '10000', name: 'To Do' });
  });

  it('captures priority id and name', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.priority).toEqual({ id: '3', name: 'Medium' });
  });

  it('returns null priority when missing', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['priority'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.priority).toBeNull();
  });

  it('captures assignee accountId and displayName', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.assignee).toEqual({ accountId: 'acc-alice', displayName: 'Alice' });
  });

  it('returns null assignee when unassigned', () => {
    const raw = makeFullRawIssue();
    raw.fields['assignee'] = null;
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.assignee).toBeNull();
  });

  it('captures reporter accountId and displayName', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.reporter).toEqual({ accountId: 'acc-bob', displayName: 'Bob' });
  });

  it('captures created and updated timestamps', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.created).toBe('2024-01-01T00:00:00.000Z');
    expect(payload.updated).toBe('2024-01-15T12:00:00.000Z');
  });

  it('captures resolutionDate as null when not resolved', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.resolutionDate).toBeNull();
  });

  it('captures resolutionDate as string when resolved', () => {
    const raw = makeFullRawIssue();
    raw.fields['resolutiondate'] = '2024-02-01T00:00:00.000Z';
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.resolutionDate).toBe('2024-02-01T00:00:00.000Z');
  });

  it('captures labels array', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.labels).toEqual(['backend', 'urgent']);
  });

  it('returns empty labels array when missing', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['labels'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.labels).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Custom field values — coverage invariant
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — customFieldValues coverage invariant', () => {
  it('customFieldValues contains every ID in allCustomFieldIds', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    for (const id of ALL_CUSTOM_FIELD_IDS) {
      expect(id in payload.customFieldValues).toBe(true);
    }
  });

  it('customFieldValues key count equals allCustomFieldIds length', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(Object.keys(payload.customFieldValues)).toHaveLength(ALL_CUSTOM_FIELD_IDS.length);
  });

  it('captures the value of each custom field from the raw issue', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.customFieldValues['customfield_10016']).toBe(5);
    expect(payload.customFieldValues['customfield_10000']).toBe('team-alpha');
  });

  it('stores null for a custom field that is absent on this issue', () => {
    const ids = ['customfield_10016', 'customfield_99999'];
    const payload = assembleIssuePayload(makeFullRawIssue(), ids);
    expect(payload.customFieldValues['customfield_99999']).toBeNull();
  });

  it('assertCoverageInvariant returns true when invariant holds', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(assertCoverageInvariant(payload, ALL_CUSTOM_FIELD_IDS)).toBe(true);
  });

  it('assertCoverageInvariant throws when capturedCustomFields !== discoveredCustomFields', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    const extraIds = [...ALL_CUSTOM_FIELD_IDS, 'customfield_99998', 'customfield_99999'];
    expect(() => assertCoverageInvariant(payload, extraIds)).toThrow(
      /Coverage invariant violation/
    );
  });

  it('system field keys do NOT appear in customFieldValues', () => {
    const systemFields = ['summary', 'description', 'status', 'priority', 'assignee', 'reporter'];
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    for (const sys of systemFields) {
      expect(sys in payload.customFieldValues).toBe(false);
    }
  });

  it('works correctly with an empty custom field list', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), []);
    expect(Object.keys(payload.customFieldValues)).toHaveLength(0);
    expect(assertCoverageInvariant(payload, [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — comments', () => {
  it('captures all comments with correct count', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments).toHaveLength(2);
  });

  it('captures comment id', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments[0].id).toBe('cmt-001');
    expect(payload.comments[1].id).toBe('cmt-002');
  });

  it('captures comment author accountId and displayName', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments[0].author).toEqual({ accountId: 'acc-alice', displayName: 'Alice' });
    expect(payload.comments[1].author).toEqual({ accountId: 'acc-bob', displayName: 'Bob' });
  });

  it('captures comment body as AdfNode', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments[0].body).toMatchObject({ type: 'doc' });
  });

  it('captures comment created and updated timestamps', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments[0].created).toBe('2024-01-02T09:00:00.000Z');
    expect(payload.comments[1].updated).toBe('2024-01-03T10:30:00.000Z');
  });

  it('returns empty comments array when no comments exist', () => {
    const raw = makeFullRawIssue();
    (raw.fields['comment'] as { comments: unknown[] }).comments = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Issue links — both directions
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — issueLinks (both inward and outward)', () => {
  it('captures all issue links', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.issueLinks).toHaveLength(2);
  });

  it('captures outward link with outwardIssue populated', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    const outward = payload.issueLinks.find((l) => l.id === 'link-001');
    expect(outward).toBeDefined();
    expect(outward!.type).toEqual({ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' });
    expect(outward!.outwardIssue).toEqual({ id: '10002', key: 'PROJ-2' });
    expect(outward!.inwardIssue).toBeUndefined();
  });

  it('captures inward link with inwardIssue populated', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    const inward = payload.issueLinks.find((l) => l.id === 'link-002');
    expect(inward).toBeDefined();
    expect(inward!.type).toEqual({ name: 'Relates', inward: 'is related to', outward: 'relates to' });
    expect(inward!.inwardIssue).toEqual({ id: '10003', key: 'PROJ-3' });
    expect(inward!.outwardIssue).toBeUndefined();
  });

  it('returns empty issueLinks array when no links exist', () => {
    const raw = makeFullRawIssue();
    raw.fields['issuelinks'] = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.issueLinks).toHaveLength(0);
  });

  it('captures both inward and outward on a bidirectional link', () => {
    const raw = makeFullRawIssue();
    (raw.fields['issuelinks'] as unknown[]) = [
      {
        id: 'link-bi',
        type: { name: 'Clones', inward: 'is cloned by', outward: 'clones' },
        inwardIssue: { id: '10010', key: 'PROJ-10' },
        outwardIssue: { id: '10011', key: 'PROJ-11' },
      },
    ];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.issueLinks[0].inwardIssue).toEqual({ id: '10010', key: 'PROJ-10' });
    expect(payload.issueLinks[0].outwardIssue).toEqual({ id: '10011', key: 'PROJ-11' });
  });
});

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — subtasks', () => {
  it('captures subtask keys', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.subtaskKeys).toEqual(['PROJ-4', 'PROJ-5']);
  });

  it('returns empty subtaskKeys when no subtasks', () => {
    const raw = makeFullRawIssue();
    raw.fields['subtasks'] = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.subtaskKeys).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sprint membership
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — sprint membership', () => {
  it('extracts sprint IDs from the sprint custom field', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.sprintIds).toContain('42');
  });

  it('captures closed sprint IDs', () => {
    const raw = makeFullRawIssue();
    raw.fields['customfield_10020'] = [
      { id: 10, name: 'Old Sprint', state: 'closed', boardId: 1 },
    ];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.sprintIds).toContain('10');
  });

  it('captures future sprint IDs', () => {
    const raw = makeFullRawIssue();
    raw.fields['customfield_10020'] = [
      { id: 99, name: 'Future Sprint', state: 'future', boardId: 2 },
    ];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.sprintIds).toContain('99');
  });

  it('returns empty sprintIds when issue has no sprint', () => {
    const raw = makeFullRawIssue();
    raw.fields['customfield_10020'] = null;
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.sprintIds).toHaveLength(0);
  });

  it('deduplicates sprint IDs', () => {
    const raw = makeFullRawIssue();
    // Same sprint appearing twice (edge case)
    raw.fields['customfield_10020'] = [
      { id: 42, name: 'Sprint 1', state: 'active', boardId: 1 },
      { id: 42, name: 'Sprint 1', state: 'active', boardId: 1 },
    ];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.sprintIds).toHaveLength(1);
    expect(payload.sprintIds[0]).toBe('42');
  });

  it('extracts sprints from any custom field that contains sprint objects', () => {
    const raw = makeFullRawIssue();
    // Sprint field at a non-standard ID
    const ids = ['customfield_99001'];
    raw.fields['customfield_99001'] = [
      { id: 77, name: 'Sprint X', state: 'active', boardId: 5 },
    ];
    const payload = assembleIssuePayload(raw, ids);
    expect(payload.sprintIds).toContain('77');
  });
});

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — watchers', () => {
  it('captures all watcher accountIds', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.watcherAccountIds).toEqual([
      'acc-watcher-1',
      'acc-watcher-2',
      'acc-watcher-3',
    ]);
  });

  it('returns empty watcherAccountIds when there are no watchers', () => {
    const raw = makeFullRawIssue();
    (raw.fields['watches'] as { watchers: unknown[] }).watchers = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.watcherAccountIds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Worklogs
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — worklogs', () => {
  it('captures all worklog entries', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.worklogs).toHaveLength(2);
  });

  it('captures worklog id, author, timeSpentSeconds, started', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.worklogs[0]).toEqual({
      id: 'wl-001',
      author: { accountId: 'acc-alice' },
      timeSpentSeconds: 3600,
      started: '2024-01-10T09:00:00.000Z',
    });
    expect(payload.worklogs[1]).toEqual({
      id: 'wl-002',
      author: { accountId: 'acc-bob' },
      timeSpentSeconds: 7200,
      started: '2024-01-11T14:00:00.000Z',
    });
  });

  it('returns empty worklogs when there are no worklog entries', () => {
    const raw = makeFullRawIssue();
    (raw.fields['worklog'] as { worklogs: unknown[] }).worklogs = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.worklogs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Attachment refs
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — attachment refs (no binary download)', () => {
  it('captures attachment id', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].id).toBe('att-001');
  });

  it('captures attachment filename', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].filename).toBe('screenshot.png');
  });

  it('captures attachment mimeType', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].mimeType).toBe('image/png');
  });

  it('captures attachment size', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].size).toBe(10240);
  });

  it('captures attachment contentUrl from raw content field', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].contentUrl).toBe(
      'https://example.atlassian.net/rest/api/3/attachment/content/att-001'
    );
  });

  it('sets contentHash to empty string — not downloaded yet', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].contentHash).toBe('');
  });

  it('captures attachment author accountId', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].author).toEqual({ accountId: 'acc-alice' });
  });

  it('captures attachment created timestamp', () => {
    const payload = assembleIssuePayload(makeFullRawIssue(), ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments[0].created).toBe('2024-01-01T12:00:00.000Z');
  });

  it('returns empty attachments array when there are none', () => {
    const raw = makeFullRawIssue();
    raw.fields['attachment'] = [];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments).toHaveLength(0);
  });

  it('captures multiple attachments', () => {
    const raw = makeFullRawIssue();
    (raw.fields['attachment'] as unknown[]).push({
      id: 'att-002',
      filename: 'log.txt',
      mimeType: 'text/plain',
      size: 512,
      created: '2024-01-02T00:00:00.000Z',
      author: { accountId: 'acc-bob' },
      content: 'https://example.atlassian.net/rest/api/3/attachment/content/att-002',
    });
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments).toHaveLength(2);
    expect(payload.attachments[1].id).toBe('att-002');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('assembleIssuePayload — edge cases', () => {
  it('returns null description when description field is absent', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['description'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.description).toBeNull();
  });

  it('handles missing watches container gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['watches'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.watcherAccountIds).toEqual([]);
  });

  it('handles missing worklog container gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['worklog'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.worklogs).toEqual([]);
  });

  it('handles missing comment container gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['comment'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.comments).toEqual([]);
  });

  it('handles missing issuelinks gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['issuelinks'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.issueLinks).toEqual([]);
  });

  it('handles missing subtasks gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['subtasks'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.subtaskKeys).toEqual([]);
  });

  it('handles missing attachment field gracefully', () => {
    const raw = makeFullRawIssue();
    delete raw.fields['attachment'];
    const payload = assembleIssuePayload(raw, ALL_CUSTOM_FIELD_IDS);
    expect(payload.attachments).toEqual([]);
  });
});
