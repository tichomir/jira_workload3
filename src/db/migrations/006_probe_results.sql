CREATE TABLE IF NOT EXISTS probe_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  connectionId      TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
  endpoint          TEXT    NOT NULL,
  status            INTEGER NOT NULL,
  duration_ms       INTEGER NOT NULL,
  remediationNeeded INTEGER NOT NULL DEFAULT 0,
  checkedAt         TEXT    NOT NULL
);
