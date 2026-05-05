import { JiraHttpClient } from '../http/JiraHttpClient.js';
import { getDb } from '../db/database.js';

export interface ProbeResult {
  endpoint: string;
  status: number;
  duration_ms: number;
  remediationNeeded: boolean;
  checkedAt: string;
}

const PROBE_PATHS = [
  '/rest/api/3/myself',
  '/rest/api/3/field',
  '/rest/agile/1.0/board',
  '/rest/api/3/workflow/search',
] as const;

const PROBE_TIMEOUT_MS = 5000;

export async function runPermissionProbes(connectionId: string): Promise<ProbeResult[]> {
  const db = getDb();
  const conn = db
    .prepare('SELECT cloudId FROM connections WHERE connectionId = ?')
    .get(connectionId) as { cloudId: string } | undefined;

  if (!conn) {
    throw new Error(`Connection not found: ${connectionId}`);
  }

  const baseUrl = `https://api.atlassian.com/ex/jira/${conn.cloudId}`;
  const client = JiraHttpClient.forConnection(connectionId);
  const checkedAt = new Date().toISOString();

  const probePromises = PROBE_PATHS.map(async (path) => {
    const url = `${baseUrl}${path}`;
    const start = Date.now();
    let status: number;

    try {
      const response = await client.request(url);
      status = response.status;
    } catch {
      status = 0;
    }

    const duration_ms = Date.now() - start;
    const remediationNeeded = status === 403;

    console.log(
      `[permission-probe] connectionId=${connectionId} endpoint=${path} status=${status} duration_ms=${duration_ms}`
    );

    return { endpoint: path, status, duration_ms, remediationNeeded, checkedAt };
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('Permission probes timed out after 5s')),
      PROBE_TIMEOUT_MS
    )
  );

  const results = await Promise.race([Promise.all(probePromises), timeoutPromise]);

  db.transaction(() => {
    db.prepare('DELETE FROM probe_results WHERE connectionId = ?').run(connectionId);
    const insert = db.prepare(
      `INSERT INTO probe_results (connectionId, endpoint, status, duration_ms, remediationNeeded, checkedAt)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of results) {
      insert.run(
        connectionId,
        r.endpoint,
        r.status,
        r.duration_ms,
        r.remediationNeeded ? 1 : 0,
        r.checkedAt
      );
    }
  })();

  return results;
}

export function getProbeResults(connectionId: string): ProbeResult[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT endpoint, status, duration_ms, remediationNeeded, checkedAt
         FROM probe_results
        WHERE connectionId = ?
        ORDER BY id`
    )
    .all(connectionId) as Array<{
      endpoint: string;
      status: number;
      duration_ms: number;
      remediationNeeded: number;
      checkedAt: string;
    }>;

  return rows.map((r) => ({
    endpoint: r.endpoint,
    status: r.status,
    duration_ms: r.duration_ms,
    remediationNeeded: r.remediationNeeded === 1,
    checkedAt: r.checkedAt,
  }));
}
