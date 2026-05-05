# Attachment Storage

This directory is the default root for Jira attachment binaries downloaded
during a backup job. The layout mirrors the Jira object hierarchy so that
every attachment can be located from its backup-point ID, issue key, and
Atlassian attachment ID.

## Directory layout

```
data/attachments/
  {backupPointId}/
    {issueKey}/
      {attachmentId}            ← raw binary (opaque bytes, any MIME type)
      {attachmentId}.meta.json  ← sidecar metadata
```

### Example

```
data/attachments/
  bp-2026-05-05-001/
    PROJ-42/
      att-10023              ← binary: image/png, 84 713 bytes
      att-10023.meta.json    ← sidecar (see schema below)
      att-10024              ← binary: application/pdf
      att-10024.meta.json
    PROJ-43/
      att-10031
      att-10031.meta.json
```

## Sidecar `.meta.json` schema

Each binary file has a paired `{attachmentId}.meta.json` file written
**atomically** alongside the binary. The schema is:

```json
{
  "attachmentId":  "att-10023",
  "issueKey":      "PROJ-42",
  "backupPointId": "bp-2026-05-05-001",
  "filename":      "screenshot.png",
  "mimeType":      "image/png",
  "sizeBytes":     84713,
  "sha256":        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "downloadedAt":  "2026-05-05T04:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `attachmentId` | `string` | Atlassian attachment ID (matches the directory entry name) |
| `issueKey` | `string` | Jira issue key (e.g. `PROJ-42`) |
| `backupPointId` | `string` | Backup point that captured this attachment |
| `filename` | `string` | Original filename as reported by Atlassian |
| `mimeType` | `string` | MIME type as reported by Atlassian |
| `sizeBytes` | `number` | Size in bytes of the stored binary |
| `sha256` | `string` | Hex-encoded SHA-256 digest of the binary; verified on download |
| `downloadedAt` | `string` | ISO-8601 UTC timestamp when the binary was written to disk |

## Overriding the storage root

The default storage root is `data/attachments` (relative to the project
root). Set `DCC_ATTACHMENT_DIR` in `.env` to redirect storage to an
external volume:

```
DCC_ATTACHMENT_DIR=/mnt/backup-volume/attachments
```

## Notes

- The binary and its `.meta.json` sidecar are always written together.
  A binary with no matching sidecar (or vice versa) indicates an
  interrupted write and should be treated as corrupt.
- Body-content search across attachment text is not available in Phase 1.
  The SDI teaser scanner reads dev-config and text/log attachment types
  during the backup job to surface GDPR / PCI DSS signals.
- ADF media-link rewriting post-restore is Phase 2 (see ARCHITECTURE.md).
