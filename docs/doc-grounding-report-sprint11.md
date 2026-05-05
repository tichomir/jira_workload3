# Doc-Grounding Report — Phase 3 Sprint 1 (Sprint 11)

_Generated: 2026-05-05 | QA Engineer_

Sprint deliverables verified: `GET /api/inventory` expanded response, `GET /api/inventory/:type` paginated items,
`src/db/migrations/011_inventory_items.sql`, `InventorySidebar`, `ObjectExplorer`, `apiFetch` utility, App.tsx wiring.

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
| `src/platform/contracts.ts` | Y | Inventory Browse Flow | — |
| `src/workload/inventory/InventoryRepository.ts` | **N** | Inventory Browse Flow Key Files | **Fixed in sprint** — file was never created; inventory logic lives inline in `src/routes/inventory.ts`. Architecture doc updated to reference actual location and exports (`buildInventoryResponse`, `handleGetInventory`, `handleGetInventoryByType`). |
| `InventoryObjectType` type in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — actual type is `ObjectTypeEntry['type']` (inline union). Doc updated to match. |
| `InventoryObjectTypeEntry` type in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — actual type name is `ObjectTypeEntry`. |
| `InventoryObjectTypesResponse` type in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — actual type name is `InventoryResponse`. |
| `InventoryItem` in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — `InventoryItem` is defined locally in `src/ui/components/ObjectExplorer.tsx`, not exported from contracts.ts. Doc updated. |
| `IssueInventoryItem` in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — not in contracts.ts; item shape is inline in ObjectExplorer.tsx. Doc updated. |
| `InventoryItemsResponse` in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — not in contracts.ts; defined locally in ObjectExplorer.tsx. Doc updated. |
| `InventoryPagination` in `src/platform/contracts.ts` | **N** | Inventory Browse Flow | **Fixed in sprint** — not in contracts.ts; defined locally in ObjectExplorer.tsx. Doc updated. |
| `backupPointId` listed as optional for `GET /api/inventory/:type` | **N** | GET /api/inventory/:type Query Parameters | **Fixed in sprint** — implementation requires `backupPointId` (returns 400 when absent). Arch doc table updated to Required=Yes. |
| `buildInventoryResponse(manifest)` | Y | Inventory Browse Flow (post-fix) | Exported from `src/routes/inventory.ts` ✓ |
| `PHASE_EMIT_BOUNDARIES` constant | Y | Snapshot Orchestrator | in `src/workload/snapshot/types.ts` ✓ |
| `PAGINATION_TERMINATION_CONTRACT` | Y | Pagination Termination | in `src/workload/snapshot/types.ts` ✓ |
| `src/workload/http/JiraHttpClient.ts:107-109` log format | Y | Structured-Log Line Shapes | line numbers approximate; format verified in codebase ✓ |

---

