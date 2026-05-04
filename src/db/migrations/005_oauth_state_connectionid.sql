-- Allow oauth_state rows to reference an existing connection for reauth flows.
ALTER TABLE oauth_state ADD COLUMN connectionId TEXT REFERENCES connections(connectionId);
