import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env from project root when present (local dev path).
// Containers and CI already have vars injected via env_file / secrets; this is a no-op for them.
// Only sets vars that are NOT already in the environment so runtime overrides are never clobbered.
function loadEnvFile(): void {
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env absent — rely on vars already present (container, CI)
  }
}

loadEnvFile();

// All getters read from process.env at call time so tests can manipulate process.env
// in beforeEach/afterEach without stale cached values.
export const config = {
  // Atlassian OAuth 2.0 (3LO) Client ID — from https://developer.atlassian.com/console/myapps/
  get atlassianClientId(): string {
    return process.env['ATLASSIAN_CLIENT_ID'] ?? '';
  },

  // Atlassian OAuth 2.0 (3LO) Client Secret — from https://developer.atlassian.com/console/myapps/
  get atlassianClientSecret(): string {
    return process.env['ATLASSIAN_CLIENT_SECRET'] ?? '';
  },

  // Redirect URI registered in the Atlassian developer console (must match exactly)
  get oauthRedirectUri(): string {
    return process.env['OAUTH_REDIRECT_URI'] ?? '';
  },

  // Express server port (default: 4000)
  get port(): number {
    return parseInt(process.env['PORT'] ?? '4000', 10);
  },

  // SQLite database file path (default: data/jira_workload.db relative to project root)
  get dbPath(): string {
    return process.env['DB_PATH'] ?? '';
  },

  // Attachment binary storage directory (default: data/attachments relative to project root)
  get attachmentDir(): string {
    return process.env['DCC_ATTACHMENT_DIR'] ?? '';
  },
};
