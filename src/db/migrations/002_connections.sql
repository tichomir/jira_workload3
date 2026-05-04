CREATE TABLE IF NOT EXISTS connections (
  connectionId TEXT    PRIMARY KEY,
  cloudId      TEXT    NOT NULL UNIQUE,
  siteName     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'active',
  createdAt    TEXT    NOT NULL,
  updatedAt    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  connectionId TEXT    PRIMARY KEY REFERENCES connections(connectionId) ON DELETE CASCADE,
  accessToken  TEXT    NOT NULL,
  refreshToken TEXT    NOT NULL,
  expiresAt    INTEGER NOT NULL,
  scopes       TEXT    NOT NULL,
  updatedAt    TEXT    NOT NULL
);
