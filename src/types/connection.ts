/**
 * A credential pair issued by Atlassian's OAuth 2.0 (3LO) token endpoint.
 * Both tokens must be written atomically to the credential store on every refresh.
 */
export interface CredentialRecord {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds at which accessToken expires. */
  expiresAt: number;
}

/**
 * A fully-resolved Jira Cloud connection stored in the credential store.
 * connectionId is the DCC-internal primary key; cloudId is the Atlassian site identifier.
 */
export interface Connection {
  connectionId: string;
  /** Atlassian cloud site identifier (UUID). Unique per connected site. */
  cloudId: string;
  /** Human-readable site name returned by /oauth/token's resources endpoint. */
  siteName: string;
  credentials: CredentialRecord;
  /** OAuth scopes granted at authorization time (space-separated values split into array). */
  scopes: string[];
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/**
 * Input supplied by the operator when adding a connection via the Manual Connection path.
 */
export interface ManualConnectionInput {
  clientId: string;
  clientSecret: string;
}

/**
 * Payload returned by POST /api/connections on success.
 */
export interface ConnectionCreatedResult {
  connectionId: string;
  cloudId: string;
  siteName: string;
  scopes: string[];
  createdAt: string;
}
