# Sprint 18 — Build / Run / Test Diagnosis

_Generated: 2026-05-05 | Architect: Software Architect Persona_

---

## (a) Detected Commands

| Step | Command | Source |
|------|---------|--------|
| Build | `npm run build` → `tsc && vite build` | `package.json` scripts |
| Start (API) | `npm run server` → `tsx src/server.ts` | `package.json` scripts |
| Start (UI dev) | `npm run dev` → `vite` | `package.json` scripts |
| Test | `npm run test` → `vitest run` | `package.json` scripts |
| DB migrations | `npx tsx src/db/database.ts` | `INSTALL.md §3` |

---

## (b) Error Inventory

### Build — `npm run build` — EXIT NON-ZERO (TypeScript errors; vite build never reached)

#### Class A — `_code` / `_body` property missing on `{}` (2 files, 22 occurrences)

Test helper stubs return plain `{}` objects; the test code then accesses `.response._code` and `.response._body` which TypeScript cannot see on the inferred empty-object type.

| File | Lines |
|------|-------|
| `src/routes/restore-guards-e2e.test.ts` | 230, 231, 273, 274, 333, 334, 383, 384, 429, 430, 504, 505, 614, 615, 714, 715, 783, 784, 843, 844 |
| `src/routes/restore-jobs-phase-order.test.ts` | 218, 219, 286, 287, 385, 386, 419, 420 |

Error: `TS2339: Property '_code' does not exist on type '{}'.`

#### Class B — `RestoreSseEvent` → `Record<string, unknown>` cast unsafe (1 file, 2 occurrences)

A direct `as Record<string, unknown>` cast fails because `ConflictResumedEvent` lacks an index signature; TypeScript requires a double cast (`as unknown as …`).

| File | Lines |
|------|-------|
| `src/routes/restore-guards-e2e.test.ts` | 765 (×2) |

Error: `TS2352: Conversion of type 'RestoreSseEvent' to type 'Record<string, unknown>' may be a mistake …`

#### Class C — `RawIssue` not found (1 file, 2 occurrences)

The type `RawIssue` is referenced in `JiraHttpClient.ts` but is not imported or defined in scope.

| File | Lines |
|------|-------|
| `src/workload/http/JiraHttpClient.ts` | 115, 117 |

Error: `TS2304: Cannot find name 'RawIssue'.`

#### Class D — Unused imported / declared symbols (2 files, 3 occurrences)

`noUnusedLocals` / `noUnusedParameters` in `tsconfig.json` treats these as errors.

| File | Line | Symbol |
|------|------|--------|
| `src/workload/JiraWorkload.ts` | 29 | `CaptureProgressEvent` (imported, never used) — `TS6196` |
| `src/workload/snapshot/ProgressEmitter.ts` | 33 | `manifestId` (declared, never read) — `TS6138` |
| `src/workload/snapshot/ProgressEmitter.ts` | 34 | `connectionId` (declared, never read) — `TS6138` |

#### Class E — `VitestUtils` returned from `afterEach` (2 files, 9 occurrences)

`vi.restoreAllMocks()` returns `VitestUtils`, not `Awaitable<void>`. When placed as the sole expression in an `afterEach` callback that implicitly returns it, TypeScript rejects the signature.

| File | Lines |
|------|-------|
| `src/workload/backup/discoverFieldContexts.test.ts` | 163, 220 |
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | 133, 173, 238, 347 |
| `src/workload/snapshot/ProgressEmitter.test.ts` | 147, 157, 224, 273, 339 |

Error: `TS2322: Type 'VitestUtils' is not assignable to type 'Awaitable<void>'.`

#### Class F — `MockInstance` generic type mismatch (2 files, 2 occurrences)

`consoleSpy` is inferred as `MockInstance<[message?: any, ...optionalParams: any[]], void>` but the variable is annotated as `MockInstance<unknown[], unknown>`. The variance of `withImplementation` return type causes the incompatibility.

| File | Line |
|------|------|
| `src/workload/restore/boardScopeRecheck.test.ts` | 8 |
| `src/workload/restore/trashDetectionGuard.test.ts` | 38 |

Error: `TS2322: Type 'MockInstance<[message?: any, ...optionalParams: any[]], void>' is not assignable to type 'MockInstance<unknown[], unknown>'.`

#### Class G — `BackupManifest.diffSummary` undefined vs null (1 file, 1 occurrence)

Test fixture uses `diffSummary?: { … } | undefined` (optional field), but the `BackupManifest` type requires the field to be `{ … } | null` (explicit null, not omittable).

