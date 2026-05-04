import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CaptureOrchestrator } from './CaptureOrchestrator.js';
import type {
  IJiraHttpClient,
  CaptureProgressEvent,
  BackupManifest,
  ProjectRecord,
  RawIssue,
} from '../backup/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    projectId: '10001',
    projectKey: 'TEST',
    projectName: 'Test Project',
    projectTypeKey: 'software',
    issueCounts: { total: 0, backed: 0, errored: 0 },
    boardIds: [],
    sprintIds: [],
    changeBadge: 'added',
    ...overrides,
  };
}

function makeManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    manifestId: 'manifest-test-001',
    cloudId: 'cloud-test-123',
    discoveredAt: '2024-01-01T00:00:00.000Z',
    projectScope: 'all',
    selectedProjectKeys: [],
    projects: [makeProject()],
    jsmDeferredProjects: [],
    fieldContexts: null,
    customFieldsCaptured: null,
    customFieldsSkipped: [],
    coverageInvariant: null,
    ...overrides,
  };
}

function makeRawIssue(
  key: string,
  customFields: Record<string, unknown> = {}
): RawIssue {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary for ${key}`,
      description: null,
      issuetype: { id: '1', name: 'Task' },
      status: { id: '1', name: 'Open' },
      priority: null,
      assignee: null,
      reporter: null,
      created: '2024-01-01T00:00:00.000Z',
      updated: '2024-01-01T00:00:00.000Z',
      resolutiondate: null,
      labels: [],
      project: { id: '10001' },
      comment: { comments: [] },
      issuelinks: [],
      subtasks: [],
      watches: { watchers: [] },
      worklog: { worklogs: [] },
      attachment: [],
      ...customFields,
    },
  };
}

/** Build a minimal IJiraHttpClient mock with one custom field and one issue per project. */
function makeMockClient(
  customFieldIds: string[] = ['customfield_10016'],
  issuesByProject: Record<string, RawIssue[]> = {}
): IJiraHttpClient {
  return {
    getJson: vi.fn(async (_base: string, path: string) => {
      if (path === '/rest/api/3/field') {
        return customFieldIds.map((id) => ({ id, name: id, custom: true }));
      }
      if (path.includes('/context')) {
        return {
          startAt: 0,
          maxResults: 50,
          isLast: true,
          values: [
            { id: 'ctx-1', name: 'Default Context', isGlobalContext: true, isAnyIssueType: true },
          ],
        };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }),

    searchJql: vi.fn(),
    downloadAttachment: vi.fn(),

    enumerateIssues: vi.fn(async (_base: string, projectKey: string) => {
      const customFieldDefaults: Record<string, unknown> = {};
      for (const id of customFieldIds) customFieldDefaults[id] = null;
      return (
        issuesByProject[projectKey] ?? [
          makeRawIssue(`${projectKey}-1`, customFieldDefaults),
        ]
      );
    }),
  } as unknown as IJiraHttpClient;
}

const CLOUD_BASE = 'https://api.atlassian.com/ex/jira/cloud-test-123';
const BASE_OPTIONS = {
  connectionId: 'conn-test',
  cloudId: 'cloud-test-123',
  cloudBaseUrl: CLOUD_BASE,
  manifestId: 'manifest-test-001',
  projectScope: 'all' as const,
};

// ---------------------------------------------------------------------------
// Phase ordering — core integration assertion
// ---------------------------------------------------------------------------

describe('CaptureOrchestrator — phase ordering', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits events in order: CustomField → Project → Issue', async () => {
    const client = makeMockClient();
    const manifest = makeManifest();
    const orchestrator = new CaptureOrchestrator(client, manifest);
    const events: CaptureProgressEvent[] = [];

    await orchestrator.runCapture(BASE_OPTIONS, (e) => events.push(e));

    const phases = events.map((e) => e.phase);
    const firstCustomField = phases.indexOf('CustomField');
    const firstProject = phases.indexOf('Project');
    const firstIssue = phases.indexOf('Issue');

    expect(firstCustomField).toBeGreaterThanOrEqual(0);
    expect(firstProject).toBeGreaterThan(firstCustomField);
    expect(firstIssue).toBeGreaterThan(firstProject);
  });

  it('runs CustomField before Project before Issue in phaseResults', async () => {
    const client = makeMockClient();
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    const phaseNames = result.phaseResults.map((p) => p.phase);
    expect(phaseNames.indexOf('CustomField')).toBeLessThan(phaseNames.indexOf('Project'));
    expect(phaseNames.indexOf('Project')).toBeLessThan(phaseNames.indexOf('Issue'));
  });
});

// ---------------------------------------------------------------------------
// CustomField phase
// ---------------------------------------------------------------------------

describe('CaptureOrchestrator — CustomField phase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('CustomField phase status is ok and itemCount equals custom field count', async () => {
    const client = makeMockClient(['customfield_10016', 'customfield_10020']);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    const cf = result.phaseResults.find((p) => p.phase === 'CustomField');
    expect(cf?.status).toBe('ok');
    expect(cf?.itemCount).toBe(2);
    expect(cf?.errorCount).toBe(0);
  });

  it('returns discovered fieldContexts in CaptureRunResult', async () => {
    const client = makeMockClient(['customfield_10016']);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    expect(result.fieldContexts).toHaveLength(1);
    expect(result.fieldContexts[0].fieldId).toBe('customfield_10016');
    expect(result.fieldContexts[0].custom).toBe(true);
  });

  it('customFieldsSkipped is empty when all custom fields succeed', async () => {
    // customFieldsSkipped is derived by JiraWorkload.snapshot() from the result;
    // the orchestrator surfaces field contexts for the caller to compute skipped.
    const client = makeMockClient(['customfield_10016']);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    // No errors in CustomField phase → skipped list is empty
    const cf = result.phaseResults.find((p) => p.phase === 'CustomField');
    expect(cf?.errorCount).toBe(0);
    expect(result.fieldContexts.length).toBeGreaterThan(0);
  });

  it('halts with phaseDiagnostic when CustomField phase throws', async () => {
    const failingClient: IJiraHttpClient = {
      getJson: vi.fn(async () => { throw new Error('field-list API down'); }),
      searchJql: vi.fn(),
      downloadAttachment: vi.fn(),
      enumerateIssues: vi.fn(),
    } as unknown as IJiraHttpClient;

    const orchestrator = new CaptureOrchestrator(failingClient, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    expect(result.phaseDiagnostic).toMatch(/CustomField phase/);
    expect(result.errorCount).toBeGreaterThan(0);
    // Project and Issue phases must NOT have run
    const phaseNames = result.phaseResults.map((p) => p.phase);
    expect(phaseNames).not.toContain('Project');
    expect(phaseNames).not.toContain('Issue');
  });
});

// ---------------------------------------------------------------------------
// Issue phase
// ---------------------------------------------------------------------------

describe('CaptureOrchestrator — Issue phase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('Issue phase captures one issue per project', async () => {
    const customFieldIds = ['customfield_10016'];
    const client = makeMockClient(customFieldIds, {
      TEST: [makeRawIssue('TEST-1', { customfield_10016: 5 })],
    });
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    const issuePh = result.phaseResults.find((p) => p.phase === 'Issue');
    expect(issuePh?.status).toBe('ok');
    expect(issuePh?.itemCount).toBe(1);
    expect(issuePh?.errorCount).toBe(0);
  });

  it('uses POST /rest/api/3/search/jql for issue enumeration', async () => {
    const client = makeMockClient();
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    await orchestrator.runCapture(BASE_OPTIONS, () => {});

    // enumerateIssues should have been called (which internally posts to search/jql)
    expect(client.enumerateIssues).toHaveBeenCalledOnce();
    const [baseArg, projectKeyArg] = (client.enumerateIssues as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(baseArg).toBe(CLOUD_BASE);
    expect(projectKeyArg).toBe('TEST');
  });

  it('emits at least one Issue-phase progress event during enumeration', async () => {
    const client = makeMockClient();
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const events: CaptureProgressEvent[] = [];

    await orchestrator.runCapture(BASE_OPTIONS, (e) => events.push(e));

    const issueEvents = events.filter((e) => e.phase === 'Issue');
    expect(issueEvents.length).toBeGreaterThan(0);
  });

  it('handles multiple projects — enumerates each', async () => {
    const customFieldIds = ['customfield_10016'];
    const projects: ProjectRecord[] = [
      makeProject({ projectKey: 'ALPHA', projectId: '1' }),
      makeProject({ projectKey: 'BETA', projectId: '2' }),
    ];
    const client = makeMockClient(customFieldIds, {
      ALPHA: [makeRawIssue('ALPHA-1', { customfield_10016: 1 })],
      BETA: [
        makeRawIssue('BETA-1', { customfield_10016: 2 }),
        makeRawIssue('BETA-2', { customfield_10016: 3 }),
      ],
    });

    const orchestrator = new CaptureOrchestrator(
      client,
      makeManifest({ projects })
    );
    const result = await orchestrator.runCapture(
      { ...BASE_OPTIONS, manifestId: 'manifest-multi' },
      () => {}
    );

    const issuePh = result.phaseResults.find((p) => p.phase === 'Issue');
    expect(issuePh?.itemCount).toBe(3); // ALPHA-1 + BETA-1 + BETA-2
    expect(result.errorCount).toBe(0);
    expect(client.enumerateIssues).toHaveBeenCalledTimes(2);
  });

  it('counts errored issues separately, does not halt phase', async () => {
    // Make enumerateIssues throw for one project
    const projects: ProjectRecord[] = [
      makeProject({ projectKey: 'GOOD', projectId: '1' }),
      makeProject({ projectKey: 'BAD', projectId: '2' }),
    ];
    const client: IJiraHttpClient = {
      getJson: vi.fn(async (_base: string, path: string) => {
        if (path === '/rest/api/3/field') return [{ id: 'customfield_10016', name: 'SP', custom: true }];
        if (path.includes('/context')) return { startAt: 0, maxResults: 50, isLast: true, values: [{ id: 'ctx-1', name: 'Default', isGlobalContext: true, isAnyIssueType: true }] };
        throw new Error(`Unexpected: ${path}`);
      }),
      searchJql: vi.fn(),
      downloadAttachment: vi.fn(),
      enumerateIssues: vi.fn(async (_base: string, projectKey: string) => {
        if (projectKey === 'BAD') throw new Error('API error on BAD project');
        return [makeRawIssue('GOOD-1', { customfield_10016: null })];
      }),
    } as unknown as IJiraHttpClient;

    const orchestrator = new CaptureOrchestrator(client, makeManifest({ projects }));
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    const issuePh = result.phaseResults.find((p) => p.phase === 'Issue');
    expect(issuePh?.itemCount).toBe(1);  // GOOD-1 captured
    expect(issuePh?.errorCount).toBe(1); // BAD project errored
    expect(issuePh?.status).toBe('partial');
    // Phase diagnostic is NOT set for partial — only set when a phase halts entirely
    expect(result.phaseDiagnostic).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Full snapshot integration — asserts complete capture round-trip
// ---------------------------------------------------------------------------

describe('CaptureOrchestrator — full snapshot integration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('runs all three phases against a mock and returns no errors', async () => {
    const customFieldIds = ['customfield_10016', 'customfield_10020'];
    const client = makeMockClient(customFieldIds, {
      TEST: [
        makeRawIssue('TEST-1', { customfield_10016: 5, customfield_10020: null }),
        makeRawIssue('TEST-2', { customfield_10016: 8, customfield_10020: null }),
      ],
    });
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const events: CaptureProgressEvent[] = [];

    const result = await orchestrator.runCapture(BASE_OPTIONS, (e) => events.push(e));

    // All phases present
    const phaseNames = result.phaseResults.map((p) => p.phase);
    expect(phaseNames).toContain('CustomField');
    expect(phaseNames).toContain('Project');
    expect(phaseNames).toContain('Issue');

    // No errors
    expect(result.errorCount).toBe(0);
    expect(result.phaseDiagnostic).toBeUndefined();

    // customFieldsCaptured = 2
    const cfPhase = result.phaseResults.find((p) => p.phase === 'CustomField');
    expect(cfPhase?.itemCount).toBe(2); // customFieldsCaptured roll-up

    // 2 issues captured
    const issuePhase = result.phaseResults.find((p) => p.phase === 'Issue');
    expect(issuePhase?.itemCount).toBe(2);

    // Phase event order: CustomField → Project → Issue
    const emittedPhases = events.map((e) => e.phase);
    expect(emittedPhases.indexOf('CustomField')).toBeLessThan(
      emittedPhases.indexOf('Project')
    );
    expect(emittedPhases.indexOf('Project')).toBeLessThan(
      emittedPhases.indexOf('Issue')
    );

    // backupPointId matches manifestId
    expect(result.backupPointId).toBe('manifest-test-001');
  });

  it('customFieldsCaptured count matches fieldContexts length', async () => {
    const customFieldIds = ['customfield_10016', 'customfield_10020', 'customfield_10100'];
    const client = makeMockClient(customFieldIds);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    const cfPhase = result.phaseResults.find((p) => p.phase === 'CustomField');
    // itemCount in CustomField phase IS customFieldsCaptured
    expect(cfPhase?.itemCount).toBe(customFieldIds.length);
    expect(result.fieldContexts).toHaveLength(customFieldIds.length);
  });

  it('skipped (system) fields do not appear in fieldContexts', async () => {
    // Mock: 2 system fields + 1 custom field
    const client: IJiraHttpClient = {
      getJson: vi.fn(async (_base: string, path: string) => {
        if (path === '/rest/api/3/field') {
          return [
            { id: 'status', name: 'Status', custom: false },
            { id: 'priority', name: 'Priority', custom: false },
            { id: 'customfield_10016', name: 'Story Points', custom: true },
          ];
        }
        if (path.includes('/context')) {
          return { startAt: 0, maxResults: 50, isLast: true, values: [{ id: 'ctx-1', name: 'Default', isGlobalContext: true, isAnyIssueType: true }] };
        }
        throw new Error(`Unexpected: ${path}`);
      }),
      searchJql: vi.fn(),
      downloadAttachment: vi.fn(),
      enumerateIssues: vi.fn(async () => [makeRawIssue('TEST-1', { customfield_10016: 3 })]),
    } as unknown as IJiraHttpClient;

    const orchestrator = new CaptureOrchestrator(client, makeManifest());
    const result = await orchestrator.runCapture(BASE_OPTIONS, () => {});

    // fieldContexts only contains the 1 custom field
    expect(result.fieldContexts).toHaveLength(1);
    expect(result.fieldContexts[0].fieldId).toBe('customfield_10016');

    // Context endpoint was NOT called for system fields
    const contextCalls = (client.getJson as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, p]: [string, string]) => typeof p === 'string' && p.includes('/context')
    );
    expect(contextCalls).toHaveLength(1); // only customfield_10016
  });
});
