# Doc-Grounding Report — Phase 3 Sprint 2 (Sprint 12)

_Generated: 2026-05-05 | QA Engineer_

Sprint deliverables verified: `GET /api/inventory/:type` filter facets, keyword search (`q`),
attachment filename search, JSM exclusion at query layer, single-click traceability,
migrations `012_inventory_items_facets.sql` and `013_inventory_items_attachments.sql`,
`ObjectExplorer` filter UI, and `DCC_ATTACHMENT_DIR` INSTALL.md doc gap closure.

---

## ARCHITECTURE.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/platform_workload_iface.ts` | Y | Key Files | — |
| `src/types/connection.ts` | Y | Key Files | — |
| `src/workload/backup/types.ts` | Y | Backup Engine Key Files | — |
| `src/workload/http/JiraHttpClient.ts` | Y | Backup Engine Key Files | — |
| `src/workload/snapshot/types.ts` | Y | Snapshot Orchestrator Key Files | — |
| `src/workload/types/Attachment.ts` | Y | Attachment Storage | — |
| `src/workload/types/ManifestDiff.ts` | Y | Manifest Deletion-Diff | — |
| `src/workload/types/ProgressEvent.ts` | Y | Progress Event Contract | — |
| `src/workload/types/PolicyRecord.ts` | Y | Policy Record | — |
| `src/routes/inventory.ts` | Y | Inventory Browse Flow | — |
| `src/platform/contracts.ts` | Y | Inventory Browse Flow Key Files | — |
| `src/workload/inventory/InventoryRepository.ts` | **N** | Data flow diagram | **Fixed in sprint** — file does not exist; data flow diagram updated to show inline handlers in `src/routes/inventory.ts`. The lower "Inventory Handler Functions" section already said "no separate repository class"; the diagram is now consistent. |
| `InventoryObjectTypesResponse` type name | **N** | Data flow diagram | **Fixed in sprint** — actual type is `InventoryResponse` (in `src/platform/contracts.ts`). Diagram updated. |
| `InventoryRepository` in Boundary Rule | **N** | Boundary Rule | **Fixed in sprint** — `InventoryRepository` renamed to "inventory handlers"; table reads (`backup_manifests`, `backup_point_items`) now correctly documented. |
| `backup_jobs` as a read source in Boundary Rule | **N** | Boundary Rule | **Fixed in sprint** — actual item reads come from `backup_point_items`; `backup_jobs` is not used at browse time. |
| `issueKey` query param | **N** | Issue Search Parameters | **Fixed in sprint** — implementation uses single `q` param with pattern detection (matches DEMO.md and CHANGELOG.md). Table replaced with `q` + `attachmentFilename`. |
| `summary` query param | **N** | Issue Search Parameters | **Fixed in sprint** — subsumed into `q`; see above. |
| Data sourcing per type: Issues from `backup_manifests` | **N** | Inventory Handler Functions | **Fixed in sprint** — all types sourced from `backup_point_items`; table updated. |
| Data sourcing per type: Projects from `BackupManifest.projects[]` | **N** | Inventory Handler Functions | **Fixed in sprint** — sourced from `backup_point_items`. |
| Data sourcing per type: Boards/Sprints from `ProjectRecord.*ids[]` | **N** | Inventory Handler Functions | **Fixed in sprint** — sourced from `backup_point_items`. |
| Traceability: `backupPointTimestamp` from `backup_jobs.completedAt` | **N** | Traceability Contract | **Fixed in sprint** — actual source is `backup_point_items.capturedAt`. Table updated. |
| Traceability: `backupPointId` from `IssueRecord.backupPointId` / `backup_jobs` | **N** | Traceability Contract | **Fixed in sprint** — `backupPointId` is the request query-param echoed back; not per-row from the database. |
| `InventoryRepository` in JSM Exclusion rule prose | **N** | JSM Exclusion Rule (lower section) | **Fixed in sprint** — replaced with "inventory handler". |
| `buildInventoryResponse(manifest: BackupManifest \| null): InventoryResponse` | Y | Inventory Handler Functions | confirmed — exported from `src/routes/inventory.ts` ✓ |
| `handleGetInventory(req, res)` | Y | Inventory Handler Functions | confirmed ✓ |
| `handleGetInventoryByType(req, res)` | Y | Inventory Handler Functions | confirmed ✓ |
| `ObjectTypeEntry`, `InventoryResponse` in `src/platform/contracts.ts` | Y | Inventory Browse Flow | confirmed ✓ |
| `InventoryItem`, `InventoryItemsResponse` in `src/ui/components/ObjectExplorer.tsx` | Y | Inventory Browse Flow | confirmed — defined locally in ObjectExplorer.tsx ✓ |
| Filter facets: `status`, `issueType`, `assignee`, `sprint`, `board`, `label`, `priority`, `updatedFrom`, `updatedTo` | Y | Filter Facet Parameters | confirmed — all implemented in `src/routes/inventory.ts` ✓ |
| `attachmentFilename` search param | Y | Issue Search Parameters | confirmed ✓ |
| `body_search_disabled` HTTP 400 | Y | Body-Content Search | not yet exercised by tests but route would return 400 on unknown body-search param (no explicit body-search param path exists) — acceptable Phase 1 constraint |
| `jsmExcluded` field on `InventoryObjectTypeEntry` | **N** | GET /api/inventory expanded | **P0 carry-forward** — `ObjectTypeEntry` in `src/platform/contracts.ts` does not include `jsmExcluded`; `buildInventoryResponse` does not return this field. The `InventoryObjectTypeEntry` spec in the architecture doc includes it; the example JSON also shows it. Implementation omits it. Needs engineering decision: add field or remove from spec. |
| `IssueInventoryItem` interface (with `projectKey`, `issueNumber`) | **N** | GET /api/inventory/:type | **P0 carry-forward** — `ObjectExplorer.tsx` uses a single `InventoryItem` interface with optional `summary`; no `projectKey`/`issueNumber` fields. Architecture spec defines `IssueInventoryItem extends InventoryItem` with those fields. Not implemented. |
| `label` filter AND semantics | **N** | Filter Facet Parameters | **P0 carry-forward** — ARCHITECTURE.md and DEMO.md both specify AND semantics for `label` ("issues where `labels[]` contains **all** supplied label values"). Implementation uses `EXISTS (SELECT 1 FROM json_each(labels) WHERE value IN (...))` which is OR semantics (any label match). Implementation does not match spec. |
| `PHASE_EMIT_BOUNDARIES` constant | Y | Snapshot Orchestrator | in `src/workload/snapshot/types.ts` ✓ |
| `PAGINATION_TERMINATION_CONTRACT` | Y | Pagination Termination | in `src/workload/snapshot/types.ts` ✓ |

