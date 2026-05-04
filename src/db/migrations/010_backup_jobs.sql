CREATE TABLE IF NOT EXISTS backup_jobs (
  jobId        TEXT    PRIMARY KEY,
  manifestId   TEXT    NOT NULL,
  connectionId TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  createdAt    TEXT    NOT NULL,
  updatedAt    TEXT    NOT NULL,
  lastEventTs  TEXT,
  errorsCount  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS backup_job_events (
  id          TEXT    PRIMARY KEY,
  jobId       TEXT    NOT NULL REFERENCES backup_jobs(jobId) ON DELETE CASCADE,
  ts          TEXT    NOT NULL,
  phase       TEXT    NOT NULL,
  processed   INTEGER NOT NULL,
  total       INTEGER,
  errorsCount INTEGER NOT NULL DEFAULT 0,
  eventJson   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_job_events_jobId_ts
  ON backup_job_events(jobId, ts);
