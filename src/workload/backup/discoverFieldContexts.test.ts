import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverFieldContexts } from './discoverFieldContexts.js';
import type { IJiraHttpClient } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(id: string, name: string, custom: boolean) {
  return { id, name, custom };
}

function makeContextPage(
  contexts: Array<{ id: string; name: string; isGlobalContext: boolean; isAnyIssueType: boolean }>,
  isLast = true,
  maxResults = 50
) {
  return { startAt: 0, maxResults, isLast, values: contexts };
}

function makeContext(id: string, name = 'Default Context') {
  return { id, name, isGlobalContext: true, isAnyIssueType: true };
}

// ---------------------------------------------------------------------------
// Core acceptance criterion: zero context calls for system fields
// ---------------------------------------------------------------------------

describe('discoverFieldContexts — mixed custom/system fixture', () => {
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls context endpoint ONLY for custom fields, never for system fields', async () => {
    const fields = [
      makeField('status', 'Status', false),
      makeField('priority', 'Priority', false),
      makeField('customfield_10016', 'Story Points', true),
      makeField('summary', 'Summary', false),
      makeField('customfield_10020', 'Sprint', true),
    ];

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      // context endpoint — return single context
      if (path.includes('/context')) {
        const fieldId = path.split('/')[4]; // /rest/api/3/field/{id}/context
        return makeContextPage([makeContext(`ctx-${fieldId}`)]);
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    // Collect all context-endpoint calls
    const contextCalls = getJson.mock.calls.filter(
      ([, path]) => typeof path === 'string' && (path as string).includes('/context')
    );

    // Exactly 2 context calls — one per custom field
    expect(contextCalls).toHaveLength(2);

    const contextPaths = contextCalls.map(([, path]) => path as string);
    // Custom fields were fetched
    expect(contextPaths.some(p => p.includes('customfield_10016'))).toBe(true);
    expect(contextPaths.some(p => p.includes('customfield_10020'))).toBe(true);
    // System fields were NOT fetched
    expect(contextPaths.some(p => p.includes('status'))).toBe(false);
    expect(contextPaths.some(p => p.includes('priority'))).toBe(false);
    expect(contextPaths.some(p => p.includes('summary'))).toBe(false);

    // Result contains only the 2 custom fields
    expect(result).toHaveLength(2);
    expect(result.map(r => r.fieldId).sort()).toEqual(['customfield_10016', 'customfield_10020']);
    expect(result.every(r => r.custom === true)).toBe(true);
  });

  it('emits [field-context] skip log for every system field', async () => {
    const fields = [
      makeField('status', 'Status', false),
      makeField('priority', 'Priority', false),
      makeField('customfield_10016', 'Story Points', true),
    ];

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      return makeContextPage([makeContext('ctx-1')]);
    });

    const client = { getJson } as unknown as IJiraHttpClient;
    await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    const skipLogs = logs.filter(l => l.includes('[field-context]') && l.includes('skip'));
    expect(skipLogs).toHaveLength(2);
    expect(skipLogs[0]).toMatch(/\[field-context\] skip field_id=status reason=system-field/);
    expect(skipLogs[1]).toMatch(/\[field-context\] skip field_id=priority reason=system-field/);
  });

  it('emits [field-context] fetch log for each custom field with contextCount', async () => {
    const fields = [
      makeField('status', 'Status', false),
      makeField('customfield_10016', 'Story Points', true),
    ];

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      return makeContextPage([makeContext('ctx-1'), makeContext('ctx-2')]);
    });

    const client = { getJson } as unknown as IJiraHttpClient;
    await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    const fetchLogs = logs.filter(l => l.includes('[field-context]') && l.includes('fetch'));
    expect(fetchLogs).toHaveLength(1);
    expect(fetchLogs[0]).toMatch(/\[field-context\] fetch field_id=customfield_10016 contextCount=2/);
  });

  it('returns empty array when all fields are system fields', async () => {
    const fields = [
      makeField('status', 'Status', false),
      makeField('priority', 'Priority', false),
    ];

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      throw new Error('Context endpoint must not be called for system fields');
    });

    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    expect(result).toHaveLength(0);
    // Context endpoint never called
    const contextCalls = getJson.mock.calls.filter(([, p]) => (p as string).includes('/context'));
    expect(contextCalls).toHaveLength(0);
  });

  it('returns empty array and no skip logs when field list is empty', async () => {
    const getJson = vi.fn(async () => [] as unknown[]);
    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    expect(result).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Context pagination
// ---------------------------------------------------------------------------

describe('discoverFieldContexts — context pagination', () => {
  afterEach(() => vi.restoreAllMocks());

  it('paginates context endpoint until isLast=true', async () => {
    const fields = [makeField('customfield_10016', 'Story Points', true)];

    const page1 = {
      startAt: 0, maxResults: 2, isLast: false,
      values: [makeContext('ctx-1'), makeContext('ctx-2')],
    };
    const page2 = {
      startAt: 2, maxResults: 2, isLast: true,
      values: [makeContext('ctx-3')],
    };

    let call = 0;
    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      call++;
      return call === 1 ? page1 : page2;
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    expect(result).toHaveLength(1);
    expect(result[0].contexts).toHaveLength(3);
    // 1 field-list call + 2 context pages
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it('stops on partial page (values.length < maxResults)', async () => {
    const fields = [makeField('customfield_10016', 'Story Points', true)];

    // maxResults=50, only 10 returned → partial page, stop immediately
    const page = { startAt: 0, maxResults: 50, values: Array.from({ length: 10 }, (_, i) => makeContext(`ctx-${i}`)) };

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      return page;
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    expect(result[0].contexts).toHaveLength(10);
    // 1 field-list + 1 context page
    expect(getJson).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// FieldContextRecord shape
// ---------------------------------------------------------------------------

describe('discoverFieldContexts — FieldContextRecord shape', () => {
  afterEach(() => vi.restoreAllMocks());

  it('persists fieldId, fieldName, custom=true, and context array', async () => {
    const fields = [makeField('customfield_10016', 'Story Points', true)];
    const ctx = { id: 'ctx-42', name: 'Global Context', isGlobalContext: true, isAnyIssueType: false };

    const getJson = vi.fn(async (_cloudBaseUrl: string, path: string) => {
      if (path === '/rest/api/3/field') return fields;
      return makeContextPage([ctx]);
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = { getJson } as unknown as IJiraHttpClient;
    const result = await discoverFieldContexts(client, 'https://api.atlassian.com/ex/jira/cloud-123');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      fieldId: 'customfield_10016',
      fieldName: 'Story Points',
      custom: true,
      contexts: [{
        id: 'ctx-42',
        name: 'Global Context',
        isGlobalContext: true,
        isAnyIssueType: false,
      }],
    });
  });
});
