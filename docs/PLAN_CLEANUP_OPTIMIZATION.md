# Cleanup + Optimization + Revamp Plan (Frontend + Backend)

Project: DBFuse AI
Scope: Frontend (client) + Backend (API, adapters, RAG, MCP)
Goal: Remove dead weight, optimize performance, simplify architecture, and ensure extensibility for SQL/NoSQL/Cache databases without breaking existing workflows.
Status: In Progress (Phase 0 baseline)
Last Updated: 2026-02-02

## Task Tracker (Current Batch)

Scope guardrails: non-breaking changes only; unified envelopes + DbApiService migration are already live.

### Phase 0 - Baseline + Safety Net (Batch 1)

- [x] Add a non-breaking `/api/db/*` route alias that mirrors `/api/sql/*`.
- [x] Add a task tracker + progress log to this plan for continuity.
- [x] Inventory legacy endpoints/components/CSS tokens to deprecate.
- [x] Document legacy route map and deprecation candidates.

### Phase 1 - Contract Unification (Completed)

- [x] Define unified response envelopes for `metadata` and `query` with versioning notes.
- [x] Add feature-flagged compatibility wrapper to legacy endpoints.

### Phase 2 - Frontend Data Layer (Completed)

- [x] Draft typed `DbApiService` contract (frontend) aligned to unified envelope.
- [x] Define dbType registry contract and migration steps.

### Phase 2 - Frontend Data Layer (Stabilization)

- [x] Align `BackendService` response types with DbApiService envelope payloads.
- [x] Centralize multi-query result extraction in ResultGrid to avoid union-type errors.
- [x] Run client build to validate DbApiService migration and unified envelopes (succeeds with budget warning after Tailwind directive fix; 2026-02-02).
- [x] Sweep for any remaining `/api/sql` client calls and update to `/api/db` alias if found (none found).

### Phase 3 - UI Revamp (Batch 1)

- [x] Remove generic NoSQL explorer fallback; show explicit "no explorer registered" message for unknown dbTypes.
- [x] Identify remaining generic explorer code paths and decide db-specific replacements (Mongo/Redis/etc).
- [x] Audit NoSQL/Cache panels for fixed-layout scrolling + virtualization gaps.
- [x] Add `min-h-0` to NoSQL/Cache explorer content wrappers to improve scroll containment.
- [x] Decide virtualization strategy for large database/collection/key lists (CDK virtual scroll via Angular CDK).
- [x] Add defensive caps (expand/collapse) for large "sample documents" lists to avoid heavy DOM.
- [x] Roll out CDK virtual scroll for database/collection/key lists across remaining explorers (CouchDB/CosmosDB/Redis/etc).
- [x] Standardize virtual scroll item sizing via shared base property.
- [x] Add shared virtual-list component and replace explorer list markup with it.
- [x] Add trackBy for database lists to reduce DOM churn on refresh.
- [x] Add trackBy for collection/key lists to reduce DOM churn on filter changes.
- [x] Consolidate list item button styles into a shared utility class.
- [x] Add shared empty-state helper (icon + copy) for list panels.
- [x] Split SQL/NoSQL shells by removing NoSQL branches from SQL workspace views and using registry-based dbType gating in layouts.
- [x] Unify dbType confirmation prompts via shared confirmation modal service + host; migrated NoSQL explorer actions off `window.confirm`.
- [x] Ensure fixed-layout scrolling across chat and SQL workspace panels (added missing `min-h-0` on flex containers).

## Phase 0 Inventory (2026-02-01)

### Legacy/SQL-Prefixed API Endpoints (server)

- /api/sql/connect, /api/sql/switch-database, /api/sql/health
- /api/sql/query, /api/sql/batch (501 fallback), /api/sql/analyze-query (501 fallback)
- /api/sql/databases, /api/sql/tables, /api/sql/views (501 fallback), /api/sql/procedures (501 fallback)
- /api/sql/collections, /api/sql/collection-info, /api/sql/key-patterns
- /api/sql/table-info, /api/sql/info
- /api/sql/strategy-metadata (501 fallback)
- /api/query/range (virtual scroll; mixed SQL/NoSQL payloads)
  Notes: /api/db/_ alias mirrors /api/sql/_; candidates to consolidate under /api/db/_ + /api/metadata/_ once clients migrate.

### Frontend call sites still bound to /api/sql/\*

