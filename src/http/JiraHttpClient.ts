import { getDb } from '../db/database.js';

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

export interface JiraRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// One instance per connectionId; all callers for the same site share the same mutex state.
const instances = new Map<string, JiraHttpClient>();

export class JiraHttpClient {
  private readonly connectionId: string;
  private refreshPromise: Promise<void> | null = null;
  private readonly _fetch: FetchFn;

  private constructor(connectionId: string, fetchFn: FetchFn) {
    this.connectionId = connectionId;
    this._fetch = fetchFn;
  }

  static forConnection(connectionId: string): JiraHttpClient {
    if (!instances.has(connectionId)) {
      instances.set(
        connectionId,
        new JiraHttpClient(connectionId, globalThis.fetch.bind(globalThis))
      );
    }
    return instances.get(connectionId)!;
  }

  /** For testing: register a fresh instance with an injected fetch function. */
  static _createForTesting(connectionId: string, fetchFn: FetchFn): JiraHttpClient {
    const instance = new JiraHttpClient(connectionId, fetchFn);
    instances.set(connectionId, instance);
    return instance;
  }

  /** For testing: remove all cached instances so the next forConnection() starts clean. */
  static _clearInstances(): void {
    instances.clear();
  }

  /**
   * Make an authenticated request.  On a 401 response the client refreshes the
   * token exactly once (single-flight) and retries the original request.
   */
  async request(url: string, init: JiraRequestInit = {}): Promise<Response> {
    const creds = this._readCredentials();
    const response = await this._fetch(url, this._buildInit(init, creds.accessToken));

    if (response.status === 401) {
      await this.refresh();
      const refreshed = this._readCredentials();
      return this._fetch(url, this._buildInit(init, refreshed.accessToken));
    }

    return response;
  }

  /**
   * Rotate the access/refresh token pair.  Concurrent callers queue behind a
   * single in-flight refresh so the token endpoint is hit exactly once.
   */
  async refresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      // Another caller is already refreshing — piggyback on their result.
      return this.refreshPromise;
    }

    console.log(`[auth-refresh] connectionId=${this.connectionId} mutex=acquire`);
    this.refreshPromise = this._performRefresh().finally(() => {
      console.log(`[auth-refresh] connectionId=${this.connectionId} mutex=release`);
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async _performRefresh(): Promise<void> {
    const db = getDb();
    const row = db
      .prepare(
        'SELECT refreshToken, clientId, clientSecret FROM credentials WHERE connectionId = ?'
      )
      .get(this.connectionId) as
      | { refreshToken: string; clientId: string | null; clientSecret: string | null }
      | undefined;

    if (!row) {
      throw new Error(
        `[auth-refresh] connectionId=${this.connectionId} credentials row not found`
      );
    }
    if (!row.clientId || !row.clientSecret) {
      throw new Error(
        `[auth-refresh] connectionId=${this.connectionId} clientId/clientSecret not set`
      );
    }

    const resp = await this._fetch(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: row.clientId,
        client_secret: row.clientSecret,
        refresh_token: row.refreshToken,
      }).toString(),
    });

    if (!resp.ok) {
      throw new Error(
        `[auth-refresh] connectionId=${this.connectionId} token endpoint HTTP ${resp.status}`
      );
    }

    const data = (await resp.json()) as TokenRefreshResponse;
    const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    const now = new Date().toISOString();

    // Atomic write: both tokens committed in a single transaction before the mutex releases.
    db.transaction(() => {
      db.prepare(
        `UPDATE credentials
            SET accessToken = ?, refreshToken = ?, expiresAt = ?, updatedAt = ?
          WHERE connectionId = ?`
      ).run(data.access_token, data.refresh_token, expiresAt, now, this.connectionId);
    })();

    console.log(`[auth-refresh] connectionId=${this.connectionId} token-rotated`);
  }

  private _readCredentials(): { accessToken: string; refreshToken: string } {
    const db = getDb();
    const row = db
      .prepare('SELECT accessToken, refreshToken FROM credentials WHERE connectionId = ?')
      .get(this.connectionId) as { accessToken: string; refreshToken: string } | undefined;

    if (!row) {
      throw new Error(`No credentials found for connectionId=${this.connectionId}`);
    }
    return row;
  }

  private _buildInit(init: JiraRequestInit, token: string): RequestInit {
    return {
      method: init.method,
      body: init.body,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    };
  }
}
