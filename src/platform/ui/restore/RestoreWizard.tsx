import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './RestoreWizard.css';

// ── Types ────────────────────────────────────────────────────────────────────

type ConflictMode = 'override' | 'skip' | 'ask';
type RestoreDestinationType = 'original' | 'alternate' | 'export';
type ObjectType = 'Issue' | 'Project' | 'Board' | 'Sprint';

interface ConnectionSummary {
  connectionId: string;
  siteName: string;
  cloudId: string;
}

interface InventoryObjectTypeEntry {
  type: string;
  count: number;
  lastBackupAt: string | null;
}

interface InventoryResponse {
  backupPointId: string | null;
  objectTypes: InventoryObjectTypeEntry[];
}

interface InventoryItem {
  id: string;
  displayName: string;
  summary?: string;
}

interface InventoryItemsResponse {
  items: InventoryItem[];
  pagination: { limit: number; offset: number; total: number };
}

// ── Constants ────────────────────────────────────────────────────────────────

const OBJECT_TYPES: ObjectType[] = ['Issue', 'Project', 'Board', 'Sprint'];

const CONFLICT_OPTIONS: { value: ConflictMode; label: string; desc: string }[] = [
  {
    value: 'skip',
    label: 'Skip',
    desc: 'If an object already exists at the destination, skip it and continue restoring others.',
  },
  {
    value: 'override',
    label: 'Override',
    desc: 'If an object already exists, overwrite it with the backed-up version.',
  },
  {
    value: 'ask',
    label: 'Ask per conflict',
    desc: 'Pause and prompt for a decision whenever a conflict is detected during restore.',
  },
];

const DESTINATION_OPTIONS: { value: RestoreDestinationType; label: string; desc: string }[] = [
  {
    value: 'original',
    label: 'Original location',
    desc: 'Restore objects back to the same Jira project and site from which they were backed up.',
  },
  {
    value: 'alternate',
    label: 'Alternate location (same Jira site)',
    desc: 'Restore objects into a different project on the same connected Jira site.',
  },
  {
    value: 'export',
    label: 'Export / Browser Download',
    desc: 'Download the selected backup data as a file instead of writing back to Jira.',
  },
];

const STEPS = [
  { label: 'Select objects' },
  { label: 'Conflict mode' },
  { label: 'Destination' },
  { label: 'Review' },
];

// ── Step 1: Object Selection ─────────────────────────────────────────────────

interface Step1Props {
  connectionId: string;
  setConnectionId: (id: string) => void;
  backupPointId: string | null;
  selectedType: ObjectType;
  setSelectedType: (t: ObjectType) => void;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  connections: ConnectionSummary[];
  connectionsLoading: boolean;
}

