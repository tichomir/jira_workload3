CREATE TABLE IF NOT EXISTS oauth_state (
  state        TEXT PRIMARY KEY,
  codeVerifier TEXT NOT NULL,
  clientId     TEXT NOT NULL,
  createdAt    TEXT NOT NULL,
  expiresAt    TEXT NOT NULL
);
