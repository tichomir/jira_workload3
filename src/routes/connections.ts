import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { getProbeResults } from '../probes/permissionProbes.js';

const router = Router();

router.post('/', (req, res) => {
  const {
    cloudId,
    siteName,
    accessToken,
    refreshToken,
    expiresAt,
    scopes,
    clientId,
    clientSecret,
  } = req.body as {
    cloudId?: string;
    siteName?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string | string[];
    clientId?: string;
    clientSecret?: string;
  };

  if (!cloudId || !siteName || !accessToken || !refreshToken || expiresAt === undefined) {
    res.status(400).json({ error: 'missing_required_fields' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const scopeStr = Array.isArray(scopes) ? scopes.join(' ') : (scopes ?? '');

  const existing = db
    .prepare('SELECT connectionId FROM connections WHERE cloudId = ?')
    .get(cloudId) as { connectionId: string } | undefined;

  const connectionId = existing?.connectionId ?? randomUUID();

  db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE connections SET siteName = ?, status = 'active', updatedAt = ? WHERE connectionId = ?`
      ).run(siteName, now, connectionId);

      db.prepare(
        `UPDATE credentials
            SET accessToken = ?, refreshToken = ?, expiresAt = ?, scopes = ?, updatedAt = ?,
                clientId = ?, clientSecret = ?
          WHERE connectionId = ?`
      ).run(
        accessToken,
        refreshToken,
        expiresAt,
        scopeStr,
        now,
        clientId ?? null,
        clientSecret ?? null,
        connectionId
      );
    } else {
      db.prepare(
        `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
         VALUES (?, ?, ?, 'active', ?, ?)`
      ).run(connectionId, cloudId, siteName, now, now);

      db.prepare(
        `INSERT INTO credentials
           (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt, clientId, clientSecret)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        connectionId,
        accessToken,
        refreshToken,
        expiresAt,
        scopeStr,
        now,
        clientId ?? null,
        clientSecret ?? null
      );
    }
  })();

  res.status(201).json({ connectionId, status: 'connected' });
});

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
