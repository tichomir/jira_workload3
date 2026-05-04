-- OAuth app client credentials needed for rotating refresh token POST to Atlassian token endpoint.
-- Nullable to preserve compatibility with rows inserted before this migration.
ALTER TABLE credentials ADD COLUMN clientId     TEXT;
ALTER TABLE credentials ADD COLUMN clientSecret TEXT;
