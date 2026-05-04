/**
 * Attachment storage contracts — Sprint 3, Phase 2.
 *
 * Disk layout for binary-faithful attachment storage:
 *
 *   data/attachments/{backupPointId}/{issueKey}/{attachmentId}           ← raw binary
 *   data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json ← sidecar
 *
 * The binary is stored byte-for-byte as received from
 * GET /rest/api/3/attachment/content/{id} — no transcoding or recompression.
 * The sidecar JSON carries all metadata needed for restore without reading
 * the binary itself. SHA-256 of the binary is stored in the sidecar and
 * re-verified on restore.
 *
 * Source: T3 §3.2, §4.4.
 */

/**
 * Disk path pair for a single stored attachment.
 *
 * Path scheme:
 *   data/attachments/{backupPointId}/{issueKey}/{attachmentId}
 *   data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json
 */
export interface AttachmentStoragePaths {
  /** Repo-relative path to the raw binary file. */
  binaryPath: string;
  /** Repo-relative path to the JSON sidecar file. */
  sidecarPath: string;
}

/**
 * Sidecar metadata written alongside every stored attachment binary as
 * `{attachmentId}.meta.json`.
 *
 * This is the authoritative source for integrity verification and restore
 * metadata — the binary is opaque and carries no inline metadata.
 *
 * Source: T3 §3.2, §4.4.
 */
export interface AttachmentSidecar {
  /** Jira attachment ID (numeric string). */
  attachmentId: string;
  /** Issue key the attachment belongs to, e.g. "PROJ-42". */
  issueKey: string;
  /** Backup-point ID under which this binary was stored. */
  backupPointId: string;
  /** Original filename as returned by the Jira API — never rewritten. */
  filename: string;
  /** MIME type from the Content-Type response header — no transcoding applied. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** SHA-256 hex digest of the stored binary for integrity verification. */
  sha256: string;
  /** ISO-8601 timestamp when the binary was downloaded and stored. */
  capturedAt: string;
}

/**
 * Full attachment descriptor — storage paths + sidecar metadata in one shape.
 * Produced by the attachment download step; consumed by the restore engine.
 */
export interface Attachment {
  paths: AttachmentStoragePaths;
  meta: AttachmentSidecar;
}

/**
 * Derives canonical storage paths from the three identifying fields.
 *
 * Binary:  data/attachments/{backupPointId}/{issueKey}/{attachmentId}
 * Sidecar: data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json
 */
export function resolveAttachmentPaths(
  backupPointId: string,
  issueKey: string,
  attachmentId: string,
  baseDir = 'data/attachments'
): AttachmentStoragePaths {
  const dir = `${baseDir}/${backupPointId}/${issueKey}`;
  return {
    binaryPath: `${dir}/${attachmentId}`,
    sidecarPath: `${dir}/${attachmentId}.meta.json`,
  };
}
