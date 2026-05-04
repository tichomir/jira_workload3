CREATE TABLE IF NOT EXISTS policies (
  policyId             TEXT    PRIMARY KEY,
  connectionId         TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
  projectScope         TEXT    NOT NULL CHECK (projectScope IN ('all', 'selected')),
  selectedProjectKeys  TEXT    NOT NULL DEFAULT '[]',
  retentionDays        INTEGER NOT NULL,
  updatedAt            TEXT    NOT NULL
);