- client/dbfuse-ai-client/src/app/core/services/backend/backend.service.ts uses /api/sql/\* for metadata, query, connect, etc.
- client/dbfuse-ai-client/src/app/features/nosql/nosql-explorer/nosql-explorer.component.ts uses SQL endpoints (getTables, getTableInfo) for NoSQL collections.
- client/dbfuse-ai-client/src/app/features/sql-workspace and home layouts embed NosqlExplorerShellComponent alongside SQL flows.

### Generic/Legacy NoSQL explorer components

- client/dbfuse-ai-client/src/app/features/nosql/nosql-explorer/nosql-explorer.component.ts acts as a generic explorer across dbTypes.
- client/dbfuse-ai-client/src/app/features/nosql/nosql-explorer-shell/nosql-explorer-shell.component.ts still imports the generic explorer as fallback, alongside db-specific explorers.

### CSS tokens to audit (usage unknown)

- client/dbfuse-ai-client/src/theme/styles.css: shadcn-like tokens (--background, --foreground, --ring, etc.) + utility classes.
- client/dbfuse-ai-client/src/theme/01-base/variables.css: legacy sizing tokens (--size-navbar-height, --size-footer-height).
- client/dbfuse-ai-client/src/app/editor/features/code-actions/inline-popover.component.ts: uses --popover-bg fallback.

## Phase 1 Notes (2026-02-01)

### Unified response envelopes (v1)

- Unified envelopes are always enabled; responses include an `envelope` at the top level while preserving legacy fields for compatibility.
- Contract + versioning:
  - `contract`: `dbfuse.metadata.v1` or `dbfuse.query.v1`
  - `version`: `2026-02-01`
  - `kind`: `metadata` or `query`
  - `legacyCompat`: `true`
  - `versionNotes`: "Legacy fields are preserved at the top level; envelope.data mirrors the legacy payload during migration."
- Envelope shape (high-level):
  - `envelope.request`: `{ dbType, connectionId }`
  - `envelope.meta`: `{ timestamp, operation }`
  - `envelope.data`: legacy payload (temporary until Phase 2 normalization)
- Capabilities are attached to `envelope.meta.capabilities` when the feature flag is enabled.
- Query results are normalized to include `rows` or `documents` when possible (non-breaking).

## Phase 2 Notes (2026-02-01)

### Typed DbApiService contract (draft)

- New typed API service and envelope types added for future migration (no call sites moved yet).
- Base URL uses `/api/db` alias to align with the unified contract and preserve legacy endpoints.
- Responses typed as `DbEnvelopeResponse<T>` with optional `envelope`.

### dbType registry contract

- Registry defines dbType -> UI surface, labels, defaults, and support flags.
- Intended to replace scattered dbType conditionals with a single source of truth.

### Migration steps (next chat)

1. Add a feature flag (client) to switch between `BackendService` and `DbApiService`.
2. Migrate metadata calls first (databases/tables/collections), then query execution.
3. Update NoSQL explorers to read `envelope.meta.capabilities` when present.
4. Replace dbType conditional UI gating with `DB_TYPE_REGISTRY`.

### Implementation updates (2026-02-02)

- Removed client/server feature flags and defaulted to unified envelopes + `/api/db` paths end-to-end.
- NoSQL explorer flows now call `getCollections` and use `DB_TYPE_REGISTRY` for labels and UI gating.
- SQL workspace/home views use `DB_TYPE_REGISTRY` for dbType-driven labels and AI gating.

## Progress Log

