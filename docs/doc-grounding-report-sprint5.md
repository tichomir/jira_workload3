# Doc Grounding Report — Sprint 5

_Generated: 2026-05-04 | Author: devops-engineer-persona_
_Scope: INSTALL.md, DEMO.md, docs/doc-grounding-report-sprint3.md, docs/doc-grounding-report-sprint4.md_
_Sprint focus: Carry-forward P0 resolution — .env.example, Caddyfile, process.env refs, src/oauth/* line refs_

---

## Summary

| Item | Status | Action |
|---|---|---|
| `.env.example` at repo root with all documented keys | ✅ Exists | No change required |
| `Caddyfile` at repo root with HTTPS dev config | ✅ Exists | `INSTALL.md` updated to reference repo Caddyfile |
| `src/oauth/tokenExchange.ts:110` line ref in sprint3 report | ✅ Correct | Line 110 = `process.env['OAUTH_REDIRECT_URI'] ??` |
| `src/oauth/authorize.ts:71` line ref in sprint3 report | ✅ Correct | Line 71 = `process.env['OAUTH_REDIRECT_URI'] ??` |
| `src/oauth/tokenExchange.ts:72` line ref in sprint3 report | ✅ Correct | Line 72 = `export async function handleCallback(` |
| `src/oauth/authorize.ts:42` line ref in sprint3 report | ✅ Correct | Line 42 = `export function buildAuthorizeUrl(` |
| `src/oauth/authorize.ts:62` line ref in sprint3 report | ✅ Correct | Line 62 = `export function handleAuthorize(` |
| `.sql` file refs in sprint4 report | ✅ Correct | All files exist under `src/db/migrations/` |
| **P0 carry-forward items remaining** | **0** | — |

---

## Detailed Verification

### .env.example

File exists at repo root. Contains all four keys referenced in INSTALL.md and DEMO.md:

| Key | INSTALL.md | DEMO.md | .env.example |
|---|---|---|---|
| `ATLASSIAN_CLIENT_ID` | ✅ | ✅ | ✅ |
| `ATLASSIAN_CLIENT_SECRET` | ✅ | ✅ | ✅ |
| `OAUTH_REDIRECT_URI` | ✅ | ✅ | ✅ |
| `PORT` | ✅ | ✅ | ✅ |

No missing keys. No stale keys.

---

### Caddyfile

File exists at repo root:

```
localhost {
    reverse_proxy /api/* localhost:3000
    reverse_proxy /* localhost:5173
}
```

**In-sprint fix:** `INSTALL.md` previously told users to "Create a `Caddyfile` in a directory of your choice" — updated to "A `Caddyfile` is included in the project root" with instructions to run `caddy run` from the project root.

---

### src/oauth/tokenExchange.ts line references

Checked against actual file content:

| Report ref | Line | Actual content | Status |
|---|---|---|---|
| `src/oauth/tokenExchange.ts:110` (sprint3 In-Sprint Fixes) | 110 | `process.env['OAUTH_REDIRECT_URI'] ??` | ✅ Correct |
| `src/oauth/tokenExchange.ts:72` (sprint3 CHANGELOG table) | 72 | `export async function handleCallback(req: Request, res: Response): Promise<void> {` | ✅ Correct |
| `src/oauth/tokenExchange.ts:6` (sprint3 DEMO table) | 6 | `const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';` | ✅ Correct |

---

### src/oauth/authorize.ts line references

| Report ref | Line | Actual content | Status |
|---|---|---|---|
| `src/oauth/authorize.ts:71` (sprint3 In-Sprint Fixes) | 71 | `process.env['OAUTH_REDIRECT_URI'] ??` | ✅ Correct |
| `src/oauth/authorize.ts:42` (sprint3 CHANGELOG table) | 42 | `export function buildAuthorizeUrl(` | ✅ Correct |
| `src/oauth/authorize.ts:62` (sprint3 CHANGELOG table) | 62 | `export function handleAuthorize(req: Request, res: Response): void {` | ✅ Correct |
| `src/oauth/authorize.ts:63` (sprint3 INSTALL table) | 63 | `const clientId = process.env['ATLASSIAN_CLIENT_ID'];` | ✅ Correct |
| `src/oauth/authorize.ts:20` (sprint3 DEMO table) | 20 | `const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';` | ✅ Correct |

---

### .sql file references

All migration files referenced in the sprint4 CHANGELOG table verified to exist:

| Reference | File | Status |
|---|---|---|
| `007_restores.sql` | `src/db/migrations/007_restores.sql` | ✅ Exists |
| `008_policies.sql` | `src/db/migrations/008_policies.sql` | ✅ Exists |
| `src/db/migrations/002_connections.sql` | `src/db/migrations/002_connections.sql` | ✅ Exists |
| `src/db/migrations/003_oauth_state.sql` | `src/db/migrations/003_oauth_state.sql` | ✅ Exists |
| `src/db/migrations/004_client_creds.sql` | `src/db/migrations/004_client_creds.sql` | ✅ Exists |
| `src/db/migrations/005_oauth_state_connectionid.sql` | `src/db/migrations/005_oauth_state_connectionid.sql` | ✅ Exists |
| `src/db/migrations/006_probe_results.sql` | `src/db/migrations/006_probe_results.sql` | ✅ Exists |

No stale `.js` references found in any doc-grounding report.

---

## In-Sprint Fixes

| Doc | Section | Reference | Problem | Fix applied |
|---|---|---|---|---|
| `INSTALL.md` | HTTPS callback requirement | `Caddyfile` | Instructions said "Create a `Caddyfile` in a directory of your choice" — a `Caddyfile` already exists at repo root | Updated to "A `Caddyfile` is included in the project root" and changed `caddy run` directory from "that directory" to "the project root" |

---

_0 unresolved P0 carry-forward items after in-sprint fix._
