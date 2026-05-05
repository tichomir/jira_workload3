import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import './ConnectionsList.css';

interface ProbeResult {
  endpoint: string;
  status: number;
  duration_ms: number;
  remediationNeeded: boolean;
  checkedAt: string;
}

interface ConnectionRow {
  connectionId: string;
  cloudId: string;
  siteName: string;
  accountId?: string;
  status: 'connected' | 'probe-failed';
  probes: ProbeResult[];
}

interface OAuthCallbackError {
  error: string;
  description: string;
  correlationId: string;
  atlassianError?: string;
}

const ENDPOINT_SCOPE_MAP: Record<string, string> = {
  '/rest/api/3/myself': 'read:me',
  '/rest/api/3/field': 'read:field:jira',
  '/rest/agile/1.0/board': 'read:board-scope:jira-software',
  '/rest/api/3/workflow/search': 'read:workflow:jira',
};

function truncateCloudId(cloudId: string): string {
  if (cloudId.length <= 13) return cloudId;
  return `${cloudId.slice(0, 8)}…${cloudId.slice(-4)}`;
}

export function ConnectionsList() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Capture OAuth callback error from URL on initial render
  const [oauthCallbackError] = useState<OAuthCallbackError | null>(() => {
    const errCode = searchParams.get('error');
    if (!errCode) return null;
    return {
      error: errCode,
      description: searchParams.get('description') ?? 'Authorization failed',
      correlationId: searchParams.get('correlationId') ?? '',
      atlassianError: searchParams.get('atlassian_error') ?? undefined,
    };
  });

  // Clean OAuth error params from URL after capturing them
  useEffect(() => {
    if (oauthCallbackError) {
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch('/api/connections')
      .then((r) => {
        if (!r.ok) throw new Error(`Fetch failed (${r.status})`);
        return r.json() as Promise<ConnectionRow[]>;
      })
      .then(setConnections)
      .catch((e: unknown) => setFetchError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (cloudId: string) => {
    navigator.clipboard.writeText(cloudId).then(() => {
      setCopied(cloudId);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const handleReauth = (connectionId: string) => {
    window.location.href = `/api/oauth/authorize?reauth=${connectionId}`;
  };

  const handleRetryAuth = () => {
    window.location.href = '/api/oauth/authorize';
  };

  return (
    <section className="cl" aria-label="Connected Jira sites">
      {oauthCallbackError && (
        <div className="cl__oauth-error" role="alert">
          <div className="cl__oauth-error-body">
            <p className="cl__oauth-error-title">Authorization failed</p>
            <p className="cl__oauth-error-detail">
              <code className="cl__oauth-error-code">{oauthCallbackError.error}</code>
              {' — '}
              {oauthCallbackError.description}
            </p>
            {oauthCallbackError.correlationId && (
              <p className="cl__oauth-error-correlation">
                Correlation ID: <code>{oauthCallbackError.correlationId}</code>
              </p>
            )}
          </div>
          <button className="cl__oauth-error-retry" onClick={handleRetryAuth}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="cl__loading">Loading connections…</div>
      ) : fetchError ? (
        <div className="cl__error" role="alert">
          Failed to load connections: {fetchError}
        </div>
      ) : connections.length === 0 && !oauthCallbackError ? (
        <div className="cl__empty">
          No connections yet. Use the form above to connect a Jira Cloud site.
        </div>
      ) : connections.length > 0 ? (
        <>
          <h2 className="cl__heading">Connected Sites</h2>
          <ul className="cl__list" role="list">
            {connections.map((conn) => {
              const failingProbes = conn.probes.filter((p) => p.remediationNeeded);
              const hasRemediation = failingProbes.length > 0;

              return (
                <li
                  key={conn.connectionId}
                  className={`cl__row${hasRemediation ? ' cl__row--warn' : ''}`}
                >
                  <div className="cl__row-main">
                    <div className="cl__site-info">
                      <span className="cl__site-name">{conn.siteName}</span>
                      {conn.accountId && (
                        <span className="cl__account-id">
                          Account: <code className="cl__account-id-text">{conn.accountId}</code>
                        </span>
                      )}
                      <span className="cl__cloud-id">
                        <span className="cl__cloud-id-text" title={conn.cloudId}>
                          {truncateCloudId(conn.cloudId)}
                        </span>
                        <button
                          className="cl__copy-btn"
                          onClick={() => handleCopy(conn.cloudId)}
                          aria-label={`Copy cloud ID for ${conn.siteName}`}
                          title={conn.cloudId}
                        >
                          {copied === conn.cloudId ? '✓' : 'Copy'}
                        </button>
                      </span>
                    </div>

                    <div className="cl__row-actions">
                      <span
                        className={`cl__status-badge cl__status-badge--${conn.status}`}
                        aria-label={`Status: ${conn.status === 'connected' ? 'Connected' : 'Probe failed'}`}
                      >
                        {conn.status === 'connected' ? 'Connected' : 'Probe Failed'}
                      </span>
                      <button
                        className="cl__reauth-btn"
                        onClick={() => handleReauth(conn.connectionId)}
                        aria-label={`Reauthorize ${conn.siteName}`}
                      >
                        Reauth
                      </button>
                    </div>
                  </div>

                  {hasRemediation && (
                    <div className="cl__remediation" role="alert">
                      <p className="cl__remediation-message">
                        Permission check failed for{' '}
                        {failingProbes.map((p, i) => (
                          <span key={p.endpoint}>
                            {i > 0 && ', '}
                            <code className="cl__scope-code">
                              {ENDPOINT_SCOPE_MAP[p.endpoint] ?? p.endpoint}
                            </code>
                          </span>
                        ))}
                        . Grant the missing scope and reconnect.
                      </p>
                      <button
                        className="cl__remediation-cta"
                        onClick={() => handleReauth(conn.connectionId)}
                      >
                        Reauthorize with required scopes
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
