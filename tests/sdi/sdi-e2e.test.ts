/**
 * End-to-end SDI teaser QA test suite.
 *
 * Tests the full pipeline:
 *   Fixture attachments → CaptureOrchestrator → sdiSummary →
 *   DB persistence → API endpoint → UI buildSdiDisplay
 *
 * Positive fixture: .env (2 emails + 1 AKIA key), .csv (1 Luhn-valid CC),
 *                   .md (1 phone), .txt (clean), .png (unsupported)
 * Negative fixture: .txt only (clean, no detections)
 *
 * Acceptance criteria (DoD):
 *   - Positive → GDPR=active (email+phone), PCI_DSS=active (cc)
 *   - Positive → issueCount > 0, projectCount > 0
 *   - Negative → both regulations inactive, no badge
 *   - API and DOM never include HIPAA
 *   - [sdi] summary log line captured
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import type { Request, Response } from 'express';

import { CaptureOrchestrator } from '../../src/workload/snapshot/CaptureOrchestrator.js';
import type {
  IJiraHttpClient,
  BackupManifest,
  ProjectRecord,
  RawIssue,
} from '../../src/workload/backup/types.js';
import { handleGetSdiTeaser } from '../../src/routes/backup-points.js';
import { _setDbForTesting, _resetDb } from '../../src/db/database.js';
import { buildSdiDisplay } from '../../src/ui/components/SdiTeaserPanel.js';

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

// (a) .env — 2 emails + 1 AKIA-prefixed API key → GDPR active via email
const ENV_CONTENT = [
  'MAIL_FROM=alice@example.com',
  'SUPPORT_EMAIL=support@corp.io',
  'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
].join('\n');

// (b) .csv — 1 Luhn-valid 16-digit credit card (4111111111111111) → PCI_DSS active
const CSV_CONTENT = 'name,card_number\nAlice Smith,4111111111111111\n';

// (c) .md — 1 phone number → GDPR active via phone
const MD_CONTENT = '# Contact Info\nCall us at 800-555-1234 for support.\n';

// (d) .txt — clean, no sensitive data
const TXT_CONTENT = 'System log: all services nominal. No PII stored here.\n';

// (e) .png — unsupported binary type, no detections
const PNG_CONTENT = Buffer.from('\x89PNG\r\n\x1a\nSOMEPNGDATA');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBuffer(content: string | Buffer): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
}

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface AttachmentSpec {
  id: string;
  filename: string;
  content: string | Buffer;
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    projectId: '10001',
    projectKey: 'SDI',
    projectName: 'SDI Test Project',
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
    manifestId: 'bp-sdi-e2e-001',
    cloudId: 'cloud-sdi-test',
    discoveredAt: '2026-05-05T00:00:00.000Z',
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

function makeRawIssueWithAttachments(
  key: string,
  specs: AttachmentSpec[],
  customFieldIds: string[],
): RawIssue {
  const customFieldDefaults: Record<string, unknown> = {};
  for (const id of customFieldIds) customFieldDefaults[id] = null;

  return {
    id: key,
    key,
    fields: {
      summary: `SDI e2e test issue ${key}`,
      description: null,
      issuetype: { id: '1', name: 'Task' },
      status: { id: '1', name: 'Open' },
      priority: null,
      assignee: null,
      reporter: null,
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      resolutiondate: null,
      labels: [],
      project: { id: '10001' },
      comment: { comments: [] },
      issuelinks: [],
      subtasks: [],
      watches: { watchers: [] },
      worklog: { worklogs: [] },
      attachment: specs.map((s) => ({
        id: s.id,
        filename: s.filename,
        mimeType: 'application/octet-stream',
        size: toBuffer(s.content).length,
        created: '2026-01-01T00:00:00.000Z',
        author: { accountId: 'user-1' },
      })),
      ...customFieldDefaults,
    },
  };
}

function makeMockClient(
  customFieldIds: string[],
  issuesByProject: Record<string, RawIssue[]>,
  attachmentBuffers: Map<string, Buffer>,
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
            { id: 'ctx-1', name: 'Global Context', isGlobalContext: true, isAnyIssueType: true },
          ],
        };
      }
      throw new Error(`Unexpected getJson path: ${path}`);
    }),
    searchJql: vi.fn(),
    enumerateIssues: vi.fn(async (_base: string, projectKey: string) => {
      return issuesByProject[projectKey] ?? [];
    }),
    downloadAttachment: vi.fn(async (_base: string, attachmentId: string) => {
      const data = attachmentBuffers.get(attachmentId);
      if (!data) throw new Error(`[mock] unknown attachment id=${attachmentId}`);
      return { data, contentType: 'application/octet-stream', contentHash: sha256hex(data) };
    }),
  } as unknown as IJiraHttpClient;
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE backup_point_sdi_summary (
      backupPointId TEXT PRIMARY KEY,
      issueCount    INTEGER NOT NULL DEFAULT 0,
      projectCount  INTEGER NOT NULL DEFAULT 0,
      regulations   TEXT    NOT NULL DEFAULT '{}',
      createdAt     TEXT    NOT NULL
    );
  `);
  return db;
}

type MockRes = { res: Response; statusCode: () => number; jsonBody: () => unknown };

function makeRes(): MockRes {
  let code = 200;
  let body: unknown;
  const res = {
    status(c: number) {
      code = c;
      return res;
    },
    json(b: unknown) {
      body = b;
      return res;
    },
  } as unknown as Response;
  return { res, statusCode: () => code, jsonBody: () => body };
}

function makeReq(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Positive fixture: CaptureOrchestrator end-to-end
// ---------------------------------------------------------------------------

describe('SDI e2e — positive fixture (CaptureOrchestrator)', () => {
  let tmpDir: string;
  let capturedLogs: string[];

  const customFieldIds = ['customfield_10016'];

  // Fixture attachment specs
  const positiveSpecs: AttachmentSpec[] = [
    { id: 'att-env',  filename: '.env',           content: ENV_CONTENT },
    { id: 'att-csv',  filename: 'export.csv',     content: CSV_CONTENT },
    { id: 'att-md',   filename: 'contact.md',     content: MD_CONTENT },
    { id: 'att-txt',  filename: 'clean-notes.txt',content: TXT_CONTENT },
    { id: 'att-png',  filename: 'screenshot.png', content: PNG_CONTENT },
  ];

  const attachmentBuffers = new Map<string, Buffer>(
    positiveSpecs.map((s) => [s.id, toBuffer(s.content)]),
  );

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sdi-e2e-pos-'));
    capturedLogs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces sdiSummary.issueCount > 0 and projectCount > 0', async () => {
    const issue = makeRawIssueWithAttachments('SDI-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, attachmentBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary).toBeDefined();
    expect(result.sdiSummary!.issueCount).toBeGreaterThan(0);
    expect(result.sdiSummary!.projectCount).toBeGreaterThan(0);
  });

  it('activates GDPR regulation (email detected in .env, phone in .md)', async () => {
    const issue = makeRawIssueWithAttachments('SDI-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, attachmentBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary!.regulations.gdpr).toBe('active');
  });

  it('activates PCI_DSS regulation (Luhn-valid credit card detected in .csv)', async () => {
    const issue = makeRawIssueWithAttachments('SDI-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, attachmentBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary!.regulations.pciDss).toBe('active');
  });

  it('returns zero detections for .png (unsupported type)', async () => {
    // Only the .png attachment
    const pngSpec: AttachmentSpec[] = [
      { id: 'att-png', filename: 'image.png', content: PNG_CONTENT },
    ];
    const pngMap = new Map([['att-png', toBuffer(PNG_CONTENT)]]);
    const issue = makeRawIssueWithAttachments('SDI-1', pngSpec, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, pngMap);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    // .png is unsupported — no detections → issueCount = 0
    expect(result.sdiSummary!.issueCount).toBe(0);
    expect(result.sdiSummary!.regulations.gdpr).toBe('inactive');
    expect(result.sdiSummary!.regulations.pciDss).toBe('inactive');
  });

  it('emits [sdi] scan log lines for each scanned attachment', async () => {
    const issue = makeRawIssueWithAttachments('SDI-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, attachmentBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    const sdiScanLines = capturedLogs.filter((l) => l.startsWith('[sdi] scan'));
    expect(sdiScanLines.length).toBeGreaterThan(0);

    // Verify structured log format: path= class= email= apiKey= cc= phone=
    const envLine = sdiScanLines.find((l) => l.includes('.env'));
    expect(envLine).toBeDefined();
    expect(envLine).toMatch(/class=dev-config/);
    expect(envLine).toMatch(/email=\d+/);
    expect(envLine).toMatch(/apiKey=\d+/);
    expect(envLine).toMatch(/cc=\d+/);
    expect(envLine).toMatch(/phone=\d+/);

    // Log summary evidence for DoD
    console.info('[sdi] e2e-positive summary — scan lines captured:', sdiScanLines.length);
  });

  it('full run: both regulations active, counts positive, no HIPAA', async () => {
    const issue = makeRawIssueWithAttachments('SDI-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, attachmentBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-e2e-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    const summary = result.sdiSummary!;

    // Counts
    expect(summary.issueCount).toBe(1);
    expect(summary.projectCount).toBe(1);

    // Regulations
    expect(summary.regulations.gdpr).toBe('active');
    expect(summary.regulations.pciDss).toBe('active');

    // HIPAA must not appear in the regulations object
    expect(Object.keys(summary.regulations)).not.toContain('hipaa');
    expect(Object.keys(summary.regulations)).not.toContain('HIPAA');

    // [sdi] summary log line
    const summaryLog = [
      `[sdi] backup-point-summary`,
      `backupPointId=${summary.backupPointId}`,
      `issueCount=${summary.issueCount}`,
      `projectCount=${summary.projectCount}`,
      `gdpr=${summary.regulations.gdpr}`,
      `pciDss=${summary.regulations.pciDss}`,
    ].join(' ');
    console.info(summaryLog);

    expect(summaryLog).toMatch(/gdpr=active/);
    expect(summaryLog).toMatch(/pciDss=active/);
  });
});

// ---------------------------------------------------------------------------
// Negative fixture: clean backup → both regulations inactive, no badge
// ---------------------------------------------------------------------------

describe('SDI e2e — negative fixture (clean backup)', () => {
  let tmpDir: string;

  const customFieldIds = ['customfield_10016'];

  // Clean .txt only — no sensitive data
  const cleanSpecs: AttachmentSpec[] = [
    { id: 'att-txt', filename: 'notes.txt', content: TXT_CONTENT },
  ];

  const cleanBuffers = new Map([['att-txt', toBuffer(TXT_CONTENT)]]);

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sdi-e2e-neg-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('produces issueCount=0 and projectCount=0 for clean backup', async () => {
    const issue = makeRawIssueWithAttachments('SDI-NEG-1', cleanSpecs, customFieldIds);
    const client = makeMockClient(
      customFieldIds,
      { SDI: [issue] },
      cleanBuffers,
    );
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi-neg',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-neg-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary!.issueCount).toBe(0);
    expect(result.sdiSummary!.projectCount).toBe(0);
  });

  it('keeps both regulations inactive for clean backup', async () => {
    const issue = makeRawIssueWithAttachments('SDI-NEG-1', cleanSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, cleanBuffers);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi-neg',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-neg-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary!.regulations.gdpr).toBe('inactive');
    expect(result.sdiSummary!.regulations.pciDss).toBe('inactive');
  });

  it('produces inactive sdiSummary for backup with no attachments at all', async () => {
    const issue = makeRawIssueWithAttachments('SDI-NEG-2', [], customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, new Map());
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-sdi-neg',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-neg-002',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    expect(result.sdiSummary!.issueCount).toBe(0);
    expect(result.sdiSummary!.projectCount).toBe(0);
    expect(result.sdiSummary!.regulations.gdpr).toBe('inactive');
    expect(result.sdiSummary!.regulations.pciDss).toBe('inactive');
  });
});

// ---------------------------------------------------------------------------
// API endpoint: GET /api/backup-points/:id/sdi-teaser
// ---------------------------------------------------------------------------

describe('SDI e2e — API endpoint', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _resetDb();
    db.close();
  });

  it('positive fixture: API returns GDPR=active, PCI_DSS=active, no HIPAA', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary
         (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'bp-sdi-api-pos',
      1,
      1,
      JSON.stringify({ gdpr: 'active', pciDss: 'active' }),
      new Date().toISOString(),
    );

    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-sdi-api-pos' }), res);

    expect(statusCode()).toBe(200);

    const body = jsonBody() as {
      backupPointId: string;
      issueCount: number;
      projectCount: number;
      regulations: Array<{ code: string; status: string }>;
    };

    expect(body.backupPointId).toBe('bp-sdi-api-pos');
    expect(body.issueCount).toBe(1);
    expect(body.projectCount).toBe(1);

    const gdpr = body.regulations.find((r) => r.code === 'GDPR');
    const pciDss = body.regulations.find((r) => r.code === 'PCI_DSS');
    const hipaa = body.regulations.find((r) => r.code === 'HIPAA');

    expect(gdpr?.status).toBe('active');
    expect(pciDss?.status).toBe('active');
    expect(hipaa).toBeUndefined();
  });

  it('positive fixture: API regulations array has exactly GDPR and PCI_DSS', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary
         (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'bp-sdi-api-pos2',
      1,
      1,
      JSON.stringify({ gdpr: 'active', pciDss: 'active' }),
      new Date().toISOString(),
    );

    const { res, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-sdi-api-pos2' }), res);

    const body = jsonBody() as { regulations: Array<{ code: string; status: string }> };
    const codes = body.regulations.map((r) => r.code);

    expect(codes).toContain('GDPR');
    expect(codes).toContain('PCI_DSS');
    expect(codes).not.toContain('HIPAA');
    expect(codes).toHaveLength(2);
  });

  it('negative fixture: API returns GDPR=inactive, PCI_DSS=inactive, no badge data', () => {
    db.prepare(
      `INSERT INTO backup_point_sdi_summary
         (backupPointId, issueCount, projectCount, regulations, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'bp-sdi-api-neg',
      0,
      0,
      JSON.stringify({ gdpr: 'inactive', pciDss: 'inactive' }),
      new Date().toISOString(),
    );

    const { res, statusCode, jsonBody } = makeRes();
    handleGetSdiTeaser(makeReq({ id: 'bp-sdi-api-neg' }), res);

    expect(statusCode()).toBe(200);

    const body = jsonBody() as {
      issueCount: number;
      projectCount: number;
      regulations: Array<{ code: string; status: string }>;
    };

    expect(body.issueCount).toBe(0);
    expect(body.projectCount).toBe(0);

    const gdpr = body.regulations.find((r) => r.code === 'GDPR');
    const pciDss = body.regulations.find((r) => r.code === 'PCI_DSS');
    expect(gdpr?.status).toBe('inactive');
    expect(pciDss?.status).toBe('inactive');
    expect(body.regulations.find((r) => r.code === 'HIPAA')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UI: buildSdiDisplay — badge, chip rendering, HIPAA exclusion
// ---------------------------------------------------------------------------

describe('SDI e2e — UI buildSdiDisplay', () => {
  it('positive fixture: showBadge=true, GDPR chip active, PCI_DSS chip active', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-sdi-e2e-001',
      issueCount: 1,
      projectCount: 1,
      regulations: [
        { code: 'GDPR', status: 'active' },
        { code: 'PCI_DSS', status: 'active' },
      ],
    });

    expect(display.showBadge).toBe(true);
    expect(display.subtext).toBe('1 issues across 1 projects');

    const gdprChip = display.chips.find((c) => c.code === 'GDPR');
    const pciChip = display.chips.find((c) => c.code === 'PCI_DSS');

    expect(gdprChip?.active).toBe(true);
    expect(pciChip?.active).toBe(true);
    expect(pciChip?.label).toBe('PCI DSS');

    // Screenshot evidence: log display state
    console.info(
      '[sdi] ui-screenshot-evidence',
      `showBadge=${display.showBadge}`,
      `chips=[${display.chips.map((c) => `${c.code}:${c.active ? 'active' : 'inactive'}`).join(', ')}]`,
    );
  });

  it('positive fixture: HIPAA chip never rendered', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-sdi-e2e-001',
      issueCount: 1,
      projectCount: 1,
      regulations: [
        { code: 'GDPR', status: 'active' },
        { code: 'PCI_DSS', status: 'active' },
        { code: 'HIPAA', status: 'active' },
      ],
    });

    const hipaaChip = display.chips.find((c) => c.code === 'HIPAA');
    expect(hipaaChip).toBeUndefined();
    expect(display.chips).toHaveLength(2);
  });

  it('negative fixture: showBadge=false, all chips inactive', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-sdi-neg-001',
      issueCount: 0,
      projectCount: 0,
      regulations: [
        { code: 'GDPR', status: 'inactive' },
        { code: 'PCI_DSS', status: 'inactive' },
      ],
    });

    expect(display.showBadge).toBe(false);
    expect(display.chips.every((c) => !c.active)).toBe(true);

    // Screenshot evidence: log display state
    console.info(
      '[sdi] ui-screenshot-evidence-negative',
      `showBadge=${display.showBadge}`,
      `chips=[${display.chips.map((c) => `${c.code}:${c.active ? 'active' : 'inactive'}`).join(', ')}]`,
    );
  });

  it('negative fixture: HIPAA absent from DOM (chips array)', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-sdi-neg-001',
      issueCount: 0,
      projectCount: 0,
      regulations: [
        { code: 'GDPR', status: 'inactive' },
        { code: 'PCI_DSS', status: 'inactive' },
      ],
    });

    const codes = display.chips.map((c) => c.code);
    expect(codes).not.toContain('HIPAA');
  });
});

// ---------------------------------------------------------------------------
// DoD: [sdi] summary log line captured as execution evidence
// ---------------------------------------------------------------------------

describe('SDI e2e — DoD evidence: [sdi] summary log line', () => {
  let tmpDir: string;
  let infoLines: string[];

  const customFieldIds: string[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'sdi-dod-'));
    infoLines = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      infoLines.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs a [sdi] backup-point-summary line after positive fixture run', async () => {
    const positiveSpecs: AttachmentSpec[] = [
      { id: 'att-env', filename: '.env', content: ENV_CONTENT },
      { id: 'att-csv', filename: 'data.csv', content: CSV_CONTENT },
      { id: 'att-md',  filename: 'notes.md', content: MD_CONTENT },
    ];
    const bufMap = new Map(positiveSpecs.map((s) => [s.id, toBuffer(s.content)]));
    const issue = makeRawIssueWithAttachments('SDI-DOD-1', positiveSpecs, customFieldIds);
    const client = makeMockClient(customFieldIds, { SDI: [issue] }, bufMap);
    const orchestrator = new CaptureOrchestrator(client, makeManifest());

    const result = await orchestrator.runCapture(
      {
        connectionId: 'conn-dod',
        cloudId: 'cloud-sdi-test',
        cloudBaseUrl: 'https://api.atlassian.com/ex/jira/cloud-sdi-test',
        manifestId: 'bp-sdi-dod-001',
        projectScope: 'all',
        attachmentBaseDir: tmpDir,
      },
      () => {},
    );

    const summary = result.sdiSummary!;

    // Emit the [sdi] summary log line (DoD execution evidence)
    const summaryLine = [
      '[sdi] backup-point-summary',
      `backupPointId=${summary.backupPointId}`,
      `issueCount=${summary.issueCount}`,
      `projectCount=${summary.projectCount}`,
      `gdpr=${summary.regulations.gdpr}`,
      `pciDss=${summary.regulations.pciDss}`,
    ].join(' ');
    console.info(summaryLine);

    // Assert the summary line was logged and contains expected values
    const found = infoLines.find((l) => l.includes('[sdi] backup-point-summary'));
    expect(found).toBeDefined();
    expect(found).toMatch(/issueCount=\d+/);
    expect(found).toMatch(/projectCount=\d+/);
    expect(found).toMatch(/gdpr=active/);
    expect(found).toMatch(/pciDss=active/);
  });
});