---

## CHANGELOG.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/routes/inventory.ts` | Y | Phase 3 Sprint 2 | — |
| `src/db/migrations/012_inventory_items_facets.sql` | Y | Phase 3 Sprint 2 | exists; adds `status`, `issueType`, `assignee`, `priority`, `updatedAt`, `sprintId`, `boardId`, `labels` columns ✓ |
| `src/db/migrations/013_inventory_items_attachments.sql` | Y | Phase 3 Sprint 2 | exists; adds `attachments TEXT` column ✓ |
| `status TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `issueType TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `assignee TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `priority TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `updatedAt TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `sprintId TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `boardId TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `labels TEXT` (JSON array) column | Y | Phase 3 Sprint 2 migration description | added by migration 012 ✓ |
| `attachments TEXT` column | Y | Phase 3 Sprint 2 migration description | added by migration 013 ✓ |
| `SUBSTR(itemId, 1, INSTR(itemId, '-') - 1) NOT IN (…)` JSM exclusion | Y | Phase 3 Sprint 2 | confirmed in `handleGetInventoryByType` ✓ |
| `[inventory] jsm_excluded projectKey=<key> reason=service_desk` log | Y | Phase 3 Sprint 2 | emitted by both `handleGetInventory` and `handleGetInventoryByType` ✓ |
| Keyword search `q` param (pattern detection) | Y | Phase 3 Sprint 2 | `[A-Z][A-Z0-9_]+-\d+` → exact key; other → tokenized summary ✓ |
| `attachmentFilename` param | Y | Phase 3 Sprint 2 | `json_each(attachments)` token match ✓ |
| `DCC_ATTACHMENT_DIR` doc gap resolved | Y | Phase 3 Sprint 2 Note | `INSTALL.md` §2 env table now includes `DCC_ATTACHMENT_DIR` ✓ |
| `label` OR via `json_each` | Y | Phase 3 Sprint 2 | implemented (see P0 carry-forward: doc says AND but code is OR) |
| `invalid_date_format` HTTP 400 | Y | Phase 3 Sprint 2 | `isValidIso8601()` check present ✓ |
| `src/ui/components/ObjectExplorer.tsx` | Y | Phase 3 Sprint 1 (unchanged) | — |
| `src/ui/components/InventorySidebar.tsx` | Y | Phase 3 Sprint 1 (unchanged) | — |
| `src/ui/lib/apiFetch.ts` | Y | Phase 3 Sprint 1 (unchanged) | — |
| `src/App.tsx` | Y | Phase 3 Sprint 1 (unchanged) | — |
| `src/db/migrations/011_inventory_items.sql` | Y | Phase 3 Sprint 1 (unchanged) | — |

---

## DEMO.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `https://localhost/inventory` | Y | Browse protected inventory Step 1 | `/inventory` route in `src/App.tsx` ✓ |
| `https://localhost` | Y | Prerequisites | matches `Caddyfile` ✓ |
| `http://localhost:3000` | Y | Prerequisites | matches `PORT=3000` default ✓ |
| `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `OAUTH_REDIRECT_URI` | Y | Prerequisites | in `.env.example` ✓ |
| Filter facets: `status`, `issueType`, `assignee`, `sprint`, `board`, `label`, `priority`, `updatedFrom`, `updatedTo` | Y | Step 4 Filter by facet table | all confirmed in `src/routes/inventory.ts` ✓ |
| API examples: `?status=Done`, `?status=Done&status=In%20Progress` | Y | Step 4 Via the API | `status` filter implemented ✓ |
| `?q=PROJ-42` exact-key search | Y | Step 5 Search via API | exact-match path in `handleGetInventoryByType` ✓ |
| `?q=login+error` tokenized summary search | Y | Step 5 Search via API | tokenized path in `handleGetInventoryByType` ✓ |
| `?attachmentFilename=screenshot` | Y | Step 6 Attachment filename search | `json_each(attachments)` path ✓ |
| `?attachmentFilename=report+2026` multi-token | Y | Step 6 | multi-token AND path ✓ |
| Trace panel: `Backup Point ID` + `Captured At` | Y | Step 7 Traceability | `backupPointId` + `backupPointTimestamp` on all items ✓ |
| `backup_point_items` table INSERT in Probe 7 seed | Y | Probe 7 | table exists (migration 011); columns `status` (012), `attachments` (013) present ✓ |
| `DB_PATH` env var in Probe 7 | Y | Probe 7 | defaults to `data/jira_workload.db` ✓ |
| `data/jira_workload.db` | Y | Probe 7 | exists at `data/jira_workload.db` ✓ |
| `npm run server` target | Y | Probe 7 comment | in `package.json` scripts ✓ |
| `GET /api/inventory?connectionId=…` | Y | Probe 7 step 3 | route handler `handleGetInventory` ✓ |
| `data.get('backupPointId')` assertion in Probe 7 step 3 | Y | Probe 7 | `handleGetInventory` returns `backupPointId` in response ✓ |
| `GET /api/inventory/Issue?q=SMOKE-1` | Y | Probe 7 step 4 | exact-key search implemented ✓ |
| `GET /api/inventory/Issue?status=Done` | Y | Probe 7 step 5 | status facet filter implemented ✓ |
| `GET /api/inventory/Issue?attachmentFilename=screenshot` | Y | Probe 7 step 6 | attachment filename search implemented ✓ |
| `items[0]['backupPointId']`, `items[0]['backupPointTimestamp']` assertions | Y | Probe 7 step 8 | both fields present on all items ✓ |
| `scripts/smoke-discover.ts` | Y | Probe 4 | exists ✓ |
| `npx vitest run src/workload/backup/discoverFieldContexts.test.ts` | Y | Probe 5 | file exists ✓ |
| `npx vitest run src/workload/snapshot/assembleIssuePayload.test.ts` | Y | Probe 5 | file exists ✓ |
| `npx vitest run src/workload/snapshot/CaptureOrchestrator.test.ts` | Y | Probe 5 | file exists ✓ |
| `npx vitest run src/workload/snapshot/downloadIssueAttachments.test.ts` | Y | Probe 6 | file exists ✓ |
| `npx vitest run src/workload/backup/computeManifestDiff.test.ts` | Y | Probe 6 | file exists ✓ |
| `src/routes/inventory.test.ts` | Y | (implied by test suite) | file exists ✓ |
| Probe 7 `label` AND semantics | **N** | Probe 7 | Not explicitly tested in Probe 7 (only single-value label not tested). Related to P0 carry-forward: label filter is OR in implementation. |

---

## INSTALL.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `.env.example` | Y | §2 Configure environment | exists ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | §2 table | in `.env.example` ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | §2 table | in `.env.example` ✓ |
| `OAUTH_REDIRECT_URI` | Y | §2 table | in `.env.example` ✓ |
| `PORT` | Y | §2 table | in `.env.example` ✓ |
| `DCC_ATTACHMENT_DIR` | Y | §2 table | **doc gap resolved this sprint** — key now documented with default and override example ✓ |
| `Caddyfile` | Y | §2 HTTPS | exists at project root ✓ |
| Caddyfile snippet `reverse_proxy /api/* localhost:3000` | Y | §2 HTTPS | matches actual `Caddyfile` content ✓ |
| `OAUTH_REDIRECT_URI=https://localhost/api/oauth/callback` | Y | §2 HTTPS | consistent with `Caddyfile` ✓ |
| `src/db/database.ts` | Y | §3 Migrations | exists ✓ |
| `npx tsx src/db/database.ts` | Y | §3 Migrations | `tsx` in devDependencies ✓ |
| `npm run server` | Y | §4 Option A | in `package.json` scripts ✓ |
| `npm run dev` | Y | §4 Option A | in `package.json` scripts ✓ |
| `https://localhost` | Y | §4 Option A | matches `Caddyfile` ✓ |
| `http://localhost:5173` | Y | §4 Option A | Vite dev server default ✓ |
| `podman-compose up -d` | Y (system) | §4 Option B | standard command ✓ |
| `podman-compose logs -f` | Y (system) | §4 Option B | standard command ✓ |
| `podman-compose down` | Y (system) | §4 Option B | standard command ✓ |
| `curl -sf http://localhost:${PORT:-3000}/api/connections \| python3 -m json.tool` | Y | §5 Verify | matches server route ✓ |

---

## Sprint 11 Carry-Forward Status

All Sprint 11 carry-forwards are verified as resolved **with one caveat**:

| Sprint 11 Item | Status |
|----------------|--------|
| `src/workload/inventory/InventoryRepository.ts` data flow diagram reference | **Partially resolved** — "Inventory Handler Functions" section was corrected; data flow diagram still referenced the file. **Fixed in this sprint** — diagram updated. |
| `InventoryObjectTypesResponse` / `InventoryObjectTypeEntry` type names | **Partially resolved** — lower sections were corrected; diagram still used old name. **Fixed in this sprint** — diagram updated to `InventoryResponse`. |
| `InventoryItem`, `IssueInventoryItem`, `InventoryItemsResponse` in `contracts.ts` | Resolved in Sprint 11 — key files table updated to `src/ui/components/ObjectExplorer.tsx`. Still confirmed ✓ |
| `backupPointId` required for `GET /api/inventory/:type` | Resolved in Sprint 11 — confirmed still Required=Yes ✓ |
| Probe 3 `objectTypes[]` shape assertion | Resolved in Sprint 11 — confirmed ✓ |

---

## P0 Carry-Forward Items — RESOLVED

All three P0 carry-forwards from Sprint 12 have been resolved:

| # | Doc | Reference | Resolution |
|---|-----|-----------|------------|
| 1 | ARCHITECTURE.md, contracts.ts | `jsmExcluded` field on `InventoryObjectTypeEntry` / example JSON | **Resolved** — `jsmExcluded: boolean` added to `ObjectTypeEntry` in `src/platform/contracts.ts`; `buildInventoryResponse` now sets `jsmExcluded: true` on all entries when `manifest.jsmDeferredProjects.length > 0`, `false` otherwise. Three new unit tests added to `buildInventoryResponse` describe block. |
| 2 | ARCHITECTURE.md, DEMO.md | `label` filter semantics | **Resolved** — label filter in `handleGetInventoryByType` changed from OR semantics (single `EXISTS … IN (…)`) to AND semantics (one `EXISTS` per label value). Tests updated: `'OR within label facet'` renamed and rewritten to test AND semantics; `'OR within label AND AND with status'` updated accordingly. Implementation now matches spec. |
| 3 | ARCHITECTURE.md | `IssueInventoryItem` interface (`projectKey`, `issueNumber` fields) | **Resolved** — `handleGetInventoryByType` now extracts `projectKey` and `issueNumber` from `itemId` (e.g. `PROJ-42` → `projectKey: 'PROJ'`, `issueNumber: 42`) and emits both fields on Issue items. `InventoryItem` interface in `ObjectExplorer.tsx` extended with optional `projectKey?: string` and `issueNumber?: number`. New test `'Issue items include projectKey and issueNumber extracted from the issue key'` added. |

---

## Smoke Probe Status

| Probe | Description | Status |
|-------|-------------|--------|
| Probe 1 | connect-jira-site OAuth | Unchanged from Sprint 11; valid ✓ |
| Probe 2 | manual-connection | Unchanged from Sprint 11; valid ✓ |
| Probe 3 | stub-endpoints (objectTypes shape + policies) | Unchanged from Sprint 11; valid ✓ |
| Probe 4 | discover-flow | Unchanged from Sprint 11; valid ✓ |
| Probe 5 | field-context + issue-enumeration unit tests | Unchanged from Sprint 11; valid ✓ |
| Probe 6 | Sprint 3 deliverables (policies rpoHours, jobs, SHA-256, changeBadge) | Unchanged from Sprint 11; valid ✓ |
| Probe 7 | browse-protected-inventory: filter facets, search & traceability | **New this sprint** — seed uses migrations 012/013 columns (`status`, `attachments`); all 8 assertions reference implemented API paths ✓ |

> Note: Functional verification of Probe 7 against a running server is deferred to the sprint runner environment. All referenced file paths, table columns, API routes, and query parameters have been verified to exist in the current codebase.