## CHANGELOG.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `src/routes/inventory.ts` | Y | Phase 3 Sprint 1 | — |
| `src/db/migrations/011_inventory_items.sql` | Y | Phase 3 Sprint 1 | — |
| `src/ui/components/InventorySidebar.tsx` | Y | Phase 3 Sprint 1 | — |
| `src/ui/components/ObjectExplorer.tsx` | Y | Phase 3 Sprint 1 | — |
| `src/ui/lib/apiFetch.ts` | Y | Phase 3 Sprint 1 | — |
| `src/App.tsx` | Y | Phase 3 Sprint 1 | — |
| `.env.example` | Y | Phase 3 Sprint 1 | — |
| `buildInventoryResponse(manifest)` function | Y | Phase 3 Sprint 1 | exported from `src/routes/inventory.ts` ✓ |
| `backup_point_items` table | Y | Phase 3 Sprint 1 | created by 011_inventory_items.sql ✓ |
| `rowId` (autoincrement PK) | Y | Phase 3 Sprint 1 | column in 011_inventory_items.sql ✓ |
| `connectionId` FK → `connections` | Y | Phase 3 Sprint 1 | FOREIGN KEY … ON DELETE CASCADE ✓ |
| `backupPointId` FK → `backup_manifests` | Y | Phase 3 Sprint 1 | FOREIGN KEY … ON DELETE CASCADE ✓ |
| Unique index on `(backupPointId, objectType, itemId)` | Y | Phase 3 Sprint 1 | `idx_bpi_unique` in migration ✓ |
| Lookup index on `(connectionId, backupPointId, objectType)` | Y | Phase 3 Sprint 1 | `idx_bpi_lookup` in migration ✓ |
| `[inventory] connectionId=… backupPointId=… jsmExcludedProjects=…` log line | Y | Phase 3 Sprint 1 | emitted in `handleGetInventory` ✓ |
| `apiFetch<T>(path, options?)` | Y | Phase 3 Sprint 1 | in `src/ui/lib/apiFetch.ts` ✓ |
| `ApiError(status)` class | Y | Phase 3 Sprint 1 | exported from `src/ui/lib/apiFetch.ts` ✓ |
| `/inventory` route in `src/App.tsx` | Y | Phase 3 Sprint 1 | `<Route path="/inventory" element={<InventoryPage />} />` ✓ |
| `GET /api/connections` called on mount | Y | Phase 3 Sprint 1 | in `InventoryPage` useEffect ✓ |
| `onInventoryLoad({ backupPointId })` callback | Y | Phase 3 Sprint 1 | prop on `InventorySidebar` ✓ |
| `src/workload/snapshot/downloadIssueAttachments.ts` | Y | Sprint 3 Phase 2 | — |
| `src/workload/backup/computeManifestDiff.ts` | Y | Sprint 3 Phase 2 | — |
| `src/routes/jobs.ts` | Y | Sprint 3 Phase 2 | — |
| `src/workload/snapshot/ProgressEmitter.ts` | Y | Sprint 3 Phase 2 | — |
| `src/workload/types/PolicyRecord.ts` | Y | Sprint 3 Phase 2 | — |
| `src/db/migrations/010_backup_jobs.sql` | Y | Sprint 3 Phase 2 | — |
| `src/db/migrations/010_policies_rpo_jql.sql` | Y | Sprint 3 Phase 2 | — |
| `DCC_ATTACHMENT_DIR` env var | Y | Sprint 3 Phase 2 | in `.env.example` (commented example) ✓ |

---