| File | Line |
|------|------|
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | 30 |

Error: `TS2322: Type '… | undefined' is not assignable to type '… | null'.`

#### Class H — `Object.entries` destructuring tuple mismatch (2 files, 6 occurrences)

`Object.entries(…)` returns `[string, T][]` typed as `string[][]` in these call sites. Destructuring `([, p]: [string, string])` or `([s]: [string])` fails because `any[]` does not satisfy the fixed-length tuple type.

| File | Lines |
|------|-------|
| `src/workload/snapshot/CaptureOrchestrator.test.ts` | 435 |
| `src/workload/snapshot/ProgressEmitter.test.ts` | 147, 157, 224, 273, 339 |

Error: `TS2769: No overload matches this call.` / `TS2345: Argument of type '([s]: [string]) => string' is not assignable …`

#### Class I — Empty tuple indexed at [0] and [1] (1 file, 2 occurrences)

A `mock.calls[0]` or similar is typed as tuple `[]` (length 0); accessing index 0 or 1 on it is a compile-time error.

| File | Lines |
|------|-------|
| `src/workload/snapshot/downloadIssueAttachments.test.ts` | 129 (×2) |

Error: `TS2493: Tuple type '[]' of length '0' has no element at index '0'.`

---

### Start — `npm run server` — PASS (with `PORT=4000`)

When `PORT=4000` is set in the environment the server starts and `GET /api/connections` returns HTTP 200. Without the env var it defaults to port 3000.

### Test — `npm run test` — PASS

```
Test Files  32 passed (32)
     Tests  533 passed (533)
  Duration  3.81s
```

All 533 tests pass. Vitest bypasses `tsc`; the TypeScript errors in Class A–I above do not affect test execution.

---

## (c) Default Port vs TARGET_PORT

| | Value |
|---|---|
| Documented default (`INSTALL.md`, `.env.example`) | `3000` |
| Hardcoded fallback (`src/server.ts:14`) | `3000` |
| TARGET_PORT requirement | `4000` |
| **Matches TARGET_PORT?** | **NO** |

Fix required: change the default from `3000` to `4000` in `src/server.ts:14` and in `.env.example`, and update all port references in canonical docs (`INSTALL.md`, `Caddyfile`).

---

## (d) Liveness Endpoint

| | |
|---|---|
| Documented liveness probe | `GET /api/connections` (INSTALL.md §5) |
| `/health` endpoint | **Does not exist** |
| Source file | `src/routes/connections.ts` registers `GET /api/connections`; no `/health` route anywhere in `src/` |

The server responds HTTP 200 from `GET /api/connections` confirming liveness, but a dedicated `/health` route is absent. **This is a P0 gap** if the DoD requires `GET /health` to return 2xx; it is not a P0 if the spec allows the documented `/api/connections` probe as the liveness check.

Given INSTALL.md §5 explicitly documents `curl -sf http://localhost:${PORT:-3000}/api/connections` as the "server is healthy" probe, the liveness check is `GET /api/connections`, not `GET /health`.

---

## (e) Canonical Doc Command References

| Document | Commands referenced |
|----------|-------------------|
| `README.md` | `npm run server`, `npm run dev`, `npm run test` (implicit via INSTALL.md link) |
| `INSTALL.md §4` | `npm run server`, `npm run dev`; start commands; port `3000` in Caddyfile snippet and §5 curl |
| `INSTALL.md §5` | `curl -sf http://localhost:${PORT:-3000}/api/connections` — liveness probe |
| `INSTALL.md §6` | `npm run server`, `bash scripts/run-smoke-probes.sh` — smoke probes |
| `Caddyfile` | `localhost:3000` — Caddy reverse proxy target |
| `.env.example` | `PORT=3000` |

Port `3000` appears in: `INSTALL.md` (Caddyfile snippet, §5 curl default), `Caddyfile`, `.env.example`, and `src/server.ts:14`. All must be updated to `4000`.

---

## Summary

| Check | Status |
|-------|--------|
| `npm run build` | FAIL — 9 error classes, ~50 TypeScript errors |
| `npm run server` (PORT=4000) | PASS — server starts, `/api/connections` → 200 |
| `npm run server` (no PORT env) | FAIL — listens on 3000, not TARGET_PORT 4000 |
| `npm run test` | PASS — 533/533 |
| `/health` endpoint | ABSENT (P0 flag — see §d) |
| Port matches TARGET_PORT=4000 | NO — default is 3000 |
