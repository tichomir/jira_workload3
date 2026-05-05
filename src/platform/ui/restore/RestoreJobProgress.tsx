import { useEffect, useRef, useState } from 'react';
import './RestoreJobProgress.css';

// ── Phase constants ──────────────────────────────────────────────────────────

const RESTORE_PHASES = [
  'site-reference-data',
  'project',
  'workflow',
  'custom-field',
  'board',
  'sprint',
  'issue',
  'comment-attachment-subtask-issuelink',
] as const;

type RestorePhaseType = typeof RESTORE_PHASES[number];

const PHASE_LABELS: Record<RestorePhaseType, string> = {
  'site-reference-data': 'Site reference data',
  'project': 'Project',
  'workflow': 'Workflow',
  'custom-field': 'Custom field',
  'board': 'Board',
  'sprint': 'Sprint',
  'issue': 'Issue',
  'comment-attachment-subtask-issuelink': 'Comments, attachments, subtasks & issue links',
};

// ── Types ────────────────────────────────────────────────────────────────────

type PhaseState = 'pending' | 'running' | 'completed' | 'failed' | 'blocked';

interface PhaseInfo {
  state: PhaseState;
  restoredCount: number;
  errorCount: number;
  processed: number;
  total: number | null;
  /** Error message from job_failed, present only when state === 'failed'. */
  errorMessage?: string;
  /** Error code from job_failed, present only when state === 'failed'. */
  errorCode?: string;
}

type JobState =
  | 'connecting'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'stalled'
  | 'not_found'
  | 'stream_error';

interface CompletedInfo {
  totalErrors: number;
  totalRestored: number;
}

// ── SSE event shapes (subset of RestoreSseEvent) ─────────────────────────────

interface SsePhaseStarted {
  type: 'phase_started';
  phase: string;
}
interface SsePhaseCompleted {
  type: 'phase_completed';
  phase: string;
  restoredCount: number;
  errorCount: number;
}
interface SsePhaseProgress {
  type: 'phase_progress';
  phase: string;
  processed: number;
  total: number | null;
}
interface SseJobFailed {
  type: 'job_failed';
  error: {
    code: string;
    phase: string;
    message: string;
  };
}
interface SseJobCompleted {
  type: 'job_completed';
  errors: number;
  restoredCount: number;
}

type SseEvent =
  | SsePhaseStarted
  | SsePhaseCompleted
  | SsePhaseProgress
  | SseJobFailed
  | SseJobCompleted;

// ── Helper ───────────────────────────────────────────────────────────────────

const STALLED_THRESHOLD_MS = 20_000;

function initPhases(): Record<RestorePhaseType, PhaseInfo> {
  const result = {} as Record<RestorePhaseType, PhaseInfo>;
  for (const phase of RESTORE_PHASES) {
    result[phase] = { state: 'pending', restoredCount: 0, errorCount: 0, processed: 0, total: null };
  }
  return result;
}

function isKnownPhase(p: string): p is RestorePhaseType {
  return RESTORE_PHASES.includes(p as RestorePhaseType);
}

// ── Component ────────────────────────────────────────────────────────────────

interface RestoreJobProgressProps {
  jobId: string;
}

