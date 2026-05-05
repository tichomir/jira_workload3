import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch.js';
import type { InventoryResponse, ObjectTypeEntry } from '../../platform/contracts.js';
import './InventorySidebar.css';

export type SidebarObjectType = 'Issue' | 'Project' | 'Board' | 'Sprint';

const SIDEBAR_TYPES: SidebarObjectType[] = ['Issue', 'Project', 'Board', 'Sprint'];

const SIDEBAR_LABELS: Record<SidebarObjectType, string> = {
  Issue: 'Issues',
  Project: 'Projects',
  Board: 'Boards',
  Sprint: 'Sprints',
};

export interface InventorySidebarProps {
  connectionId: string;
  selectedType: SidebarObjectType;
  onSelect: (type: SidebarObjectType) => void;
  onInventoryLoad?: (data: { backupPointId: string | null }) => void;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function InventorySidebar({ connectionId, selectedType, onSelect, onInventoryLoad }: InventorySidebarProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ObjectTypeEntry[] | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<InventoryResponse>(`/api/inventory?connectionId=${encodeURIComponent(connectionId)}`)
      .then((data) => {
        setEntries(data.objectTypes);
        onInventoryLoad?.({ backupPointId: data.backupPointId ?? null });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load inventory'))
      .finally(() => setLoading(false));
  }, [connectionId]);

  if (loading) {
    return (
      <nav className="inv-sb" aria-label="Protected object types">
        <div className="inv-sb__header">Protected Objects</div>
        <ul className="inv-sb__list" role="list">
          {SIDEBAR_TYPES.map((type) => (
            <li key={type} className="inv-sb__skeleton" aria-hidden="true">
              <div className="inv-sb__skeleton-label" />
              <div className="inv-sb__skeleton-count" />
            </li>
          ))}
        </ul>
      </nav>
    );
  }

  if (error) {
    return (
      <nav className="inv-sb" aria-label="Protected object types">
        <div className="inv-sb__header">Protected Objects</div>
        <div className="inv-sb__error" role="alert">
          {error}
        </div>
      </nav>
    );
  }

  const entryMap = Object.fromEntries((entries ?? []).map((e) => [e.type, e])) as Record<
    string,
    ObjectTypeEntry
  >;

  const hasNoBackup = SIDEBAR_TYPES.every((t) => (entryMap[t]?.lastBackupAt ?? null) === null);

  return (
    <nav className="inv-sb" aria-label="Protected object types">
      <div className="inv-sb__header">Protected Objects</div>
      {hasNoBackup && (
        <div className="inv-sb__empty-banner" role="status">
          No backup yet
        </div>
      )}
      <ul className="inv-sb__list" role="list">
        {SIDEBAR_TYPES.map((type) => {
          const entry = entryMap[type];
          const count = entry?.count ?? 0;
          const lastBackupAt = entry?.lastBackupAt ?? null;
          const isSelected = type === selectedType;
          const tooltipText = lastBackupAt
            ? `Last backup: ${formatRelativeTime(lastBackupAt)} (${new Date(lastBackupAt).toLocaleString()})`
            : 'No backup yet';

          return (
            <li key={type}>
              <button
                className={`inv-sb__row${isSelected ? ' inv-sb__row--selected' : ''}`}
                onClick={() => onSelect(type)}
                aria-pressed={isSelected}
                aria-label={`${SIDEBAR_LABELS[type]}, ${count} objects. ${tooltipText}`}
              >
                <span className="inv-sb__label">{SIDEBAR_LABELS[type]}</span>
                <span className="inv-sb__right">
                  <span className="inv-sb__count">{count.toLocaleString()}</span>
                  {lastBackupAt && (
                    <span className="inv-sb__backup-time" title={tooltipText}>
                      {formatRelativeTime(lastBackupAt)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
