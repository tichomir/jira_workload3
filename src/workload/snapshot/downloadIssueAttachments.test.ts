import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { downloadIssueAttachments } from './downloadIssueAttachments.js';
import type { IJiraHttpClient, AttachmentRecord } from '../backup/types.js';

const CLOUD_BASE = 'https://api.atlassian.com/ex/jira/cloud-test-123';
const BACKUP_POINT_ID = 'bp-test-001';
const ISSUE_KEY = 'TEST-42';

function makeRef(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: 'att-001',
    filename: 'screenshot.png',
    mimeType: 'image/png',
    size: 0,
    contentHash: '',
    created: '2024-01-01T00:00:00.000Z',
    author: { accountId: 'user-1' },
    ...overrides,
  };
}

function makeClient(
  downloadAttachment: IJiraHttpClient['downloadAttachment']
): IJiraHttpClient {
  return {
    getJson: vi.fn(),
    searchJql: vi.fn(),
    enumerateIssues: vi.fn(),
    downloadAttachment,
  } as unknown as IJiraHttpClient;
}

// ---------------------------------------------------------------------------
// Happy path — successful download, binary + sidecar written
// ---------------------------------------------------------------------------

describe('downloadIssueAttachments — successful download', () => {
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'att-ok-'));
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes binary byte-for-byte and creates sidecar JSON', async () => {
    const fileBytes = Buffer.from('hello attachment content — binary faithful');
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');

    const client = makeClient(vi.fn(async () => ({
      data: fileBytes,
      contentType: 'image/png',
      contentHash: sha256,
    })));

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    expect(result.errors).toHaveLength(0);
    expect(result.records[0].contentHash).toBe(sha256);

    const binaryPath = join(tmpDir, BACKUP_POINT_ID, ISSUE_KEY, 'att-001');
    const sidecarPath = join(tmpDir, BACKUP_POINT_ID, ISSUE_KEY, 'att-001.meta.json');

    expect(existsSync(binaryPath)).toBe(true);
    expect(existsSync(sidecarPath)).toBe(true);

    // Binary is byte-for-byte identical to the source
    expect(readFileSync(binaryPath)).toEqual(fileBytes);

    // Sidecar carries all required metadata
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'));
    expect(sidecar.sha256).toBe(sha256);
    expect(sidecar.filename).toBe('screenshot.png');
    expect(sidecar.attachmentId).toBe('att-001');
    expect(sidecar.issueKey).toBe(ISSUE_KEY);
    expect(sidecar.backupPointId).toBe(BACKUP_POINT_ID);
    expect(sidecar.mimeType).toBe('image/png');
    expect(typeof sidecar.capturedAt).toBe('string');
  });

  it('emits [attachment] op=download … outcome=ok structured log', async () => {
    const fileBytes = Buffer.from('log-test-content');
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');

    const client = makeClient(vi.fn(async () => ({
      data: fileBytes,
      contentType: 'text/plain',
      contentHash: sha256,
    })));

    await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    const attLogs = logs.filter(l => l.includes('[attachment]'));
    expect(attLogs).toHaveLength(1);
    expect(attLogs[0]).toContain('op=download');
    expect(attLogs[0]).toContain('id=att-001');
    expect(attLogs[0]).toContain(`bytes=${fileBytes.length}`);
    expect(attLogs[0]).toContain(`sha256=${sha256}`);
    expect(attLogs[0]).toContain('outcome=ok');
  });

  it('uses the canonical client — downloadAttachment called with correct URL base and id', async () => {
    const fileBytes = Buffer.from('x');
    const sha256 = createHash('sha256').update(fileBytes).digest('hex');
    const mockDl = vi.fn(async () => ({ data: fileBytes, contentType: 'text/plain', contentHash: sha256 }));
    const client = makeClient(mockDl);

    await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef({ id: 'att-xyz' })], tmpDir
    );

    expect(mockDl).toHaveBeenCalledOnce();
    const [baseArg, idArg] = mockDl.mock.calls[0];
    expect(baseArg).toBe(CLOUD_BASE);
    expect(idArg).toBe('att-xyz');
  });

  it('processes multiple attachments and returns a record for each', async () => {
    const bytes1 = Buffer.from('file-one');
    const bytes2 = Buffer.from('file-two');
    const hash1 = createHash('sha256').update(bytes1).digest('hex');
    const hash2 = createHash('sha256').update(bytes2).digest('hex');

    const mockDl = vi.fn(async (_base: string, id: string) => {
      if (id === 'att-001') return { data: bytes1, contentType: 'image/png', contentHash: hash1 };
      return { data: bytes2, contentType: 'application/pdf', contentHash: hash2 };
    });
    const client = makeClient(mockDl);

    const refs = [
      makeRef({ id: 'att-001', filename: 'img.png' }),
      makeRef({ id: 'att-002', filename: 'doc.pdf', mimeType: 'application/pdf' }),
    ];

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, refs, tmpDir
    );

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].contentHash).toBe(hash1);
    expect(result.records[1].contentHash).toBe(hash2);
    expect(mockDl).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Hash mismatch — post-write SHA-256 verification failure
