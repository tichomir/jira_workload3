import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';
import { getProbeResults } from '../probes/permissionProbes.js';

const router = Router();

function maskClientId(clientId: string): string {
  return '****' + clientId.slice(-4);
}

type OAuthBody = {
  connectionType?: string;
  mode?: string;
  connectionId?: string;
  cloudId: string;
  siteName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string | string[];
};

type ManualBody = {
  connectionType?: string;
  mode?: string;
  connectionId?: string;
  cloudId?: string;
  siteName?: string;
  clientId: string;
  clientSecret: string;
};

export function handleCreateConnection(req: Request, res: Response): void {
  const body = req.body as Record<string, unknown>;
  const mode =
    (body['mode'] as string | undefined) ??
    (body['connectionType'] as string | undefined) ??
    'oauth';

  if (mode === 'manual') {
    _handleManual(body as unknown as ManualBody, res);
  } else {
    _handleOAuth(body as unknown as OAuthBody, res);
  }
}

function _handleOAuth(body: Partial<OAuthBody>, res: Response): void {
  const { connectionId: incomingConnId, cloudId, siteName, accessToken, refreshToken, expiresAt, scopes } = body;

  if (!cloudId || !siteName || !accessToken || !refreshToken || expiresAt === undefined) {
    res.status(400).json({ error: 'missing_required_fields' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : (scopes ?? '');
  const scopeArray = scopeStr ? scopeStr.split(' ') : [];

  if (incomingConnId) {
    const stored = db
      .prepare('SELECT connectionId, cloudId FROM connections WHERE connectionId = ?')
      .get(incomingConnId) as { connectionId: string; cloudId: string } | undefined;

    if (stored && stored.cloudId !== cloudId) {
      res.status(409).json({
        error: 'cloudid_mismatch',
        message:
          'The cloudId in the re-authorization response does not match the stored cloudId for this connection. Re-authorization must use the same Atlassian site.',
        storedCloudId: stored.cloudId,
        receivedCloudId: cloudId,
      });
      return;
    }
  }

  const existing = db
    .prepare('SELECT connectionId, createdAt FROM connections WHERE cloudId = ?')
    .get(cloudId) as { connectionId: string; createdAt: string } | undefined;

  const connectionId = incomingConnId ?? existing?.connectionId ?? randomUUID();

  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE connections SET siteName = ?, status = 'active', updatedAt = ? WHERE connectionId = ?`
      ).run(siteName, now, connectionId);
      db.prepare(
        `UPDATE credentials
            SET accessToken = ?, refreshToken = ?, expiresAt = ?, scopes = ?, updatedAt = ?
          WHERE connectionId = ?`
      ).run(accessToken, refreshToken, expiresAt, scopeStr, now, connectionId);
    } else {
      db.prepare(
        `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', ?, ?)`
      ).run(connectionId, cloudId, siteName, now, now);
      db.prepare(
        `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(connectionId, accessToken, refreshToken, expiresAt, scopeStr, now);
    }
  })();

  console.log(
    JSON.stringify({ event: 'connection_created', connectionId, cloudId, siteName, mode: 'oauth', at: now })
  );

  const createdAt =
    (db.prepare('SELECT createdAt FROM connections WHERE connectionId = ?').get(connectionId) as {
      createdAt: string;
    })?.createdAt ?? now;

  res.status(201).json({ connectionId, cloudId, siteName, scopes: scopeArray, createdAt, status: 'connected' });
}

function _handleManual(body: Partial<ManualBody>, res: Response): void {
  const { connectionId: incomingConnId, clientId, clientSecret } = body;

  if (!clientId || !clientSecret) {
    res.status(400).json({ error: 'missing_required_fields' });
    return;
  }

  const cloudId = body.cloudId ?? `manual:${clientId}`;
  const siteName = body.siteName ?? 'Manual Connection';

  const db = getDb();
  const now = new Date().toISOString();

  if (incomingConnId) {
    const stored = db
      .prepare('SELECT connectionId, cloudId FROM connections WHERE connectionId = ?')
      .get(incomingConnId) as { connectionId: string; cloudId: string } | undefined;

    if (stored && stored.cloudId !== cloudId) {
      res.status(409).json({
        error: 'cloudid_mismatch',
        message:
          'The cloudId in the re-authorization response does not match the stored cloudId for this connection. Re-authorization must use the same Atlassian site.',
        storedCloudId: stored.cloudId,
        receivedCloudId: cloudId,
      });
      return;
    }
  }

  const existing = db
    .prepare('SELECT connectionId, createdAt FROM connections WHERE cloudId = ?')
    .get(cloudId) as { connectionId: string; createdAt: string } | undefined;

  const connectionId = incomingConnId ?? existing?.connectionId ?? randomUUID();

  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE connections SET siteName = ?, status = 'active', updatedAt = ? WHERE connectionId = ?`
      ).run(siteName, now, connectionId);
      db.prepare(
        `UPDATE credentials SET clientId = ?, clientSecret = ?, updatedAt = ? WHERE connectionId = ?`
      ).run(clientId, clientSecret, now, connectionId);
    } else {
      db.prepare(
        `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', ?, ?)`
      ).run(connectionId, cloudId, siteName, now, now);
      db.prepare(
        `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt, clientId, clientSecret)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(connectionId, '', '', 0, '', now, clientId, clientSecret);
    }
  })();

  console.log(
    JSON.stringify({ event: 'connection_created', connectionId, cloudId, siteName, mode: 'manual', at: now })
  );

  const createdAt =
    (db.prepare('SELECT createdAt FROM connections WHERE connectionId = ?').get(connectionId) as {
      createdAt: string;
    })?.createdAt ?? now;

  res.status(201).json({
    connectionId,
    cloudId,
    siteName,
    scopes: [],
    createdAt,
    status: 'connected',
    clientIdMasked: maskClientId(clientId),
  });
}

router.post('/', handleCreateConnection);

router.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT connectionId, cloudId, siteName, status FROM connections ORDER BY createdAt')
    .all() as Array<{ connectionId: string; cloudId: string; siteName: string; status: string }>;

  const result = rows.map((conn) => {
    const probes = getProbeResults(conn.connectionId);
    const probeFailedAny = probes.some((p) => p.remediationNeeded);
    return {
      connectionId: conn.connectionId,
      cloudId: conn.cloudId,
      siteName: conn.siteName,
      status: probeFailedAny ? 'probe-failed' : 'connected',
      probes,
    };
  });

  res.json(result);
});

router.get('/:id/probes', (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const conn = db
    .prepare('SELECT connectionId FROM connections WHERE connectionId = ?')
    .get(id) as { connectionId: string } | undefined;

  if (!conn) {
    res.status(404).json({ error: 'connection_not_found' });
    return;
  }

  const probes = getProbeResults(id);
  res.json({ connectionId: id, probes });
});

export { router as connectionsRouter };
