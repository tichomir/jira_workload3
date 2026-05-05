import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiFetch.js';
import type { SidebarObjectType } from './InventorySidebar.js';
import './ObjectExplorer.css';

const LIMIT = 50;

type ChangeBadge = 'added' | 'modified' | 'deleted' | 'unchanged';

interface InventoryItem {
  id: string;
  displayName: string;
  summary?: string;
  backupPointId: string;
  backupPointTimestamp: string;
  changeBadge: ChangeBadge;
}

interface InventoryItemsResponse {
  items: InventoryItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface ObjectExplorerProps {
  connectionId: string;
  backupPointId: string | null;
  selectedType: SidebarObjectType;
  siteName: string;
}

const BADGE_LABELS: Record<ChangeBadge, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  unchanged: 'Unchanged',
};

const TYPE_LABELS: Record<SidebarObjectType, string> = {
  Issue: 'Issues',
  Project: 'Projects',
  Board: 'Boards',
  Sprint: 'Sprints',
};

function formatTimestamp(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function ObjectExplorer({
  connectionId,
  backupPointId,
  selectedType,
  siteName,
}: ObjectExplorerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InventoryItemsResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reset pagination and expanded row when key parameters change
  useEffect(() => {
    setOffset(0);
    setExpandedId(null);
  }, [connectionId, backupPointId, selectedType]);

  useEffect(() => {
    if (!backupPointId) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const url =
      `/api/inventory/${encodeURIComponent(selectedType)}` +
      `?connectionId=${encodeURIComponent(connectionId)}` +
      `&backupPointId=${encodeURIComponent(backupPointId)}` +
      `&limit=${LIMIT}` +
      `&offset=${offset}`;

    apiFetch<InventoryItemsResponse>(url)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load items');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionId, backupPointId, selectedType, offset]);

  const label = TYPE_LABELS[selectedType];
  const total = data?.pagination.total ?? 0;
  const currentOffset = data?.pagination.offset ?? offset;
  const currentLimit = data?.pagination.limit ?? LIMIT;
  const startItem = total === 0 ? 0 : currentOffset + 1;
  const endItem = Math.min(currentOffset + currentLimit, total);
  const hasPrev = offset > 0;
  const hasNext = total > 0 && offset + LIMIT < total;

  function handlePrev() {
    setOffset((o) => Math.max(0, o - LIMIT));
    setExpandedId(null);
  }

  function handleNext() {
    setOffset((o) => o + LIMIT);
    setExpandedId(null);
  }

  function toggleTrace(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <section className="obj-exp" aria-label="Object Explorer">
      {/* Header */}
      <div className="obj-exp__header">
        <h2 className="obj-exp__title">{label}</h2>
        <span className="obj-exp__site">{siteName}</span>
      </div>

      {/* No backup state */}
      {!backupPointId && !loading && (
        <div className="obj-exp__empty">
          No backup point found. Run a backup first to browse protected objects.
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="obj-exp__error" role="alert">
          {error}
        </div>
      )}

      {/* Pagination bar */}
      {backupPointId && !error && (
        <div className="obj-exp__pagination-bar">
          <span className="obj-exp__count">
            {loading
              ? 'Loading…'
              : total === 0
              ? 'No items'
              : `Showing ${startItem.toLocaleString()}–${endItem.toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          <div className="obj-exp__pagination-controls">
            <button
              className="obj-exp__page-btn"
              onClick={handlePrev}
              disabled={!hasPrev || loading}
              aria-label="Previous page"
            >
              &larr; Prev
            </button>
            <button
              className="obj-exp__page-btn"
              onClick={handleNext}
              disabled={!hasNext || loading}
              aria-label="Next page"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <ul className="obj-exp__list" aria-label="Loading items" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="obj-exp__skeleton-row" aria-hidden="true">
              <div className="obj-exp__skeleton-badge" />
              <div className="obj-exp__skeleton-name" />
              <div className="obj-exp__skeleton-btn" />
            </li>
          ))}
        </ul>
      )}

      {/* Items list */}
      {!loading && data && data.items.length > 0 && (
        <ul className="obj-exp__list" aria-label={`${label} list`}>
          {data.items.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <li
                key={item.id}
                className={`obj-exp__row${isExpanded ? ' obj-exp__row--expanded' : ''}`}
              >
                <div className="obj-exp__row-main">
                  <span
                    className={`obj-exp__badge obj-exp__badge--${item.changeBadge}`}
                    aria-label={`Change: ${BADGE_LABELS[item.changeBadge]}`}
                  >
                    {BADGE_LABELS[item.changeBadge]}
                  </span>
                  <div className="obj-exp__row-text">
                    <span className="obj-exp__display-name">{item.displayName}</span>
                    {item.summary !== undefined && item.summary !== '' && (
                      <span className="obj-exp__summary">{item.summary}</span>
                    )}
                  </div>
                  <button
                    className={`obj-exp__trace-btn${isExpanded ? ' obj-exp__trace-btn--active' : ''}`}
                    onClick={() => toggleTrace(item.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Hide' : 'Show'} backup trace for ${item.displayName}`}
                    title="Show backup trace"
                  >
                    &#8853;
                  </button>
                </div>
                {isExpanded && (
                  <div
                    className="obj-exp__trace-panel"
                    role="region"
                    aria-label={`Backup trace for ${item.displayName}`}
                  >
                    <dl className="obj-exp__trace-dl">
                      <dt>Backup Point ID</dt>
                      <dd>
                        <code>{item.backupPointId}</code>
                      </dd>
                      <dt>Captured At</dt>
                      <dd>{formatTimestamp(item.backupPointTimestamp)}</dd>
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Empty state — loaded but no items */}
      {!loading && !error && backupPointId && data && data.items.length === 0 && (
        <div className="obj-exp__empty">
          No {label.toLowerCase()} found in this backup point.
        </div>
      )}
    </section>
  );
}