## DEMO.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `http://localhost:3000` | Y | Prerequisites | matches `PORT=3000` default in `.env.example` ✓ |
| `https://localhost` | Y | Prerequisites | matches `Caddyfile` reverse proxy ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | Prerequisites | in `.env.example` ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | Prerequisites | in `.env.example` ✓ |
| `OAUTH_REDIRECT_URI` | Y | Prerequisites | in `.env.example` ✓ |
| `.env` | Y | Prerequisites | `.env.example` present; operator copies to `.env` ✓ |
| `/api/oauth/callback` | Y | OAuth flow | route in `src/routes/oauth.ts` / `src/server.ts` ✓ |
| `https://api.atlassian.com/oauth/token/accessible-resources` | Y (external) | OAuth flow | Atlassian API URL; not in codebase but documented ✓ |
| `backup_manifests` table | Y | Discover Projects | created by `009_backup_manifests.sql` ✓ |
| `data/jira_workload.db` | Y | Discover Projects | exists at `data/jira_workload.db` ✓ |
| `sqlite3` CLI | Y (system) | Discover Projects | standard tool; smoke uses Python sqlite3 ✓ |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}` | Y | Attachments | storage path per `resolveAttachmentPaths()` in `Attachment.ts` ✓ |
| `data/attachments/{backupPointId}/{issueKey}/{attachmentId}.meta.json` | Y | Attachments | sidecar path per `resolveAttachmentPaths()` ✓ |
| `DCC_ATTACHMENT_DIR` env var | Y | Attachments | in `.env.example` ✓ |
| `GET /api/jobs/:id` | Y | Job Progress | route in `src/routes/jobs.ts` ✓ |
| `scripts/smoke-discover.ts` | Y | Probe 4 | exists at `scripts/smoke-discover.ts` ✓ |
| `npx tsx scripts/smoke-discover.ts` | Y | Probe 4 | `tsx` in devDependencies; `scripts/smoke-discover.ts` exists ✓ |
| `src/workload/backup/discoverFieldContexts.test.ts` | Y | Probe 5 | exists ✓ |
| `src/workload/snapshot/assembleIssuePayload.test.ts` | Y | Probe 5 | exists ✓ |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | Y | Probe 5 | exists ✓ |
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | Y | Probe 6 | exists ✓ |
| `src/workload/backup/computeManifestDiff.test.ts` | Y | Probe 6 | exists ✓ |
| Probe 3 `counts` / `manifestId` / `completedAt` fields | **N** | Probe 3 | **Fixed in sprint** — `GET /api/inventory` now returns `objectTypes[]` + `backupPointId`; Probe 3 assertions updated to match new shape. |
| `backup_point_items` table (Probe 7 seed) | Y | Probe 7 | created by `011_inventory_items.sql` ✓ |
| `DB_PATH` env var (Probe 7) | Y | Probe 7 | defaults to `data/jira_workload.db` ✓ |
| `npm run server` target | Y | Probe 7 comment | in `package.json` scripts ✓ |

---

## INSTALL.md

| Reference | Exists | Section | Resolution |
|-----------|--------|---------|------------|
| `.env.example` | Y | §2 Configure environment | exists ✓ |
| `ATLASSIAN_CLIENT_ID` | Y | §2 table | in `.env.example` ✓ |
| `ATLASSIAN_CLIENT_SECRET` | Y | §2 table | in `.env.example` ✓ |
| `OAUTH_REDIRECT_URI` | Y | §2 table | in `.env.example` ✓ |
| `PORT` | Y | §2 table | in `.env.example` ✓ |
| `Caddyfile` | Y | §2 HTTPS | exists at project root ✓ |
| Caddyfile snippet `reverse_proxy /api/* localhost:3000` | Y | §2 HTTPS | matches actual `Caddyfile` content ✓ |
| `OAUTH_REDIRECT_URI=https://localhost/api/oauth/callback` | Y | §2 HTTPS | consistent with `Caddyfile` ✓ |
| `src/db/database.ts` | Y | §3 Migrations | exists ✓ |
| `npx tsx src/db/database.ts` | Y | §3 Migrations | `tsx` in devDependencies ✓ |
| `npm run server` | Y | §4 Option A | in `package.json` scripts ✓ |
| `npm run dev` | Y | §4 Option A | in `package.json` scripts ✓ |
| `https://localhost` | Y | §4 Option A | matches `Caddyfile` ✓ |
| `http://localhost:5173` | Y | §4 Option A | matches Vite dev server default ✓ |
| `podman-compose up -d` | Y (system) | §4 Option B | standard podman-compose command ✓ |
| `podman-compose logs -f` | Y (system) | §4 Option B | standard command ✓ |
| `podman-compose down` | Y (system) | §4 Option B | standard command ✓ |
| `curl -sf http://localhost:${PORT:-3000}/api/connections \| python3 -m json.tool` | Y | §5 Verify | matches server route; `python3` available ✓ |

---

## Smoke Probe Execution Summary

Probes executed against a fresh server instance (`PORT=3002 npm run server`) using the current codebase:

| Probe | Description | Result |
|-------|-------------|--------|
| Probe 3 (corrected) | stub-endpoints: `GET /api/inventory` new shape + `POST /api/policies` | **PASS** |
| Probe 7 | browse-protected-inventory: objectTypes shape, paginated items, traceability | **PASS** |

> Note: The managed server on port 3000 (started by `sprint_runner_service.py` before this sprint's code landed) returns the pre-sprint `counts` format. Probes were executed against a fresh `tsx` server on port 3002 to verify the new code. Probes 1–2 and 4–6 rely on pre-existing behaviour unchanged this sprint; they remain valid as verified in prior sprint grounding reports.

---

## N-Row Summary

| # | Doc | Reference | Status |
|---|-----|-----------|--------|
| 1 | ARCHITECTURE.md | `src/workload/inventory/InventoryRepository.ts` | Fixed in sprint — file doesn't exist; doc updated to reflect inline handlers |
| 2 | ARCHITECTURE.md | `InventoryObjectType`, `InventoryObjectTypeEntry`, `InventoryObjectTypesResponse` type names | Fixed in sprint — actual names are `ObjectTypeEntry` / `InventoryResponse` |
| 3 | ARCHITECTURE.md | `InventoryItem`, `IssueInventoryItem`, `InventoryItemsResponse`, `InventoryPagination` in contracts.ts | Fixed in sprint — these are local to ObjectExplorer.tsx; doc updated |
| 4 | ARCHITECTURE.md | `backupPointId` optional for `GET /api/inventory/:type` | Fixed in sprint — implementation requires it; table updated to Required=Yes |
| 5 | DEMO.md | Probe 3 checks `counts`, `manifestId`, `completedAt` | Fixed in sprint — assertions updated to `objectTypes[]` shape |