export function RestoreJobProgress({ jobId }: RestoreJobProgressProps) {
  const [jobState, setJobState] = useState<JobState>('connecting');
  const [phases, setPhases] = useState<Record<RestorePhaseType, PhaseInfo>>(initPhases);
  const [completedInfo, setCompletedInfo] = useState<CompletedInfo | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Track last event time for stalled detection and heartbeat freshness
  const lastEventTimeRef = useRef<number>(Date.now());
  const stalledTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobStateRef = useRef<JobState>('connecting');

  jobStateRef.current = jobState;

  // Tick every second to update "Last heartbeat: Xs ago" display
  useEffect(() => {
    heartbeatTickRef.current = setInterval(() => {
      const elapsed = Date.now() - lastEventTimeRef.current;
      setSecondsAgo(Math.floor(elapsed / 1000));
    }, 1_000);
    return () => {
      if (heartbeatTickRef.current !== null) clearInterval(heartbeatTickRef.current);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/restore-jobs/${encodeURIComponent(jobId)}/events`);

    function resetStalledTimer() {
      lastEventTimeRef.current = Date.now();
      setSecondsAgo(0);
    }

    // Start stalled detection — check every 5s whether >20s have elapsed
    stalledTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - lastEventTimeRef.current;
      if (
        elapsed >= STALLED_THRESHOLD_MS &&
        jobStateRef.current === 'running'
      ) {
        setJobState('stalled');
      }
    }, 5_000);

    es.addEventListener('message', (ev: MessageEvent<string>) => {
      resetStalledTimer();
      setJobState((s) => (s === 'stalled' ? 'running' : s));

      let data: SseEvent;
      try {
        data = JSON.parse(ev.data) as SseEvent;
      } catch {
        return;
      }

      if (data.type === 'phase_started') {
        if (!isKnownPhase(data.phase)) return;
        const phase = data.phase;
        setJobState('running');
        setPhases((prev) => ({
          ...prev,
          [phase]: { ...prev[phase], state: 'running' },
        }));
      } else if (data.type === 'phase_progress') {
        if (!isKnownPhase(data.phase)) return;
        const phase = data.phase;
        setJobState((s) => s === 'stalled' ? 'running' : s);
        setPhases((prev) => ({
          ...prev,
          [phase]: {
            ...prev[phase],
            state: 'running',
            processed: data.processed,
            total: data.total,
          },
        }));
      } else if (data.type === 'phase_completed') {
        if (!isKnownPhase(data.phase)) return;
        const phase = data.phase;
        setPhases((prev) => ({
          ...prev,
          [phase]: {
            ...prev[phase],
            state: 'completed',
            restoredCount: data.restoredCount,
            errorCount: data.errorCount,
          },
        }));
      } else if (data.type === 'job_failed') {
        const failedPhase = data.error.phase;
        if (!isKnownPhase(failedPhase)) return;

        setJobState('failed');
        setPhases((prev) => {
          const next = { ...prev };
          // Mark the failing phase as failed
          next[failedPhase] = {
            ...next[failedPhase],
            state: 'failed',
            errorMessage: data.error.message,
            errorCode: data.error.code,
          };
          // Mark all downstream phases as blocked
          let seenFailed = false;
          for (const p of RESTORE_PHASES) {
            if (p === failedPhase) { seenFailed = true; continue; }
            if (seenFailed && next[p].state === 'pending') {
              next[p] = { ...next[p], state: 'blocked' };
            }
          }
          return next;
        });
      } else if (data.type === 'job_completed') {
        const withErrors = data.errors > 0;
        setJobState(withErrors ? 'completed_with_errors' : 'completed');
        setCompletedInfo({ totalErrors: data.errors, totalRestored: data.restoredCount });
      }
    });

    es.addEventListener('error', () => {
      // EventSource reconnects on transient errors. Only surface stream_error
      // if the job is still in connecting/running/stalled state.
      if (
        jobStateRef.current === 'connecting' ||
        jobStateRef.current === 'running' ||
        jobStateRef.current === 'stalled'
      ) {
        // Check if HTTP 404 (EventSource sets readyState to CLOSED on 4xx)
        if (es.readyState === EventSource.CLOSED) {
          setJobState((s) =>
            s === 'connecting' ? 'not_found' : 'stream_error'
          );
        }
      }
    });

    return () => {
      es.close();
      if (stalledTimerRef.current !== null) {
        clearInterval(stalledTimerRef.current);
        stalledTimerRef.current = null;
      }
    };
  }, [jobId]);

  const isTerminal =
    jobState === 'completed' ||
    jobState === 'completed_with_errors' ||
    jobState === 'failed' ||
    jobState === 'not_found' ||
    jobState === 'stream_error';

  return (
    <div className="rjp" role="region" aria-label="Restore job progress">
      <div className="rjp__header">
        <h2 className="rjp__title">Restore Job</h2>
        <p className="rjp__job-id">
          Job ID: <code>{jobId}</code>
        </p>
      </div>

      <StatusBanner jobState={jobState} completedInfo={completedInfo} />

      {!isTerminal && (
        <div className="rjp__heartbeat" aria-live="polite" data-testid="heartbeat-indicator">
          {jobState === 'connecting'
            ? 'Connecting to job stream…'
            : `Last heartbeat: ${secondsAgo}s ago`}
        </div>
      )}

      <ol className="rjp__phases" aria-label="Restore phases">
        {RESTORE_PHASES.map((phase) => (
          <PhaseRow key={phase} phase={phase} info={phases[phase]} />
        ))}
      </ol>

      <div className="rjp__footer">
        <a className="rjp__btn-back" href="/restore">
          ← Start another restore
        </a>
      </div>
    </div>
  );
}

// ── StatusBanner ─────────────────────────────────────────────────────────────

interface StatusBannerProps {
  jobState: JobState;
  completedInfo: CompletedInfo | null;
}

function StatusBanner({ jobState, completedInfo }: StatusBannerProps) {
  const configs: Record<JobState, { icon: string; text: string }> = {
    connecting: { icon: '○', text: 'Connecting to restore job…' },
    running: { icon: '●', text: 'Restore in progress…' },
    completed: {
      icon: '✓',
      text: completedInfo
        ? `Completed successfully — ${completedInfo.totalRestored.toLocaleString()} item${completedInfo.totalRestored === 1 ? '' : 's'} restored.`
        : 'Completed successfully.',
    },
    completed_with_errors: {
      icon: '⚠',
      text: completedInfo
        ? `Completed with ${completedInfo.totalErrors.toLocaleString()} error${completedInfo.totalErrors === 1 ? '' : 's'} — ${completedInfo.totalRestored.toLocaleString()} item${completedInfo.totalRestored === 1 ? '' : 's'} restored.`
        : 'Completed with errors.',
    },
    failed: {
      icon: '✕',
      text: 'Restore failed. A phase error halted execution — see the highlighted phase below.',
    },
    stalled: {
      icon: '⚠',
      text: 'No progress received for over 20 seconds. The restore job may be stalled.',
    },
    not_found: { icon: '✕', text: 'Restore job not found.' },
    stream_error: { icon: '✕', text: 'Lost connection to restore job event stream.' },
  };

  const { icon, text } = configs[jobState];

  return (
    <div
      className={`rjp__status-banner rjp__status-banner--${jobState}`}
      role={jobState === 'failed' || jobState === 'stream_error' || jobState === 'not_found' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="rjp__status-icon" aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

// ── PhaseRow ─────────────────────────────────────────────────────────────────

interface PhaseRowProps {
  phase: RestorePhaseType;
  info: PhaseInfo;
}

function PhaseRow({ phase, info }: PhaseRowProps) {
  const { state, restoredCount, errorCount, processed, total, errorMessage, errorCode } = info;

  const iconContent: Record<PhaseState, React.ReactNode> = {
    pending: '·',
    running: <span className="rjp__spinner" aria-label="Running" />,
    completed: '✓',
    failed: '✕',
    blocked: '·',
  };

  const progressPercent = state === 'running' && total !== null && total > 0
    ? Math.round((processed / total) * 100)
    : null;

  let meta: React.ReactNode = null;
  if (state === 'running' && total !== null) {
    meta = `${processed.toLocaleString()} / ${total.toLocaleString()}`;
  } else if (state === 'completed') {
    const parts: string[] = [];
    if (restoredCount > 0) parts.push(`${restoredCount.toLocaleString()} restored`);
    if (errorCount > 0) parts.push(`${errorCount.toLocaleString()} error${errorCount === 1 ? '' : 's'}`);
    if (parts.length > 0) meta = parts.join(' · ');
  } else if (state === 'blocked') {
    meta = 'Blocked — a prior phase failed';
  }

  return (
    <li
      className={`rjp__phase rjp__phase--${state}`}
      aria-label={`${PHASE_LABELS[phase]}: ${state}`}
    >
      <span className={`rjp__phase-icon rjp__phase-icon--${state}`} aria-hidden="true">
        {iconContent[state]}
      </span>

      <div className="rjp__phase-content">
        <span className="rjp__phase-label">{PHASE_LABELS[phase]}</span>

        {meta && (
          <span className="rjp__phase-meta">{meta}</span>
        )}

        {state === 'failed' && errorMessage && (
          <span className="rjp__phase-error" role="alert">
            <code>{errorCode ?? 'dependency_phase_failed'}</code> — {errorMessage}
          </span>
        )}

        {progressPercent !== null && (
          <div className="rjp__progress-bar-wrap" aria-hidden="true">
            <div
              className="rjp__progress-bar"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>
    </li>
  );
}
