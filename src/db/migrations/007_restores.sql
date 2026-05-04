CREATE TABLE IF NOT EXISTS restores (
  restoreId       TEXT    PRIMARY KEY,
  connectionId    TEXT,
  backupPointId   TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending',
  conflictMode    TEXT    NOT NULL DEFAULT 'skip',
  destination     TEXT    NOT NULL,
  itemIds         TEXT    NOT NULL,
  restoredCount   INTEGER NOT NULL DEFAULT 0,
  errorCount      INTEGER NOT NULL DEFAULT 0,
  phaseDiagnostic TEXT,
  createdAt       TEXT    NOT NULL,
  completedAt     TEXT
);
