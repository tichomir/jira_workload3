# Doc Grounding Report — Sprint 9 (Sprint 3 Phase 2, DevOps carry-forward P0 task)

_Generated: 2026-05-04 | Author: devops-engineer-persona_
_Scope: README.md, INSTALL.md, DEMO.md, ARCHITECTURE.md, docs/doc-grounding-report-sprint6.md, docs/doc-grounding-report-sprint8.md_
_Sprint focus: Carry-forward P0 resolution — README Phase 2 sections, ARCHITECTURE.md [search] log format, JiraHttpClient line refs, process.env, .env.example coverage_

---

## Summary

| Item | Status | Action |
|---|---|---|
| README.md Phase 2 backup engine sections (P0-S8-01) | ✅ Fixed | Added Phase 2 Sprint 1 and Sprint 2 sections to README |
| ARCHITECTURE.md `[search]` log format (P0-S8-02) | ✅ Fixed | Updated verbatim format and example to match `JiraHttpClient.enumerateIssues()` |
| `.env.example` at repo root with all documented keys | ✅ Exists — no change needed | All four keys present |
| `JiraHttpClient.ts` line refs in sprint6 report | ✅ Verified accurate | All 7 line refs resolve |
| `JiraHttpClient.ts` line refs in sprint8 report | ✅ Verified accurate | All line refs resolve |
| `process.env` line refs in sprint3/sprint5 reports | ✅ Verified accurate | All refs resolve |
| INSTALL.md — no broken path refs | ✅ Verified | All paths exist on disk |
| DEMO.md — no broken path refs | ✅ Verified | All paths exist on disk |
| **P0 carry-forward items remaining** | **0** | — |

---

## Detailed Verification

### P0-S8-01 — README.md Phase 2 sections

**Defect (from doc-grounding-report-sprint8.md):** "What is built (Sprints 2–3)" section documented only Platform Stub and OAuth 3LO Foundation. Phase 2 Sprint 1 (Project Discovery, JSM Detection, `JiraWorkload.discover()`) and Phase 2 Sprint 2 (Custom Field Context, Issue Enumeration, `CaptureOrchestrator`, `JiraWorkload.snapshot()`) were not represented.

**Fix applied:** README.md "What is built" section rewritten as "What is built" with four headings:
- **Phase 2 Sprint 2 — Issue Enumeration, Custom Field Context & Capture Order** — documents `discoverFieldContexts`, `assembleIssuePayload`, `CaptureOrchestrator`, `JiraWorkload.snapshot()`, `check:http-guard`
- **Phase 2 Sprint 1 — Backup Engine Foundations** — documents `discoverProjects`, JSM detection, `JiraWorkload.discover()`, backup engine HTTP client
- **Phase 1 Sprint 3 — OAuth 3LO Foundation** — unchanged
- **Phase 1 Sprint 2 — Platform Stub Endpoints** — unchanged

