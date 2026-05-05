CREATE TABLE IF NOT EXISTS backup_point_sdi_summary (
  backupPointId TEXT PRIMARY KEY,
  issueCount    INTEGER NOT NULL DEFAULT 0,
  projectCount  INTEGER NOT NULL DEFAULT 0,
  regulations   TEXT    NOT NULL DEFAULT '{}',
  createdAt     TEXT    NOT NULL
);
