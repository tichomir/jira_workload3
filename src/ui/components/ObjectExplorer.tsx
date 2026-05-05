import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiFetch.js';
import type { SidebarObjectType } from './InventorySidebar.js';
import './ObjectExplorer.css';

const LIMIT = 50;

type ChangeBadge = 'added' | 'modified' | 'deleted' | 'unchanged';

interface InventoryItem {
  id: string;
  displayName: string;
  summary?: string;
  /** Jira project key extracted from the issue key (e.g. "PROJ" from "PROJ-42"). Issues only. */
  projectKey?: string;
  /** Numeric part of the issue key (e.g. 42 from "PROJ-42"). Issues only. */
  issueNumber?: number;
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

const FACETS = [
  { key: 'status',    label: 'Status',      placeholder: 'e.g. In Progress'  },
  { key: 'issueType', label: 'Issue Type',  placeholder: 'e.g. Bug, Story'   },
  { key: 'assignee',  label: 'Assignee',    placeholder: 'Account ID'         },
  { key: 'sprint',    label: 'Sprint',      placeholder: 'Sprint ID'           },
  { key: 'board',     label: 'Board',       placeholder: 'Board ID'            },
  { key: 'label',     label: 'Label',       placeholder: 'Label text'          },
  { key: 'priority',  label: 'Priority',    placeholder: 'e.g. High, Medium'  },
] as const;

type FacetKey = typeof FACETS[number]['key'];

const FILTER_KEYS = [
  'status', 'issueType', 'assignee', 'sprint', 'board', 'label', 'priority',
  'updatedFrom', 'updatedTo', 'q', 'attachmentFilename',
];

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

function countActiveFilters(params: URLSearchParams): number {
  let n = 0;
  for (const key of FILTER_KEYS) {
    if (params.getAll(key).some(v => v.trim() !== '')) n++;
  }
  return n;
}

// ── TagInput ──────────────────────────────────────────────────────

interface TagInputProps {
  id: string;
  label: string;
  placeholder: string;
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}

function TagInput({ id, label, placeholder, values, onAdd, onRemove }: TagInputProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    const v = draft.trim();
    if (v && !values.includes(v)) onAdd(v);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onRemove(values[values.length - 1]);
    }
  }

  return (
    <div className="obj-exp__facet">
      <label className="obj-exp__facet-label" htmlFor={id}>{label}</label>
      <div className="obj-exp__tag-box" role="group" aria-label={`${label} filter values`}>
        {values.map((v) => (
          <span key={v} className="obj-exp__tag">
            <span className="obj-exp__tag-val">{v}</span>
            <button
              type="button"
              className="obj-exp__tag-rm"
              onClick={() => onRemove(v)}
              aria-label={`Remove ${label} filter: ${v}`}
            >×</button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          className="obj-exp__tag-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : '+ Add'}
          aria-label={`Add ${label} filter value (press Enter or comma to confirm)`}
        />
      </div>
    </div>
  );
}

// ── ObjectExplorer ────────────────────────────────────────────────

export function ObjectExplorer({
  connectionId,
  backupPointId,
  selectedType,
  siteName,
}: ObjectExplorerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InventoryItemsResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  // Reset pagination and expanded row when key parameters change
  useEffect(() => {
    setOffset(0);
    setExpandedId(null);
  }, [connectionId, backupPointId, selectedType]);

  // Fetch inventory items
  useEffect(() => {
    if (!backupPointId) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const url = new URL(
      `/api/inventory/${encodeURIComponent(selectedType)}`,
      window.location.origin,
    );
    url.searchParams.set('connectionId', connectionId);
    url.searchParams.set('backupPointId', backupPointId);
    url.searchParams.set('limit', String(LIMIT));
    url.searchParams.set('offset', String(offset));

    if (selectedType === 'Issue') {
      for (const f of FACETS) {
        for (const v of searchParams.getAll(f.key)) {
          if (v) url.searchParams.append(f.key, v);
        }
      }
      const from = searchParams.get('updatedFrom');
      const to   = searchParams.get('updatedTo');
      if (from) url.searchParams.set('updatedFrom', from);
      if (to)   url.searchParams.set('updatedTo', to);
      const q  = searchParams.get('q');
      const af = searchParams.get('attachmentFilename');
      if (q)  url.searchParams.set('q', q);
      if (af) url.searchParams.set('attachmentFilename', af);
    }

    apiFetch<InventoryItemsResponse>(url.pathname + url.search)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load items');
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [connectionId, backupPointId, selectedType, offset, searchParams]);

  const copyToClipboard = useCallback((text: string, itemId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(itemId);
      setTimeout(() => setCopiedId((prev) => (prev === itemId ? null : prev)), 2000);
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(itemId);
      setTimeout(() => setCopiedId((prev) => (prev === itemId ? null : prev)), 2000);
    });
  }, []);

  // ── Filter helpers — always reset to page 1 ───────────────────

  function setParam(key: string, value: string) {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
  }

  function addTag(key: FacetKey, value: string) {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!next.getAll(key).includes(value)) next.append(key, value);
      return next;
    });
  }

  function removeTag(key: FacetKey, value: string) {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const remaining = next.getAll(key).filter((v) => v !== value);
      next.delete(key);
      remaining.forEach((v) => next.append(key, v));
      return next;
    });
  }

  function clearFilters() {
    setOffset(0);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      FILTER_KEYS.forEach((k) => next.delete(k));
      return next;
    });
  }

  // ── Derived display values ────────────────────────────────────

  const label         = TYPE_LABELS[selectedType];
  const total         = data?.pagination.total ?? 0;
  const currentOffset = data?.pagination.offset ?? offset;
  const currentLimit  = data?.pagination.limit ?? LIMIT;
  const startItem     = total === 0 ? 0 : currentOffset + 1;
  const endItem       = Math.min(currentOffset + currentLimit, total);
  const hasPrev       = offset > 0;
  const hasNext       = total > 0 && offset + LIMIT < total;
  const activeFilters = selectedType === 'Issue' ? countActiveFilters(searchParams) : 0;

  function handlePrev() { setOffset((o) => Math.max(0, o - LIMIT)); setExpandedId(null); }
  function handleNext() { setOffset((o) => o + LIMIT); setExpandedId(null); }
  function toggleTrace(id: string) { setExpandedId((prev) => (prev === id ? null : id)); }

  return (
    <section className="obj-exp" aria-label="Object Explorer">

      {/* Header */}
      <div className="obj-exp__header">
        <h2 className="obj-exp__title">{label}</h2>
        <span className="obj-exp__site">{siteName}</span>
      </div>

      {/* Search + filters — Issue type only */}
      {selectedType === 'Issue' && backupPointId && (
        <div className="obj-exp__search-bar">

          {/* Two search inputs */}
          <div className="obj-exp__search-row">
            <div className="obj-exp__search-field">
              <label htmlFor="oe-q" className="obj-exp__search-label">Search</label>
              <input
                id="oe-q"
                type="search"
                className="obj-exp__search-input"
                placeholder="Issue key (PROJ-42) or summary keywords…"
                value={searchParams.get('q') ?? ''}
                onChange={(e) => setParam('q', e.target.value)}
                aria-label="Search by issue key or summary"
              />
            </div>
            <div className="obj-exp__search-field">
              <label htmlFor="oe-af" className="obj-exp__search-label">Attachment filename</label>
              <input
                id="oe-af"
                type="search"
                className="obj-exp__search-input"
                placeholder="Partial filename search…"
                value={searchParams.get('attachmentFilename') ?? ''}
                onChange={(e) => setParam('attachmentFilename', e.target.value)}
                aria-label="Search by attachment filename"
              />
            </div>
          </div>

          {/* Filter toggle + clear */}
          <div className="obj-exp__filter-toggle-row">
            <button
              type="button"
              className={`obj-exp__filter-toggle${filterOpen ? ' obj-exp__filter-toggle--open' : ''}`}
              onClick={() => setFilterOpen((o) => !o)}
              aria-expanded={filterOpen}
              aria-controls="oe-filter-panel"
            >
              {filterOpen ? '▾' : '▸'} Filters
              {activeFilters > 0 && (
                <span
                  className="obj-exp__filter-badge"
                  aria-label={`${activeFilters} active filter${activeFilters > 1 ? 's' : ''}`}
                >
                  {activeFilters}
                </span>
              )}
            </button>
            {activeFilters > 0 && (
              <button type="button" className="obj-exp__filter-clear" onClick={clearFilters}>
                Clear all
              </button>
            )}
          </div>

          {/* Collapsible filter panel */}
          {filterOpen && (
            <div id="oe-filter-panel" className="obj-exp__filter-panel" role="group" aria-label="Filter facets">
              <div className="obj-exp__filter-grid">

                {/* Multi-value tag inputs for 7 facets */}
                {FACETS.map((f) => (
                  <TagInput
                    key={f.key}
                    id={`facet-${f.key}`}
                    label={f.label}
                    placeholder={f.placeholder}
                    values={searchParams.getAll(f.key)}
                    onAdd={(v) => addTag(f.key, v)}
                    onRemove={(v) => removeTag(f.key, v)}
                  />
                ))}

                {/* Date range */}
                <div className="obj-exp__facet obj-exp__facet--date">
                  <span className="obj-exp__facet-label">Updated date range</span>
                  <div className="obj-exp__date-range">
                    <div className="obj-exp__date-field">
                      <label htmlFor="facet-updatedFrom" className="obj-exp__date-label">From</label>
                      <input
                        id="facet-updatedFrom"
                        type="date"
                        className="obj-exp__date-input"
                        value={searchParams.get('updatedFrom') ?? ''}
                        onChange={(e) => setParam('updatedFrom', e.target.value)}
                        aria-label="Updated from date"
                      />
                    </div>
                    <div className="obj-exp__date-field">
                      <label htmlFor="facet-updatedTo" className="obj-exp__date-label">To</label>
                      <input
                        id="facet-updatedTo"
                        type="date"
                        className="obj-exp__date-input"
                        value={searchParams.get('updatedTo') ?? ''}
                        onChange={(e) => setParam('updatedTo', e.target.value)}
                        aria-label="Updated to date"
                      />
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      )}

      {/* No backup state */}
      {!backupPointId && !loading && (
        <div className="obj-exp__empty">
          No backup point found. Run a backup first to browse protected objects.
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="obj-exp__error" role="alert">{error}</div>
      )}

      {/* Pagination bar */}
      {backupPointId && !error && (
        <div className="obj-exp__pagination-bar">
          <span className="obj-exp__count">
            {loading
              ? 'Loading…'
              : total === 0
                ? (activeFilters > 0 ? 'No results for current filters' : 'No items')
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
                      <dd className="obj-exp__trace-id-row">
                        <code>{item.backupPointId}</code>
                        <button
                          className={`obj-exp__copy-btn${copiedId === item.id ? ' obj-exp__copy-btn--copied' : ''}`}
                          onClick={() => copyToClipboard(item.backupPointId, item.id)}
                          aria-label={copiedId === item.id ? 'Copied!' : `Copy backup point ID ${item.backupPointId}`}
                          title={copiedId === item.id ? 'Copied!' : 'Copy to clipboard'}
                        >
                          {copiedId === item.id ? '✓' : '⎘'}
                        </button>
                      </dd>
                      <dt>Captured At</dt>
                      <dd>
                        <time dateTime={item.backupPointTimestamp} title={item.backupPointTimestamp}>
                          {formatTimestamp(item.backupPointTimestamp)}
                        </time>
                      </dd>
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Empty state */}
      {!loading && !error && backupPointId && data && data.items.length === 0 && (
        <div className="obj-exp__empty">
          {activeFilters > 0
            ? `No ${label.toLowerCase()} match the current filters. Try adjusting or clearing your filters.`
            : `No ${label.toLowerCase()} found in this backup point.`}
        </div>
      )}

    </section>
  );
}