**Post-fix reference verification:**

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `discoverFieldContexts` | Function | Yes | `src/workload/backup/discoverFieldContexts.ts:43` |
| `GET /rest/api/3/field/{id}/context` | API path | Yes | `src/workload/backup/discoverFieldContexts.ts:60` |
| `CaptureOrchestrator` | Class | Yes | `src/workload/snapshot/CaptureOrchestrator.ts:25` |
| `JiraWorkload.snapshot()` | Method | Yes | `src/workload/JiraWorkload.ts:120` |
| `scripts/check-http-guard.sh` | File | Yes | `scripts/check-http-guard.sh` |
| `POST /rest/api/3/search/jql` | API path | Yes | `src/workload/http/JiraHttpClient.ts:71` |
| `discoverProjects` | Function | Yes | `src/workload/backup/discoverProjects.ts:79` |
| `JiraWorkload.discover()` | Method | Yes | `src/workload/JiraWorkload.ts:53` |
| `src/workload/http/JiraHttpClient.ts` | File | Yes | backup engine HTTP client |
| `JiraHttpClient` (OAuth) | Class | Yes | `src/http/JiraHttpClient.ts` |
| `POST /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `GET /api/connections` | Route | Yes | `src/routes/connections.ts` |
| `WorkloadCard` | Component | Yes | `src/ui/components/WorkloadCard.tsx` |
| `ConnectionsList` | Component | Yes | `src/ui/pages/ConnectionsList.tsx` |
| `GET /api/inventory` | Route | Yes | `src/routes/inventory.ts` |
| `POST /api/policies` | Route | Yes | `src/routes/policies.ts` |
| `POST /api/restores` | Route | Yes | `src/routes/restores.ts` |
| `Caddyfile` | File | Yes | project root |

---

### P0-S8-02 — ARCHITECTURE.md `[search]` log format

**Defect (from doc-grounding-report-sprint8.md):** Structured-Log Line Shapes section documented verbatim format:
```
[search] project=<projectKey> jql="<jql>" startAt=<startAt> maxResults=<maxResults> returned=<returned> total=<total>
```
The actual `console.log` call at `src/workload/http/JiraHttpClient.ts:107-109` emits:
```typescript
console.log(
  `[search] endpoint=search/jql project=${projectKey} page=${page} count=${issues.length}`
);
```

**Fix applied:** `ARCHITECTURE.md` Structured-Log Line Shapes → `[search]` lines subsection updated:
- Verbatim format line updated to: `[search] endpoint=search/jql project=<projectKey> page=<page> count=<count>`
- Example updated to three-page run using the abbreviated format
- Termination note updated: `count(43) < maxResults(100)` instead of `returned(43) < maxResults(100)`
- Source annotation added: `(source: src/workload/http/JiraHttpClient.ts:107-109)`

**Post-fix verification:** Format in ARCHITECTURE.md now matches DEMO.md and the runtime implementation identically.

---

### .env.example — coverage verification

File exists at repo root. All keys referenced in INSTALL.md and DEMO.md are present:

| Key | INSTALL.md | DEMO.md | .env.example | Source code |
|---|---|---|---|---|
| `ATLASSIAN_CLIENT_ID` | ✅ | ✅ | ✅ | `src/oauth/authorize.ts:63` |
| `ATLASSIAN_CLIENT_SECRET` | ✅ | ✅ | ✅ | stored via manual-connection path |
| `OAUTH_REDIRECT_URI` | ✅ | ✅ | ✅ | `src/oauth/authorize.ts:71`, `src/oauth/tokenExchange.ts:110` |
| `PORT` | ✅ | ✅ | ✅ | `src/server.ts:11` |

INSTALL.md already contains the `cp .env.example .env` step (§2 Configure environment). No `.env` path references without a corresponding `.env.example` instruction.

No stale keys (`ATLASSIAN_REDIRECT_URI`, `DCC_DB_PATH`, `DCC_ATTACHMENT_DIR`) appear anywhere in INSTALL.md or DEMO.md — those keys are not referenced and `.env.example` correctly omits them.

---

### JiraHttpClient.ts line references — sprint6 report verification

All line references in `docs/doc-grounding-report-sprint6.md` verified against `src/workload/http/JiraHttpClient.ts`:

| Report ref | Line content | Status |
|---|---|---|
| `:10` — `const ATLASSIAN_TOKEN_URL = ...` | `const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';` | ✅ Correct |
| `:34` — `JiraHttpClient.forConnection` | `static forConnection(connectionId: string): JiraHttpClient {` | ✅ Correct |
| `:44` — `_createForTesting` | `static _createForTesting(connectionId: string, fetchFn: FetchFn): JiraHttpClient {` | ✅ Correct |
| `:50` — `_clearInstances` | `static _clearInstances(): void {` | ✅ Correct |
| `:71` — `POST /rest/api/3/search/jql` | `const url = \`${cloudBaseUrl}/rest/api/3/search/jql\`;` | ✅ Correct |
| `:83` — `enumerateIssues` | `async enumerateIssues(` | ✅ Correct |
| `:224-234` — `[auth-refresh]` log lines | `console.log(\`[auth-refresh]...\`)` (mutex=acquire at 224; mutex=release at 234) | ✅ Correct |

---

### JiraHttpClient.ts line references — sprint8 report verification

All line references in `docs/doc-grounding-report-sprint8.md` verified against `src/workload/http/JiraHttpClient.ts`:

| Report ref | Line content | Status |
|---|---|---|
| `:71` — `POST /rest/api/3/search/jql` | `const url = \`${cloudBaseUrl}/rest/api/3/search/jql\`;` | ✅ Correct |
| `:83` — `enumerateIssues` | `async enumerateIssues(` | ✅ Correct |
| `:93` — `nextPageToken` declaration | `let nextPageToken: string | undefined;` | ✅ Correct |
| `:107-109` — `[search]` log format | `console.log(\`[search] endpoint=search/jql project=...\`)` | ✅ Correct |
| `:117` — `nextPageToken` assignment | `nextPageToken = response.nextPageToken;` | ✅ Correct |

---

### process.env line references — sprint3/sprint5 report verification

All `process.env` line references verified against current source:

