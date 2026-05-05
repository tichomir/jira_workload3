import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch.js';
import './SdiTeaserPanel.css';

interface RegulationEntry {
  code: string;
  status: 'active' | 'inactive';
}

interface SdiTeaserResponse {
  backupPointId: string;
  issueCount: number;
  projectCount: number;
  regulations: RegulationEntry[];
}

export interface SdiChip {
  code: string;
  label: string;
  active: boolean;
}

export interface SdiDisplay {
  showBadge: boolean;
  subtext: string;
  chips: SdiChip[];
}

export function buildSdiDisplay(data: SdiTeaserResponse): SdiDisplay {
  return {
    showBadge: data.issueCount > 0,
    subtext: `${data.issueCount} issues across ${data.projectCount} projects`,
    chips: data.regulations
      .filter((r) => r.code !== 'HIPAA')
      .map((r) => ({
        code: r.code,
        label: r.code === 'PCI_DSS' ? 'PCI DSS' : r.code,
        active: r.status === 'active',
      })),
  };
}

export interface SdiTeaserPanelProps {
  backupPointId: string;
}

export function SdiTeaserPanel({ backupPointId }: SdiTeaserPanelProps) {
  const [data, setData] = useState<SdiTeaserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<SdiTeaserResponse>(`/api/backup-points/${encodeURIComponent(backupPointId)}/sdi-teaser`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load SDI summary'))
      .finally(() => setLoading(false));
  }, [backupPointId]);

  if (loading) return null;
  if (error || !data) return null;

  const display = buildSdiDisplay(data);

  return (
    <div className="sdi-panel">
      <div className="sdi-panel__left">
        {display.showBadge && (
          <div className="sdi-panel__badge">
            <span className="sdi-panel__badge-icon" aria-hidden="true">⚠</span>
            Sensitive data detected
          </div>
        )}
        {display.showBadge && (
          <p className="sdi-panel__subtext">{display.subtext}</p>
        )}
        {!display.showBadge && (
          <p className="sdi-panel__no-findings">No sensitive data detected in this backup point.</p>
        )}
      </div>
      <div className="sdi-panel__chips">
        {display.chips.map((chip) => (
          <span
            key={chip.code}
            className={`sdi-panel__chip sdi-panel__chip--${chip.code.toLowerCase().replace('_', '-')} ${chip.active ? 'sdi-panel__chip--active' : 'sdi-panel__chip--inactive'}`}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}
