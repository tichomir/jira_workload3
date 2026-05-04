CREATE TABLE IF NOT EXISTS backup_manifests (
  id           TEXT    PRIMARY KEY,
  connectionId TEXT    NOT NULL REFERENCES connections(connectionId) ON DELETE CASCADE,
  cloudId      TEXT    NOT NULL,
  createdAt    TEXT    NOT NULL,
  manifestJson TEXT    NOT NULL
);
