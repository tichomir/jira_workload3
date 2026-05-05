/**
 * Binary-faithful attachment downloader for the Jira Cloud snapshot phase.
 *
 * For every AttachmentRecord ref in an Issue payload:
 *   1. Downloads the binary via IJiraHttpClient.downloadAttachment() (canonical client,
 *      no raw fetch/axios).
 *   2. Persists the binary byte-for-byte under data/attachments/{backupPointId}/{issueKey}/{attachmentId}.
 *   3. Re-reads the written file and re-verifies SHA-256 against the hash computed
 *      during download — a mismatch is surfaced as a per-item error, not silently swallowed.
 *   4. Writes the sidecar JSON ({attachmentId}.meta.json) only when the hash check passes.
 *   5. Emits one structured log line per attachment:
 *        [attachment] op=download id=<id> bytes=<n> sha256=<hex> outcome=<ok|hash_mismatch|http_error>
 *
 * Source: T3 §3.2, §4.4.
 */

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { IJiraHttpClient, AttachmentRecord } from '../backup/types.js';
import { resolveAttachmentPaths } from '../types/Attachment.js';
import type { AttachmentSidecar } from '../types/Attachment.js';
import { scanFile } from '../sdi/scanDispatcher.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AttachmentItemError {
  attachmentId: string;
  issueKey: string;
  outcome: 'http_error' | 'hash_mismatch' | 'io_error';
  message: string;
}

export interface AttachmentSdiResult {
  attachmentId: string;
  filename: string;
  email: number;
  apiKey: number;
  cc: number;
  phone: number;
}

export interface DownloadAttachmentsResult {
  /** One record per input ref; contentHash is filled in for successful downloads. */
  records: AttachmentRecord[];
  /** Per-attachment errors — never halts processing of remaining attachments. */
  errors: AttachmentItemError[];
  /** SDI scan results for successfully downloaded attachments (matching file classes only). */
  sdiResults: AttachmentSdiResult[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download and persist all attachment binaries for a single Issue.
 *
 * Disk layout (resolved by resolveAttachmentPaths):
 *   {baseDir}/{backupPointId}/{issueKey}/{attachmentId}           ← raw binary
 *   {baseDir}/{backupPointId}/{issueKey}/{attachmentId}.meta.json ← sidecar
 *
 * @param client        Canonical IJiraHttpClient — no raw fetch/axios allowed.
 * @param cloudBaseUrl  Base URL for the Atlassian site.
 * @param backupPointId Backup-point UUID (used as the top-level directory).
 * @param issueKey      Jira issue key, e.g. "PROJ-42".
 * @param attachments   Attachment refs from assembleIssuePayload().
 * @param baseDir       Override for testing; defaults to 'data/attachments'.
 */
export async function downloadIssueAttachments(
  client: IJiraHttpClient,
  cloudBaseUrl: string,
  backupPointId: string,
  issueKey: string,
  attachments: AttachmentRecord[],
  baseDir = 'data/attachments'
): Promise<DownloadAttachmentsResult> {
  const records: AttachmentRecord[] = [];
  const errors: AttachmentItemError[] = [];
  const sdiResults: AttachmentSdiResult[] = [];

  for (const ref of attachments) {
    // -- Step 1: Download binary via canonical client (no raw fetch/axios) ------
    let data: Buffer;
    let contentType: string;
    let contentHash: string;

    try {
      const dl = await client.downloadAttachment(cloudBaseUrl, ref.id);
      data = dl.data;
      contentType = dl.contentType;
      contentHash = dl.contentHash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[attachment] op=download id=${ref.id} bytes=0 sha256= outcome=http_error`);
      errors.push({ attachmentId: ref.id, issueKey, outcome: 'http_error', message });
      records.push(ref);
      continue;
    }

    // -- Step 2: Persist to disk and post-write verify -------------------------
    const paths = resolveAttachmentPaths(backupPointId, issueKey, ref.id, baseDir);
    try {
      mkdirSync(dirname(paths.binaryPath), { recursive: true });
      writeFileSync(paths.binaryPath, data);

      // Post-write SHA-256 verification: re-read and recompute.
      const written = readFileSync(paths.binaryPath);
      const verifiedHash = createHash('sha256').update(written).digest('hex');

      if (verifiedHash !== contentHash) {
        console.log(
          `[attachment] op=download id=${ref.id} bytes=${data.length} sha256=${contentHash} outcome=hash_mismatch`
        );
        errors.push({
          attachmentId: ref.id,
          issueKey,
          outcome: 'hash_mismatch',
          message: `SHA-256 mismatch: expected ${contentHash}, got ${verifiedHash}`,
        });
        records.push(ref);
        continue;
      }

      // -- Step 3: Write sidecar (only after hash check passes) ----------------
      const sidecar: AttachmentSidecar = {
        attachmentId: ref.id,
        issueKey,
        backupPointId,
        filename: ref.filename,
        mimeType: contentType,
        size: data.length,
        sha256: contentHash,
        capturedAt: new Date().toISOString(),
      };
      writeFileSync(paths.sidecarPath, JSON.stringify(sidecar, null, 2));

      // -- Step 4: SDI scan the in-memory buffer by filename -------------------
      try {
        const sdiResult = scanFile(ref.filename, data);
        sdiResults.push({
          attachmentId: ref.id,
          filename: ref.filename,
          email: sdiResult.email,
          apiKey: sdiResult.apiKey,
          cc: sdiResult.cc,
          phone: sdiResult.phone,
        });
      } catch (sdiErr) {
        console.error(`[sdi] scan-error attachmentId=${ref.id}: ${sdiErr instanceof Error ? sdiErr.message : String(sdiErr)}`);
      }

      console.log(
        `[attachment] op=download id=${ref.id} bytes=${data.length} sha256=${contentHash} outcome=ok`
      );
      records.push({ ...ref, contentHash, mimeType: contentType });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `[attachment] op=download id=${ref.id} bytes=${data.length} sha256=${contentHash} outcome=http_error`
      );
      errors.push({ attachmentId: ref.id, issueKey, outcome: 'io_error', message });
      records.push(ref);
    }
  }

  return { records, errors, sdiResults };
}