| Report ref | File | Line | Actual content | Status |
|---|---|---|---|---|
| sprint3 INSTALL table: `authorize.ts:63` | `src/oauth/authorize.ts` | 63 | `const clientId = process.env['ATLASSIAN_CLIENT_ID'];` | ✅ Correct |
| sprint3 INSTALL table: `authorize.ts:71` | `src/oauth/authorize.ts` | 71 | `process.env['OAUTH_REDIRECT_URI'] ??` | ✅ Correct |
| sprint3 DEMO table: `authorize.ts:20` | `src/oauth/authorize.ts` | 20 | `const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';` | ✅ Correct |
| sprint3 CHANGELOG table: `authorize.ts:42` | `src/oauth/authorize.ts` | 42 | `export function buildAuthorizeUrl(` | ✅ Correct |
| sprint3 CHANGELOG table: `authorize.ts:62` | `src/oauth/authorize.ts` | 62 | `export function handleAuthorize(` | ✅ Correct |
| sprint3 DEMO table: `tokenExchange.ts:6` | `src/oauth/tokenExchange.ts` | 6 | `const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';` | ✅ Correct |
| sprint3 CHANGELOG table: `tokenExchange.ts:72` | `src/oauth/tokenExchange.ts` | 72 | `export async function handleCallback(` | ✅ Correct |
| sprint3 In-Sprint Fixes: `tokenExchange.ts:110` | `src/oauth/tokenExchange.ts` | 110 | `process.env['OAUTH_REDIRECT_URI'] ??` | ✅ Correct |
| sprint3 INSTALL: `server.ts:11` | `src/server.ts` | 11 | `const PORT = parseInt(process.env['PORT'] ?? '3000', 10);` | ✅ Correct |

All historical line references remain accurate — no annotation or update required.

---

### INSTALL.md — path existence verification

All file/path references in INSTALL.md verified against current disk state:

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `.env.example` | File | Yes | project root |
| `src/db/database.ts` | File | Yes | exports `getDb`, `_setDbForTesting`, `_resetDb` |
| `npm run server` | Script | Yes | `package.json` → `tsx src/server.ts` |
| `npm run dev` | Script | Yes | `package.json` → `vite` |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts:63` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts:71` |
| `PORT` | Env var | Yes | `.env.example`, `src/server.ts:11` |
| `Caddyfile` | File | Yes | project root |

No broken references. INSTALL.md references `.env.example` (which exists) and documents the `cp .env.example .env` step. No reference to `.env` as a file that must already exist.

---

### DEMO.md — path existence verification

All file/path references in DEMO.md verified against current disk state (abbreviated — full verification performed in sprint6 and sprint8 reports):

| Reference | Kind | Exists | Notes |
|---|---|---|---|
| `INSTALL.md` | File (link) | Yes | project root |
| `ATLASSIAN_CLIENT_ID` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `ATLASSIAN_CLIENT_SECRET` | Env var | Yes | `.env.example` |
| `OAUTH_REDIRECT_URI` | Env var | Yes | `.env.example`, `src/oauth/authorize.ts` |
| `POST /api/discover` | Route | Yes | `src/routes/discover.ts`, mounted in `src/server.ts` |
| `backup_manifests` table | DB table | Yes | `src/db/migrations/009_backup_manifests.sql` |
| `data/jira_workload.db` | File path | Yes | `data/` directory present at repo root |
| `npx tsx scripts/smoke-discover.ts` | Command | Yes | `scripts/smoke-discover.ts` |
| `npx vitest run src/workload/backup/discoverFieldContexts.test.ts` | Command/file | Yes | file exists |
| `npx vitest run src/workload/snapshot/assembleIssuePayload.test.ts` | Command/file | Yes | file exists |
| `npx vitest run src/workload/snapshot/CaptureOrchestrator.test.ts` | Command/file | Yes | file exists |

No broken references.

---

## In-Sprint Fixes

| File | Change | Reason |
|---|---|---|
| `README.md` | Replaced "What is built (Sprints 2–3)" section with four phase-labeled headings covering Phase 2 Sprint 1 and Sprint 2 deliverables as well as Phase 1 Sprints 2 and 3 | P0-S8-01: README missing Phase 2 backup engine deliverables |
| `ARCHITECTURE.md` | Updated Structured-Log Line Shapes → `[search]` lines verbatim format and example to match `JiraHttpClient.enumerateIssues()` at lines 107-109 | P0-S8-02: documented format did not match runtime emission |

---

_0 unresolved P0 carry-forward items after in-sprint fixes._
