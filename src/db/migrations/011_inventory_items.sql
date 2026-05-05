CREATE TABLE IF NOT EXISTS backup_point_items (
  rowId         INTEGER PRIMARY KEY AUTOINCREMENT,
  connectionId  TEXT    NOT NULL,
  backupPointId TEXT    NOT NULL,
  objectType    TEXT    NOT NULL CHECK (objectType IN ('Issue', 'Project', 'Board', 'Sprint')),
  itemId        TEXT    NOT NULL,
  displayName   TEXT    NOT NULL,
  summary       TEXT,
  changeBadge   TEXT    NOT NULL DEFAULT 'unchanged' CHECK (changeBadge IN ('added', 'modified', 'deleted', 'unchanged')),
  capturedAt    TEXT    NOT NULL,
  FOREIGN KEY (connectionId) REFERENCES connections(connectionId) ON DELETE CASCADE,
  FOREIGN KEY (backupPointId) REFERENCES backup_manifests(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bpi_unique
  ON backup_point_items(backupPointId, objectType, itemId);

CREATE INDEX IF NOT EXISTS idx_bpi_lookup
  ON backup_point_items(connectionId, backupPointId, objectType);
