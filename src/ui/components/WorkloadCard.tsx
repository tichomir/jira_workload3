import { useState } from 'react';
import './WorkloadCard.css';

interface FormState {
  clientId: string;
  clientSecret: string;
  showSecret: boolean;
  loading: boolean;
  error: string | null;
}

interface Toast {
  message: string;
  type: 'error' | 'success';
}

export function WorkloadCard() {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>({
    clientId: '',
    clientSecret: '',
    showSecret: false,
    loading: false,
    error: null,
  });
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (message: string, type: Toast['type']) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const handleAuthorize = () => {
    window.location.href = '/api/oauth/authorize';
  };

  const openModal = () => {
    setForm({ clientId: '', clientSecret: '', showSecret: false, loading: false, error: null });
    setShowModal(true);
  };

  const closeModal = () => setShowModal(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForm(f => ({ ...f, loading: true, error: null }));

    try {
      const res = await fetch('/api/connections/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: form.clientId, clientSecret: form.clientSecret }),
      });

      if (res.status >= 400) {
        const data: { message?: string; error?: string } = await res.json().catch(() => ({}));
        const msg = data.message ?? data.error ?? `Request failed (${res.status})`;
        setForm(f => ({ ...f, loading: false, error: msg }));
        showToast(msg, 'error');
        return;
      }

      closeModal();
      showToast('Connection created successfully.', 'success');
    } catch {
      const msg = 'Network error. Please try again.';
      setForm(f => ({ ...f, loading: false, error: msg }));
      showToast(msg, 'error');
    }
  };

  return (
    <>
      <div className="wc">
        <div className="wc__header">
          <JiraIcon />
          <div>
            <h2 className="wc__title">Jira Cloud Backup</h2>
            <span className="wc__badge">Phase 1</span>
          </div>
        </div>

        <p className="wc__value-prop">
          Protect your Jira Cloud data with automated daily backups and granular
          point-in-time restore for Issues, Projects, Boards, and Sprints — without
          waiting on Atlassian support.
        </p>

        <div className="wc__requirements">
          <h3 className="wc__requirements-title">Before you connect</h3>
          <ul className="wc__requirements-list">
            <li>Site Admin or Atlassian Org Admin role required</li>
            <li>OAuth 2.0 app registered in the Atlassian Developer Console with Phase 1 scopes</li>
          </ul>
        </div>

        <div className="wc__actions">
          <button className="wc__authorize-btn" onClick={handleAuthorize}>
            Authorize with Atlassian
          </button>
          <button className="wc__manual-link" onClick={openModal}>
            Use manual connection
          </button>
        </div>
      </div>

      {showModal && (
        <div
          className="modal-backdrop"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-modal-title"
          >
            <div className="modal__header">
              <h2 id="manual-modal-title" className="modal__title">
                Manual Connection
              </h2>
              <button className="modal__close" onClick={closeModal} aria-label="Close dialog">
                ×
              </button>
            </div>

            <p className="modal__description">
              Enter your Atlassian OAuth 2.0 app credentials. The Client Secret is
              stored encrypted and never displayed after saving.
            </p>

            <form onSubmit={handleSubmit} className="modal__form" noValidate>
              <div className="field">
                <label className="field__label" htmlFor="clientId">
                  Client ID
                </label>
                <input
                  id="clientId"
                  className="field__input"
                  type="text"
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  required
                  autoComplete="off"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  disabled={form.loading}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="clientSecret">
                  Client Secret
                </label>
                <div className="field__secret-row">
                  <input
                    id="clientSecret"
                    className="field__input field__input--secret"
                    type={form.showSecret ? 'text' : 'password'}
                    value={form.clientSecret}
                    onChange={e => setForm(f => ({ ...f, clientSecret: e.target.value }))}
                    required
                    autoComplete="new-password"
                    placeholder="Enter client secret"
                    disabled={form.loading}
                  />
                  <button
                    type="button"
                    className="field__toggle"
                    onClick={() => setForm(f => ({ ...f, showSecret: !f.showSecret }))}
                    aria-label={form.showSecret ? 'Hide client secret' : 'Show client secret'}
                    aria-pressed={form.showSecret}
                  >
                    {form.showSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {form.error && (
                <p className="field__error" role="alert">
                  {form.error}
                </p>
              )}

              <div className="modal__footer">
                <button
                  type="button"
                  className="modal__cancel-btn"
                  onClick={closeModal}
                  disabled={form.loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="modal__submit-btn"
                  disabled={form.loading}
                >
                  {form.loading ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast--${toast.type}`} role="alert" aria-live="assertive">
          {toast.message}
        </div>
      )}
    </>
  );
}

function JiraIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="36" height="36" rx="8" fill="#0052CC" />
      <path
        d="M18.867 9l-8.534 8.534a1.222 1.222 0 000 1.728l8.534 8.534a1.222 1.222 0 001.728 0l8.534-8.534a1.222 1.222 0 000-1.728L20.595 9a1.222 1.222 0 00-1.728 0z"
        fill="url(#jira-grad)"
      />
      <path
        d="M18.73 10.48L11.5 17.71a.612.612 0 000 .866l7.23 7.23 7.23-7.23a.612.612 0 000-.866L18.73 10.48z"
        fill="#fff"
        opacity="0.15"
      />
      <defs>
        <linearGradient id="jira-grad" x1="18" y1="9" x2="18" y2="27.796" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2684FF" />
          <stop offset="1" stopColor="#0052CC" />
        </linearGradient>
      </defs>
    </svg>
  );
}