- 2026-02-01: Added `/api/db/*` route alias (non-breaking). Added task tracker + progress log to this plan.
- 2026-02-01: Scoped ESLint to ignore bundled assets and set `eslint.config.js` to module parsing.
- 2026-02-01: Fixed remaining lint errors in `src/services/DatabaseService.js` and `src/utils/policyUtil.js`.
- 2026-02-01: Re-enabled `import/order` and normalized CommonJS requires; added `src/utils/loadEnv.js` to preserve early env loading with a local `import/order` override in `src/index.js`.
- 2026-02-01: Renamed ESLint config to `eslint.config.mjs` and updated lint overrides.
- 2026-02-01: Phase 0 inventory documented (legacy routes, frontend call sites, components, CSS tokens).
- 2026-02-01: Implemented feature-flagged unified response envelopes for metadata/query legacy endpoints.
- 2026-02-01: Completed Phase 1: capabilities in envelopes, standardized query result shape, and unsupported operation validation.
- 2026-02-01: Completed Phase 2: drafted typed DbApiService and dbType registry contract with migration steps.
- 2026-02-02: Phase 2 follow-up: unified envelopes always on, DbApiService used for metadata/query calls, and dbType UI conditionals replaced with registry.
- 2026-02-02: Removed client/server feature flags; DbApiService now backs query execution and DB endpoints end-to-end.
- 2026-02-02: Aligned client `BackendService` response types with DbApiService envelope payloads.
- 2026-02-02: Fixed multi-query typing in ResultGrid and centralized result extraction to avoid union errors.
- 2026-02-02: Attempted client build verification; `ng build` failed with spawn EPERM (esbuild).
- 2026-02-02: Confirmed Node cannot spawn child processes in this environment (spawn EPERM from Node); build verification remains blocked.
- 2026-02-02: Swept repo for remaining `/api/sql` client calls; none found.
- 2026-02-02: Phase 3 kickoff: removed generic NoSQL explorer fallback in shell and added explicit unknown-dbType message.
- 2026-02-02: Identified remaining generic explorer code paths: `client/dbfuse-ai-client/src/app/features/nosql/nosql-explorer` and `client/dbfuse-ai-client/src/app/features/nosql/generic-nosql-explorer` are duplicate standalone components (same selector) with no current imports after fallback removal. Decision: keep db-specific explorers in `features/nosql/explorers/*` as the only active UI; schedule deletion of both generic components during Phase 7 cleanup once confirmed unused.
- 2026-02-02: Audited NoSQL/Cache explorer layouts: all explorer panels use nested `overflow-auto` sections inside `flex` cards, but none use virtualization for long lists (databases/collections/keys/schema/preview docs). Consider `min-h-0` on top-level `flex-1` wrappers if scroll containment issues appear; sample document lists can grow unbounded.
- 2026-02-02: Added `min-h-0` to NoSQL/Cache explorer content wrappers and added sample-document expand/collapse controls in db-specific explorers.
- 2026-02-02: Chose Angular CDK virtual scroll for long metadata lists; implemented in MongoDB explorer (databases + collections) as a reference.
- 2026-02-02: Rolled out CDK virtual scroll for database/collection lists across CouchDB, CosmosDB, Cassandra, DynamoDB, Firestore, HBase, Redis, and Memcached explorers.
- 2026-02-02: Standardized virtual list item sizing by binding `[itemSize]` to a shared base property across explorers.
- 2026-02-02: Added shared virtual-list component and refactored explorer list templates to use it.
- 2026-02-02: Added shared trackBy for database lists in virtual lists to avoid re-render churn.
- 2026-02-02: Added shared trackBy for collection/key lists across explorers.
- 2026-02-02: Consolidated list item button styling into `.ui-list-item` in theme styles and applied to explorer list templates.
- 2026-02-02: Added shared empty-state helper in virtual list component and surfaced icon + copy in explorer list panels.
- 2026-02-02: Split SQL/NoSQL shells by removing NoSQL branches from SQL workspace templates and using registry-based dbType gating in layouts.
- 2026-02-02: Retested client build; `ng build` still fails with spawn EPERM in this environment.
- 2026-02-02: Retested client build with elevated permissions; build now fails on unresolved Tailwind CSS imports in `src/theme/styles.css`.
- 2026-02-02: Replaced Tailwind CSS `@import` directives with `@tailwind` directives; client build now succeeds (budget warning remains).
- 2026-02-02: Ran source-map-explorer on dev build; largest bundle contributors are Angular core/forms/router/common plus result grid and NoSQL explorer templates.
- 2026-02-02: Added shared confirmation modal service/host and migrated NoSQL explorer destructive prompts to use it.
- 2026-02-02: Added missing `min-h-0` to chat + SQL workspace/home containers to stabilize fixed-layout scrolling.
- 2026-02-02: Centralized operation/payload normalization with a shared helper and applied it across NoSQL strategies + DatabaseService.
- 2026-02-02: Added shared metadata sampling helpers (documents/keys/rows) and reused them in NoSQL/cache strategies.
- 2026-02-02: Removed unused strategy stubs (structure helpers, batch/transaction, pagination, functions, and unused cache ops).
- 2026-02-02: Enforced capability checks in strategy adapters during query execution.
- 2026-02-02: Split SQL query generation into a dedicated service used by chat responses.
- 2026-02-02: Added metadata caching in DatabaseService and invalidation on write operations/switches.

## Verification

