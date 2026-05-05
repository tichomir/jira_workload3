CREATE TABLE IF NOT EXISTS restore_jobs (
  jobId                TEXT    PRIMARY KEY,
  connectionId         TEXT    NOT NULL REFERENCES connections(connectionId),
  backupPointId        TEXT    NOT NULL,
  conflictMode         TEXT    NOT NULL DEFAULT 'skip'
                               CHECK (conflictMode IN ('override', 'skip', 'ask')),
  destination          TEXT    NOT NULL
                               CHECK (destination IN ('original', 'alternate', 'export')),
  selection            TEXT    NOT NULL DEFAULT '[]',
  alternateDestination TEXT,
  status               TEXT    NOT NULL DEFAULT 'queued',
  restoredCount        INTEGER NOT NULL DEFAULT 0,
  errorCount           INTEGER NOT NULL DEFAULT 0,
  phaseDiagnostic      TEXT,
  createdAt            TEXT    NOT NULL,
  completedAt          TEXT
);
