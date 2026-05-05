import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/database.js';

interface SdiSummaryRow {
  backupPointId: string;
  issueCount: number;
  projectCount: number;
  regulations: string;
}

interface RegulationEntry {
  code: string;
  status: 'active' | 'inactive';
}

export function handleGetSdiTeaser(req: Request, res: Response): void {
  const id = req.params['id'];
  const db = getDb();

  const row = db
    .prepare(
      'SELECT backupPointId, issueCount, projectCount, regulations FROM backup_point_sdi_summary WHERE backupPointId = ?',
    )
    .get(id) as SdiSummaryRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'not_found', message: `No SDI summary found for backup point ${id}` });
    return;
  }

  let regs: { gdpr?: string; pciDss?: string } = {};
  try {
    regs = JSON.parse(row.regulations) as { gdpr?: string; pciDss?: string };
  } catch {
    // malformed JSON — default both to inactive
  }

  const regulations: RegulationEntry[] = [
    { code: 'GDPR', status: (regs.gdpr === 'active' ? 'active' : 'inactive') },
    { code: 'PCI_DSS', status: (regs.pciDss === 'active' ? 'active' : 'inactive') },
  ];

  res.json({
    backupPointId: row.backupPointId,
    issueCount: row.issueCount,
    projectCount: row.projectCount,
    regulations,
  });
}

const router = Router();
router.get('/:id/sdi-teaser', handleGetSdiTeaser);

export { router as backupPointsRouter };