function Step1({
  connectionId,
  setConnectionId,
  backupPointId,
  selectedType,
  setSelectedType,
  selection,
  setSelection,
  connections,
  connectionsLoading,
}: Step1Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  useEffect(() => {
    if (!connectionId || !backupPointId) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsError(null);

    const url = `/api/inventory/${encodeURIComponent(selectedType)}?connectionId=${encodeURIComponent(connectionId)}&backupPointId=${encodeURIComponent(backupPointId)}&limit=50&offset=0`;

    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: InventoryItemsResponse) => {
        if (!cancelled) {
          setItems(d.items);
          setTotal(d.pagination.total);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setItemsError(e instanceof Error ? e.message : 'Failed to load items');
      })
      .finally(() => { if (!cancelled) setItemsLoading(false); });

    return () => { cancelled = true; };
  }, [connectionId, backupPointId, selectedType]);

  const allOnPageSelected =
    items.length > 0 && items.every((item) => selection.has(item.id));

  function toggleAll() {
    const next = new Set(selection);
    if (allOnPageSelected) {
      items.forEach((item) => next.delete(item.id));
    } else {
      items.forEach((item) => next.add(item.id));
    }
    setSelection(next);
  }

  function toggleItem(id: string) {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelection(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h3 className="rw__body-title">Select objects to restore</h3>
        <p className="rw__body-desc">
          Choose the Jira connection and select which backed-up objects to restore.
        </p>
      </div>

      <div className="rw__field">
        <label className="rw__label" htmlFor="rw-connection">Connection</label>
        {connectionsLoading ? (
          <div className="rw__hint">Loading connections…</div>
        ) : connections.length === 0 ? (
          <div className="rw__error">No connections available. Connect a Jira site first.</div>
        ) : (
          <select
            id="rw-connection"
            className="rw__select"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            {connections.map((c) => (
              <option key={c.connectionId} value={c.connectionId}>
                {c.siteName} ({c.connectionId.slice(0, 8)}…)
              </option>
            ))}
          </select>
        )}
      </div>

      {backupPointId ? (
        <div className="rw__field">
          <span className="rw__label">Most recent backup point</span>
          <div className="rw__bp-info">
            <span>Backup Point ID: <code>{backupPointId}</code></span>
          </div>
        </div>
      ) : connectionId ? (
        <div className="rw__hint">No backup point found for this connection. Run a backup first.</div>
      ) : null}

      {backupPointId && (
        <div className="rw__field">
          <span className="rw__label">Objects to restore</span>
          <div className="rw__sel-header">
            <div className="rw__sel-tabs" role="tablist" aria-label="Object type">
              {OBJECT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={selectedType === t}
                  className={`rw__sel-tab${selectedType === t ? ' rw__sel-tab--active' : ''}`}
                  onClick={() => setSelectedType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="rw__sel-count">
              <strong>{selection.size}</strong> selected
            </span>
          </div>

          <div className="rw__sel-list" role="region" aria-label={`${selectedType} list`}>
            {itemsLoading && <div className="rw__sel-loading">Loading {selectedType.toLowerCase()}s…</div>}
            {itemsError && <div className="rw__error" style={{ margin: '8px' }}>{itemsError}</div>}
            {!itemsLoading && !itemsError && items.length === 0 && (
              <div className="rw__sel-empty">No {selectedType.toLowerCase()}s in this backup point.</div>
            )}
            {!itemsLoading && !itemsError && items.length > 0 && (
              <>
                <label className="rw__sel-selectall">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label="Select all items on this page"
                  />
                  Select all on this page ({items.length} of {total.toLocaleString()})
                </label>
                {items.map((item) => (
                  <label key={item.id} className="rw__sel-item">
                    <input
                      type="checkbox"
                      checked={selection.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      aria-label={`Select ${item.displayName}`}
                    />
                    <span className="rw__sel-item-name" title={item.summary ?? item.displayName}>
                      {item.displayName}
                      {item.summary ? <span style={{ color: '#6b778c', marginLeft: 6, fontSize: 12 }}>{item.summary}</span> : null}
                    </span>
                    <span className="rw__sel-item-type">{selectedType}</span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="rw__hint">
            Select individual items or use "Select all" to restore all objects of a type.
            Switch tabs to select objects of other types — selections are preserved.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 2: Conflict Mode ────────────────────────────────────────────────────

interface Step2Props {
  conflictMode: ConflictMode;
  setConflictMode: (m: ConflictMode) => void;
}

function Step2({ conflictMode, setConflictMode }: Step2Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h3 className="rw__body-title">Conflict mode</h3>
        <p className="rw__body-desc">
          Choose how the restore engine handles objects that already exist at the destination.
          <strong> Skip</strong> is the recommended default.
        </p>
      </div>

      <div className="rw__radio-group" role="radiogroup" aria-label="Conflict mode">
        {CONFLICT_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`rw__radio-option${conflictMode === opt.value ? ' rw__radio-option--selected' : ''}`}
          >
            <input
              type="radio"
              name="conflictMode"
              value={opt.value}
              checked={conflictMode === opt.value}
              onChange={() => setConflictMode(opt.value)}
              aria-label={opt.label}
            />
            <div className="rw__radio-text">
              <span className="rw__radio-label">{opt.label}</span>
              <span className="rw__radio-desc">{opt.desc}</span>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Step 3: Destination ──────────────────────────────────────────────────────

interface Step3Props {
  destination: RestoreDestinationType;
  setDestination: (d: RestoreDestinationType) => void;
  alternateProjectKey: string;
  setAlternateProjectKey: (k: string) => void;
}

function Step3({ destination, setDestination, alternateProjectKey, setAlternateProjectKey }: Step3Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h3 className="rw__body-title">Restore destination</h3>
        <p className="rw__body-desc">
          Choose where to write the restored objects. All options target the same connected
          Jira site.
        </p>
      </div>

      <div className="rw__radio-group" role="radiogroup" aria-label="Restore destination">
        {DESTINATION_OPTIONS.map((opt) => (
          <div key={opt.value}>
            <label
              className={`rw__radio-option${destination === opt.value ? ' rw__radio-option--selected' : ''}`}
            >
              <input
                type="radio"
                name="destination"
                value={opt.value}
                checked={destination === opt.value}
                onChange={() => setDestination(opt.value)}
                aria-label={opt.label}
              />
              <div className="rw__radio-text">
                <span className="rw__radio-label">{opt.label}</span>
                <span className="rw__radio-desc">{opt.desc}</span>
              </div>
            </label>
            {opt.value === 'alternate' && destination === 'alternate' && (
              <div className="rw__alt-fields">
                <div className="rw__field">
                  <label className="rw__label" htmlFor="rw-alt-project">Target project key</label>
                  <input
                    id="rw-alt-project"
                    className="rw__input"
                    type="text"
                    placeholder="e.g. PROJ"
                    value={alternateProjectKey}
                    onChange={(e) => setAlternateProjectKey(e.target.value.toUpperCase())}
                    aria-label="Target project key for alternate location restore"
                  />
                  <span className="rw__hint">
                    Enter the project key of the target project on the same connected Jira site.
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="rw__crosssite-note" role="note">
        <span className="rw__crosssite-note-icon" aria-hidden="true">ℹ</span>
        <span>
          <strong>Cross-site restore not supported in Phase 1.</strong>{' '}
          Restoring to a different Jira Cloud site or a different Atlassian tenant is not
          available. All destination options above apply to the same connected site only.
        </span>
      </div>
    </div>
  );
}

// ── Step 4: Review ───────────────────────────────────────────────────────────

interface Step4Props {
  connectionId: string;
  connections: ConnectionSummary[];
  backupPointId: string | null;
  selection: Set<string>;
  conflictMode: ConflictMode;
  destination: RestoreDestinationType;
  alternateProjectKey: string;
  submitError: string | null;
  submitting: boolean;
}

const CONFLICT_LABELS: Record<ConflictMode, string> = {
  skip: 'Skip',
  override: 'Override',
  ask: 'Ask per conflict',
};

const DESTINATION_LABELS: Record<RestoreDestinationType, string> = {
  original: 'Original location',
  alternate: 'Alternate location (same Jira site)',
  export: 'Export / Browser Download',
};

function Step4({
  connectionId,
  connections,
  backupPointId,
  selection,
  conflictMode,
  destination,
  alternateProjectKey,
  submitError,
  submitting,
}: Step4Props) {
  const conn = connections.find((c) => c.connectionId === connectionId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div>
        <h3 className="rw__body-title">Review and confirm</h3>
        <p className="rw__body-desc">
          Review the restore configuration below. Click <strong>Start restore</strong> to begin.
        </p>
      </div>

      <div className="rw__review" role="region" aria-label="Restore configuration summary">
        <div className="rw__review-row">
          <span className="rw__review-key">Connection</span>
          <span className="rw__review-val">
            {conn ? conn.siteName : connectionId}
          </span>
        </div>
        <div className="rw__review-row">
          <span className="rw__review-key">Backup point</span>
          <span className="rw__review-val">
            {backupPointId ? <code>{backupPointId}</code> : '—'}
          </span>
        </div>
        <div className="rw__review-row">
          <span className="rw__review-key">Objects</span>
          <span className="rw__review-val">
            {selection.size === 0
              ? 'None selected — please go back and select objects.'
              : `${selection.size.toLocaleString()} object${selection.size === 1 ? '' : 's'} selected`}
          </span>
        </div>
        <div className="rw__review-row">
          <span className="rw__review-key">Conflict mode</span>
          <span className="rw__review-val">{CONFLICT_LABELS[conflictMode]}</span>
        </div>
        <div className="rw__review-row">
          <span className="rw__review-key">Destination</span>
          <span className="rw__review-val">
            {DESTINATION_LABELS[destination]}
            {destination === 'alternate' && alternateProjectKey && (
              <span style={{ marginLeft: 6, color: '#42526e' }}>
                → project <code>{alternateProjectKey}</code>
              </span>
            )}
          </span>
        </div>
      </div>

      {submitError && (
        <div className="rw__error" role="alert">
          {submitError}
        </div>
      )}

      {submitting && (
        <div className="rw__info" role="status">
          Starting restore job…
        </div>
      )}
    </div>
  );
}

// ── RestoreWizard ────────────────────────────────────────────────────────────

export function RestoreWizard() {
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Connection data
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionId, setConnectionIdRaw] = useState('');
  const [backupPointId, setBackupPointId] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  // Step 1 — item selection
  const [selectedType, setSelectedType] = useState<ObjectType>('Issue');
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // Step 2 — conflict mode (default: skip)
  const [conflictMode, setConflictMode] = useState<ConflictMode>('skip');

  // Step 3 — destination
  const [destination, setDestination] = useState<RestoreDestinationType>('original');
  const [alternateProjectKey, setAlternateProjectKey] = useState('');

  // Step 4 — submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch connections on mount
  useEffect(() => {
    setConnectionsLoading(true);
    fetch('/api/connections')
      .then((r) => (r.ok ? r.json() : Promise.resolve([])))
      .then((data: ConnectionSummary[]) => {
        setConnections(data);
        if (data.length > 0) setConnectionIdRaw(data[0].connectionId);
      })
      .catch(() => setConnections([]))
      .finally(() => setConnectionsLoading(false));
  }, []);

  // Fetch inventory (backup point) whenever connection changes
  const setConnectionId = useCallback((id: string) => {
    setConnectionIdRaw(id);
    setBackupPointId(null);
    setSelection(new Set());
  }, []);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    setInventoryLoading(true);
    fetch(`/api/inventory?connectionId=${encodeURIComponent(connectionId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((d: InventoryResponse) => {
        if (!cancelled) setBackupPointId(d.backupPointId ?? null);
      })
      .catch(() => { if (!cancelled) setBackupPointId(null); })
      .finally(() => { if (!cancelled) setInventoryLoading(false); });
    return () => { cancelled = true; };
  }, [connectionId]);

  // Navigation guards
  const canProceedStep1 = !connectionsLoading && connectionId !== '' && backupPointId !== null && selection.size > 0;
  const canProceedStep2 = true;
  const canProceedStep3 = destination !== 'alternate' || alternateProjectKey.trim() !== '';

  function handleNext() {
    if (step === 1 && canProceedStep1) setStep(2);
    else if (step === 2 && canProceedStep2) setStep(3);
    else if (step === 3 && canProceedStep3) setStep(4);
  }

  function handleBack() {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  }

  async function handleConfirm() {
    if (submitting || selection.size === 0 || !backupPointId) return;
    setSubmitting(true);
    setSubmitError(null);

    const conn = connections.find((c) => c.connectionId === connectionId);
    const body: Record<string, unknown> = {
      connectionId,
      backupPointId,
      conflictMode,
      destination,
      selection: Array.from(selection),
    };

    if (destination === 'alternate' && conn && alternateProjectKey.trim()) {
      body.alternateDestination = {
        cloudId: conn.cloudId,
        projectKey: alternateProjectKey.trim(),
      };
    }

    try {
      const res = await fetch('/api/restore-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 201) {
        const data = (await res.json()) as { jobId: string };
        navigate(`/restore-jobs/${data.jobId}`);
        return;
      }

      let message = `Request failed (${res.status})`;
      try {
        const err = (await res.json()) as { message?: string; error?: string };
        message = err.message ?? err.error ?? message;
      } catch { /* ignore */ }
      setSubmitError(message);
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const canConfirm = !submitting && selection.size > 0 && backupPointId !== null;

  const nextDisabled =
    (step === 1 && !canProceedStep1) ||
    (step === 3 && !canProceedStep3) ||
    inventoryLoading;

  return (
    <div className="rw" role="dialog" aria-modal="true" aria-label="Restore Wizard">

      {/* Step indicator */}
      <ol className="rw__steps" aria-label="Wizard steps">
        {STEPS.map((s, i) => {
          const num = (i + 1) as 1 | 2 | 3 | 4;
          const isActive = step === num;
          const isDone = step > num;
          return (
            <li
              key={num}
              className={`rw__step${isActive ? ' rw__step--active' : ''}${isDone ? ' rw__step--done' : ''}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="rw__step-num" aria-hidden="true">
                {isDone ? '✓' : num}
              </span>
              <span className="rw__step-label">{s.label}</span>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="rw__body">
        {step === 1 && (
          <Step1
            connectionId={connectionId}
            setConnectionId={setConnectionId}
            backupPointId={backupPointId}
            selectedType={selectedType}
            setSelectedType={setSelectedType}
            selection={selection}
            setSelection={setSelection}
            connections={connections}
            connectionsLoading={connectionsLoading}
          />
        )}
        {step === 2 && (
          <Step2
            conflictMode={conflictMode}
            setConflictMode={setConflictMode}
          />
        )}
        {step === 3 && (
          <Step3
            destination={destination}
            setDestination={setDestination}
            alternateProjectKey={alternateProjectKey}
            setAlternateProjectKey={setAlternateProjectKey}
          />
        )}
        {step === 4 && (
          <Step4
            connectionId={connectionId}
            connections={connections}
            backupPointId={backupPointId}
            selection={selection}
            conflictMode={conflictMode}
            destination={destination}
            alternateProjectKey={alternateProjectKey}
            submitError={submitError}
            submitting={submitting}
          />
        )}
      </div>

      {/* Footer navigation */}
      <div className="rw__footer">
        <div className="rw__footer-left">
          {step > 1 && (
            <button
              type="button"
              className="rw__btn-back"
              onClick={handleBack}
              disabled={submitting}
              aria-label="Go to previous step"
            >
              ← Back
            </button>
          )}
        </div>

        {step < 4 ? (
          <button
            type="button"
            className="rw__btn-next"
            onClick={handleNext}
            disabled={nextDisabled}
            aria-label="Go to next step"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            className="rw__btn-confirm"
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-label="Start restore job"
          >
            {submitting ? 'Starting…' : 'Start restore'}
          </button>
        )}
      </div>
    </div>
  );
}