- 2026-02-01: `npm run lint` (passed). No lint warnings.
- 2026-02-01: `npm run lint` (passed).
- 2026-02-01: `npm run lint` (passed).
- 2026-02-02: `npm run lint` (passed).
- 2026-02-02: `npm run build` in `client/dbfuse-ai-client` (failed: spawn EPERM from esbuild).
- 2026-02-02: `npm run build` in `client/dbfuse-ai-client` with elevated permissions (failed: unresolved `tailwindcss/*` imports in `src/theme/styles.css`).
- 2026-02-02: `npm run build` in `client/dbfuse-ai-client` (passed; warning: initial bundle exceeds 512 kB budget).
- 2026-02-02: `npx source-map-explorer dist/dbfuse-ai-client/browser/*.js --html dist/dbfuse-ai-client/browser/bundle-report.html` (report generated; minor source map warning on polyfills).
- 2026-02-02: `npm run build` in `client/dbfuse-ai-client` (failed: spawn EPERM from esbuild).
- 2026-02-02: Node `child_process.spawn` fails with EPERM even for `cmd`/`esbuild.exe` (environment restriction).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with warnings about `.eslintignore` deprecation and `eslint-env` comments).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` in `client/dbfuse-ai-client` (passed with same `.eslintignore`/`eslint-env` warnings).
- 2026-02-02: `npm run lint` (passed).

## Guiding Principles

- No breaking changes by default; introduce compatibility layers where needed.
- Keep SQL/NoSQL/Cache parity and use capability-driven gating.
- Prefer incremental migrations with feature flags and dual-run fallback.
- Reduce duplication and consolidate shared logic across dbTypes.
- Ensure every change has a rollback strategy.

## High-Level Problems to Address

### Frontend

- NoSQL UX is partially specialized; generic components still carry DB-specific logic.
- Shared flows (connection switching, dbType routing, metadata) are duplicated across pages.
- Heavy data views (results grids, large lists) lack virtualization in some paths.
- Editor + explorer boundaries are fuzzy; some SQL-first UI leaks into NoSQL UX.
- State/side-effects spread across components; missing centralized data access patterns.

### Backend

- API routes are SQL-prefixed even for NoSQL/Cache; semantics are mixed.
- Strategy metadata and capability models are underused in API layer.
- Similar normalization logic repeated in multiple strategy implementations.
- Adapters implement different return shapes that require UI normalization.
- RAG/agent concerns and core query execution are tightly coupled.

### Cross-Cutting

- Inconsistent error contracts between SQL/NoSQL/Cache.
- No single source of truth for dbType capabilities and UI behavior.
- Limited documentation of deprecations/removals.

## Inventory & Cleanup Targets

### Frontend Cleanup Targets

- Consolidate duplicated NoSQL explorers and remove deprecated generic explorer paths.
- Remove legacy SQL-first logic in NoSQL routes (e.g., SQL editor fallbacks in NoSQL).
- De-duplicate page-level data loading in `home`, `sql-workspace`, and layout shells.
- Audit components that parse JSON payloads and create a shared validation helper.
- Remove unused CSS tokens and legacy styles not in use by shadcn foundation.

### Backend Cleanup Targets

- Normalize API routes under `/api/db/*` or `/api/metadata/*` with dbType-aware routing.
- Remove any SQL-only assumptions in `executeQuery` pipeline and enforce adapters per dbType.
- Consolidate strategy normalization (operation, payload) into a shared helper.
- De-duplicate metadata endpoints for collections/tables; use unified metadata contract.
- Remove unused adapter methods and dead code paths after migration.

### RAG + MCP Cleanup Targets

- Separate query execution from LLM reasoning; keep contracts stable.
- Standardize task-step outputs and remove unused step fields.
- Reduce duplicate capability checks scattered across RAG and strategy layers.

## Required Outcomes

- Single, clean contract for database metadata (tables/collections/keys).
- Single, clean contract for query results (documents/rows + pagination + diagnostics).
- Capability-driven UI and server enforcement (no UI-only checks).
- Frontend shell uses a dbType registry and loads only db-native components.
- New dbType onboarding guide: adapter + metadata + UI module + strategy metadata.

## Phased Plan (Non-Breaking)

### Phase 0 - Baseline + Safety Net

Objective: Build a refactor-safe baseline before changes.

- Add a compatibility layer in API to map legacy routes to new contracts.
- Add telemetry/logging around query execution per dbType.
- Add validation in UI for dbType and connection headers.
- Create a high-level system map: data flow from UI -> API -> strategy -> adapter.
- Identify and document dead endpoints, components, and CSS tokens.

Acceptance:

- Legacy UI still works unchanged.
- New compatibility layer can be toggled on/off with a config flag.

### Phase 1 - Contract Unification (Backend First)

Objective: Introduce unified API contracts without breaking callers.

- Implement unified response envelopes:
  - `metadata`: databases/tables/collections + stats + sample data.
  - `query`: rows/documents + pagination + diagnostics.
- Add `capabilities` to all responses.
- Refactor strategies to return a standard `documents` or `rows` shape.
- Wrap legacy endpoints to return new contracts while preserving old fields.
- Add schema to reject unsupported operations at API level.

Acceptance:

- UI can consume new contract via a feature flag.
- Existing adapters behave the same under legacy mode.

### Phase 2 - Frontend Data Layer Revamp

Objective: Centralize frontend data access and remove duplication.

- Introduce a typed `DbApiService` with typed responses per contract.
- Move dbType routing logic into a registry module.
- Migrate NoSQL explorers to use common data hooks (databases, collections, details).
- Standardize error handling + UI state handling (loading, empty, error, retry).
- Remove old fetch logic after migration.

Acceptance:

- NoSQL and SQL explorers use the same data adapter with dbType-aware config.
- Network calls are reduced and visible in dev tools.

### Phase 3 - UI Revamp (Explorer + Editor)

Objective: Make the UI db-native and fully componentized.

- Fully split SQL and NoSQL shells with clean boundaries.
- Convert any remaining generic explorer logic into db-specific panels.
- Implement virtualized lists for databases/tables/collections where needed.
- Unify confirmation UX by dbType with a shared modal system.
- Ensure fixed-layout scrolling across all panels.

Acceptance:

- Each dbType renders a dedicated explorer/editor.
- NoSQL editors never render Monaco.

### Phase 4 - Backend Strategy Cleanup

Objective: Simplify strategy architecture and remove duplicated logic.

- [x] Centralize normalization of operations and payloads.
- [x] Create standard helpers for metadata sampling (documents/keys/rows).
- [x] Remove unused or redundant strategy methods after migration.
- [x] Add adapter-level capability enforcement.

Acceptance:

- Strategies share a single normalization path.
- Capability checks are enforced server-side consistently.

### Phase 5 - RAG + MCP Optimization

Objective: Decouple reasoning from execution and improve performance.

- [x] Separate query generation from execution in services.
- [x] Add caching for schema/metadata and invalidate on updates.
- Reduce payload sizes for task steps and streaming responses.
- Provide dbType-specific prompt templates through registry.

Acceptance:

- RAG pipeline supports all dbTypes with consistent contracts.
- Query execution is independent of LLM availability.

### Phase 6 - Bundle Size Reduction

Objective: Reduce initial bundle size and keep UI performance stable without functional changes.

- Identify largest contributors via `source-map-explorer` and Angular stats.
- Lazy-load non-critical routes and heavy feature modules.
- Split large templates/components (e.g., NoSQL explorer panels) where feasible.
- Reduce CSS payload (prune unused utilities, move rarely used styles to feature scopes).
- Trim dependencies and avoid importing broad Angular modules when narrower imports exist.

Acceptance:

- Initial bundle meets budget or an updated budget is justified with an explicit mitigation plan.
- Source-map-explorer report is committed for the current build.
- No functional regressions in SQL/NoSQL flows.

### Phase 7 - Cleanup + Removal

Objective: Remove deprecated code and finalize new architecture.

- Delete old components/endpoints and unused strategy adapters.
- Remove legacy CSS tokens and unused UI assets.
- Remove migration shims once all consumers are updated.

Acceptance:

- Codebase is smaller, faster to build, and easier to extend.
- No unused code paths remain.

## Extension Path for New DB Types

### Required Steps

1. Add adapter strategy with standardized normalize/execute methods.
2. Register strategy metadata + capability model.
3. Add UI explorer/editor module and register in the shell.
4. Add metadata sampling + basic actions panel.
5. Verify in RAG pipeline: capability + prompt templates.

### Validation Checklist

- Connection success + metadata retrieval + sample data.
- CRUD path for db-native operations.
- Capability enforcement at API and UI.
- Streaming chat flows unchanged.

## Risk Management

- Introduce feature flags for each phase.
- Maintain legacy endpoints until Phase 7.
- Add automated integration tests for at least one dbType per category (SQL/NoSQL/Cache).

## Suggested Deliverables

- `docs/PLAN_CLEANUP_OPTIMIZATION.md` (this document)
- `docs/ARCH_SYSTEM_MAP.md` (data flow diagram + sequence)
- `docs/DBTYPE_ONBOARDING.md` (how to add new dbType end-to-end)

## Next Actions (if approved)

- Create a system map doc and inventory of dead endpoints/components.
- Add capability-driven API responses and a typed data layer in the client.
- Start Phase 1 with a feature-flagged unified contract endpoint.