// ---------------------------------------------------------------------------

describe('downloadIssueAttachments — hash_mismatch', () => {
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'att-mismatch-'));
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('surfaces hash_mismatch as a per-item error — not silently swallowed', async () => {
    const fileBytes = Buffer.from('actual bytes on disk');
    // Deliberately wrong hash — does not match the SHA-256 of fileBytes.
    const wrongHash = 'a'.repeat(64);

    const client = makeClient(vi.fn(async () => ({
      data: fileBytes,
      contentType: 'image/png',
      contentHash: wrongHash,
    })));

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].outcome).toBe('hash_mismatch');
    expect(result.errors[0].attachmentId).toBe('att-001');
    expect(result.errors[0].issueKey).toBe(ISSUE_KEY);
    expect(result.errors[0].message).toMatch(/SHA-256 mismatch/);
  });

  it('emits [attachment] … outcome=hash_mismatch log when hash does not verify', async () => {
    const fileBytes = Buffer.from('content');
    const wrongHash = 'b'.repeat(64);

    const client = makeClient(vi.fn(async () => ({
      data: fileBytes,
      contentType: 'image/png',
      contentHash: wrongHash,
    })));

    await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    const attLogs = logs.filter(l => l.includes('[attachment]'));
    expect(attLogs).toHaveLength(1);
    expect(attLogs[0]).toContain('outcome=hash_mismatch');
    expect(attLogs[0]).toContain('id=att-001');
  });

  it('does not write sidecar when hash_mismatch occurs', async () => {
    const fileBytes = Buffer.from('content');
    const wrongHash = 'c'.repeat(64);

    const client = makeClient(vi.fn(async () => ({
      data: fileBytes,
      contentType: 'image/png',
      contentHash: wrongHash,
    })));

    await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    const sidecarPath = join(tmpDir, BACKUP_POINT_ID, ISSUE_KEY, 'att-001.meta.json');
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it('continues processing subsequent attachments after a hash_mismatch', async () => {
    const goodBytes = Buffer.from('good-content');
    const goodHash = createHash('sha256').update(goodBytes).digest('hex');
    const badBytes = Buffer.from('bad-content');
    const wrongHash = 'd'.repeat(64);

    const mockDl = vi.fn(async (_base: string, id: string) => {
      if (id === 'att-bad') return { data: badBytes, contentType: 'image/png', contentHash: wrongHash };
      return { data: goodBytes, contentType: 'text/plain', contentHash: goodHash };
    });
    const client = makeClient(mockDl);

    const refs = [
      makeRef({ id: 'att-bad', filename: 'bad.png' }),
      makeRef({ id: 'att-good', filename: 'good.txt' }),
    ];

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, refs, tmpDir
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].attachmentId).toBe('att-bad');
    expect(result.records[1].contentHash).toBe(goodHash);
    expect(existsSync(join(tmpDir, BACKUP_POINT_ID, ISSUE_KEY, 'att-good'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP error — download throws
// ---------------------------------------------------------------------------

describe('downloadIssueAttachments — http_error', () => {
  let tmpDir: string;
  let logs: string[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'att-err-'));
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('surfaces http_error as a per-item error when downloadAttachment throws', async () => {
    const client = makeClient(vi.fn(async () => {
      throw new Error('downloadAttachment att-001 HTTP 403');
    }));

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].outcome).toBe('http_error');
    expect(result.errors[0].attachmentId).toBe('att-001');
    expect(result.errors[0].message).toContain('HTTP 403');
  });

  it('emits [attachment] … outcome=http_error log when download throws', async () => {
    const client = makeClient(vi.fn(async () => {
      throw new Error('HTTP 404');
    }));

    await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [makeRef()], tmpDir
    );

    const attLogs = logs.filter(l => l.includes('[attachment]'));
    expect(attLogs).toHaveLength(1);
    expect(attLogs[0]).toContain('outcome=http_error');
    expect(attLogs[0]).toContain('id=att-001');
  });

  it('continues processing subsequent attachments after one http_error', async () => {
    const goodBytes = Buffer.from('good');
    const goodHash = createHash('sha256').update(goodBytes).digest('hex');

    const mockDl = vi.fn(async (_base: string, id: string) => {
      if (id === 'att-bad') throw new Error('HTTP 404');
      return { data: goodBytes, contentType: 'text/plain', contentHash: goodHash };
    });
    const client = makeClient(mockDl);

    const refs = [
      makeRef({ id: 'att-bad', filename: 'missing.png' }),
      makeRef({ id: 'att-good', filename: 'present.txt' }),
    ];

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, refs, tmpDir
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].attachmentId).toBe('att-bad');
    expect(result.records[1].contentHash).toBe(goodHash);
    expect(mockDl).toHaveBeenCalledTimes(2);
  });

  it('returns empty results with no errors for an empty attachments list', async () => {
    const client = makeClient(vi.fn());

    const result = await downloadIssueAttachments(
      client, CLOUD_BASE, BACKUP_POINT_ID, ISSUE_KEY, [], tmpDir
    );

    expect(result.errors).toHaveLength(0);
    expect(result.records).toHaveLength(0);
  });
});
