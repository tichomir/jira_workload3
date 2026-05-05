import { createHash } from 'crypto';
import { getDb } from '../../db/database.js';
import type {
  IJiraHttpClient,
  JqlSearchRequest,
  JqlSearchResponse,
  AttachmentDownload,
  RawIssue,
} from '../backup/types.js';

const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';

const RATE_LIMIT_MAX_RETRIES = 4;
const RATE_LIMIT_BASE_MS = 1000;
const RATE_LIMIT_MAX_MS = 8000;

interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export class RateLimitedError extends Error {
  readonly endpoint: string;
  readonly attempts: number;
  constructor(endpoint: string, attempts: number) {
    super(`[rate-limit] endpoint=${endpoint} exhausted after ${attempts} attempts`);
    this.name = 'RateLimitedError';
    this.endpoint = endpoint;
    this.attempts = attempts;
  }
}

// One instance per connectionId — all backup-engine callers for the same site share state.
const instances = new Map<string, JiraHttpClient>();

export class JiraHttpClient implements IJiraHttpClient {
  private readonly connectionId: string;
  private refreshPromise: Promise<void> | null = null;
  private readonly _fetch: FetchFn;
  private readonly _sleep: SleepFn;

  private constructor(connectionId: string, fetchFn: FetchFn, sleepFn: SleepFn) {
    this.connectionId = connectionId;
    this._fetch = fetchFn;
    this._sleep = sleepFn;
  }

  static forConnection(connectionId: string): JiraHttpClient {
    if (!instances.has(connectionId)) {
      instances.set(
        connectionId,
        new JiraHttpClient(
          connectionId,
          globalThis.fetch.bind(globalThis),
          (ms) => new Promise(resolve => setTimeout(resolve, ms))
        )
      );
    }
    return instances.get(connectionId)!;
  }

  static _createForTesting(
    connectionId: string,
    fetchFn: FetchFn,
    sleepFn: SleepFn = () => Promise.resolve()
  ): JiraHttpClient {
    const instance = new JiraHttpClient(connectionId, fetchFn, sleepFn);
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

  async enumerateIssues(
    cloudBaseUrl: string,
    projectKey: string,
    jql: string,
    fields: string[],
    opts: { maxResults?: number } = {}
  ): Promise<RawIssue[]> {
    const maxResults = opts.maxResults ?? 100;
    const allIssues: RawIssue[] = [];
    let page = 0;
    let nextPageToken: string | undefined;

    while (true) {
      page++;
      const body: JqlSearchRequest = {
        jql,
        maxResults,
        fields,
        ...(nextPageToken !== undefined ? { nextPageToken } : {}),
      };

      const response = await this.searchJql(cloudBaseUrl, body);
      const { issues } = response;

      console.log(
        `[search] endpoint=search/jql project=${projectKey} page=${page} pageSize=${maxResults} returnedCount=${issues.length}`
      );

      allIssues.push(...issues);

      if (issues.length === 0 || issues.length < maxResults) {
        break;
      }

      nextPageToken = response.nextPageToken;
    }

    return allIssues;
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
    let response = await this._fetch(url, this._buildInit(init, creds.accessToken));

    if (response.status === 401) {
      await this._refresh();
      const refreshed = this._readCredentials();
      response = await this._fetch(url, this._buildInit(init, refreshed.accessToken));
    }

    if (response.status === 429) {
      const endpoint = this._extractEndpoint(url);
      response = await this._retryWithBackoff(url, init, response, endpoint);
    }

    return response;
  }

  private async _retryWithBackoff(
    url: string,
    init: RequestInit,
    firstResponse: Response,
    endpoint: string
  ): Promise<Response> {
    let response = firstResponse;
    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      const delayMs = this._computeRetryDelay(response, attempt);
      console.log(`[rate-limit] attempt=${attempt} delayMs=${delayMs} endpoint=${endpoint}`);
      await this._sleep(delayMs);
      const creds = this._readCredentials();
      response = await this._fetch(url, this._buildInit(init, creds.accessToken));
      if (response.status !== 429) {
        return response;
      }
    }
    throw new RateLimitedError(endpoint, RATE_LIMIT_MAX_RETRIES);
  }

  private _computeRetryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter !== null) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return seconds * 1000;
      }
      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        return Math.max(0, date.getTime() - Date.now());
      }
    }
    const base = RATE_LIMIT_BASE_MS * Math.pow(2, attempt - 1);
    const capped = Math.min(base, RATE_LIMIT_MAX_MS);
    const jitter = capped * 0.2 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }

  private _extractEndpoint(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private async _refresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      console.log(`[auth-refresh] connectionId=${this.connectionId} mutex=queued`);
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
