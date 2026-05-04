import { createHash } from 'crypto';
import { getDb } from '../../db/database.js';
import type {
  IJiraHttpClient,
  JqlSearchRequest,
  JqlSearchResponse,
  AttachmentDownload,
} from '../backup/types.js';

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// One instance per connectionId — all backup-engine callers for the same site share state.
const instances = new Map<string, JiraHttpClient>();

export class JiraHttpClient implements IJiraHttpClient {
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

  static _createForTesting(connectionId: string, fetchFn: FetchFn): JiraHttpClient {
    const instance = new JiraHttpClient(connectionId, fetchFn);
    instances.set(connectionId, instance);
    return instance;
  }

  static _clearInstances(): void {
    instances.clear();
  }

  // -------------------------------------------------------------------------
  // IJiraHttpClient
  // -------------------------------------------------------------------------

  async getJson<T>(cloudBaseUrl: string, path: string, params?: Record<string, string>): Promise<T> {
    let url = `${cloudBaseUrl}${path}`;
    if (params && Object.keys(params).length > 0) {
      url += '?' + new URLSearchParams(params).toString();
    }
    const response = await this._request(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`getJson ${path} HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  async searchJql(cloudBaseUrl: string, body: JqlSearchRequest): Promise<JqlSearchResponse> {
    const url = `${cloudBaseUrl}/rest/api/3/search/jql`;
    const response = await this._request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`searchJql HTTP ${response.status}`);
    }
    return response.json() as Promise<JqlSearchResponse>;
  }

  async downloadAttachment(cloudBaseUrl: string, attachmentId: string): Promise<AttachmentDownload> {
    const url = `${cloudBaseUrl}/rest/api/3/attachment/content/${attachmentId}`;
    const response = await this._request(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`downloadAttachment ${attachmentId} HTTP ${response.status}`);
    }
    const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    const contentHash = createHash('sha256').update(data).digest('hex');
    return { data, contentType, contentHash };
  }

  // -------------------------------------------------------------------------
  // Convenience methods
  // -------------------------------------------------------------------------

  async get<T>(cloudBaseUrl: string, path: string, params?: Record<string, string>): Promise<T> {
    return this.getJson<T>(cloudBaseUrl, path, params);
  }

  async post<T>(cloudBaseUrl: string, path: string, body: unknown): Promise<T> {
    const url = `${cloudBaseUrl}${path}`;
    const response = await this._request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`post ${path} HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  /** Download a binary resource. Returns raw bytes and the full response Headers. */
  async getBinary(
    cloudBaseUrl: string,
    path: string
  ): Promise<{ data: Buffer; headers: Headers }> {
    const url = `${cloudBaseUrl}${path}`;
    const response = await this._request(url, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`getBinary ${path} HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), headers: response.headers };
  }

  /**
   * Paginate a JSON GET endpoint using Jira's startAt / maxResults / isLast pattern.
   *
   * pageHandler receives the full parsed page and returns true to continue or
   * false to stop early.  Pagination also stops when the page indicates it is
   * the last one (isLast === true) or the returned values array is shorter than
   * pageSize.
   */
  async getPaginated<T extends { isLast?: boolean; values?: unknown[] }>(
    cloudBaseUrl: string,
    path: string,
    params: Record<string, string>,
    pageHandler: (page: T, startAt: number) => Promise<boolean>,
    pageSize = 50
  ): Promise<void> {
    let startAt = 0;
    while (true) {
      const pageParams: Record<string, string> = {
        ...params,
        startAt: String(startAt),
        maxResults: String(pageSize),
      };
      const page = await this.getJson<T>(cloudBaseUrl, path, pageParams);
      const shouldContinue = await pageHandler(page, startAt);
      if (!shouldContinue) break;
      if (page.isLast === true) break;
      if (Array.isArray(page.values) && page.values.length < pageSize) break;
      startAt += pageSize;
    }
  }

  // -------------------------------------------------------------------------
  // Internal request engine
  // -------------------------------------------------------------------------

  private async _request(url: string, init: RequestInit = {}): Promise<Response> {
    const creds = this._readCredentials();
    const response = await this._fetch(url, this._buildInit(init, creds.accessToken));

    if (response.status === 401) {
      await this._refresh();
      const refreshed = this._readCredentials();
      return this._fetch(url, this._buildInit(init, refreshed.accessToken));
    }

    return response;
  }

  private async _refresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      return this.refreshPromise;
    }

    console.log(`[auth-refresh] connectionId=${this.connectionId} mutex=acquire`);
    this.refreshPromise = this._performRefresh()
      .then(() => {
        console.log(`[auth-refresh] connectionId=${this.connectionId} outcome=success`);
      })
      .catch((err: Error) => {
        console.log(`[auth-refresh] connectionId=${this.connectionId} outcome=failure`);
        throw err;
      })
      .finally(() => {
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
      throw new Error(`credentials row not found for connectionId=${this.connectionId}`);
    }
    if (!row.clientId || !row.clientSecret) {
      throw new Error(`clientId/clientSecret not set for connectionId=${this.connectionId}`);
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
      throw new Error(`token endpoint returned HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as TokenRefreshResponse;
    const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    const now = new Date().toISOString();

    // Atomic write: both tokens committed before the mutex releases.
    db.transaction(() => {
      db.prepare(
        `UPDATE credentials
            SET accessToken = ?, refreshToken = ?, expiresAt = ?, updatedAt = ?
          WHERE connectionId = ?`
      ).run(data.access_token, data.refresh_token, expiresAt, now, this.connectionId);
    })();
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

  private _buildInit(init: RequestInit, token: string): RequestInit {
    const existingHeaders = (init.headers ?? {}) as Record<string, string>;
    return {
      ...init,
      headers: {
        Accept: 'application/json',
        ...existingHeaders,
        Authorization: `Bearer ${token}`,
      },
    };
  }
}
