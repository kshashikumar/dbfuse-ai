# UI Plan: Database-Native UX

Scope: UI components, editors, and workflows per dbType.
Status: Active (phased)

## How to Use This Plan

- This doc is self-contained and must be followed even without prior chat context.
- Implement batches in order and update the Phase Checklist when verified.
- Do not mark items complete until acceptance checklist items pass.

## Goals

- Replace SQL-first UI with dbType-native experiences.
- Use a component registry to load explorer/editor/actions panels per dbType.
- Ensure NoSQL/Cache editors are db-native, not Monaco-based.
- Keep the UI aligned with the shadcn-style tokens and primitives defined in `client/dbfuse-ai-client/src/theme/styles.css` and `client/dbfuse-ai-client/tailwind.config.ts`.

## Current State (as-built)

- SQL editor + results grid are the primary workflow.
- NoSQL explorer exists but shares SQL-first UI; MongoDB/Redis have the most depth.
- Connection forms cover all dbTypes.

## Component Architecture

- Explorer registry: dbType -> explorer component + schema panel + actions panel.
- Shells: SQL shell vs NoSQL shell; auto-switch on dbType selection.
- Capability-driven UI: hide actions not supported by the adapter.

### Explorer Module Contract (UI)

Each dbType exposes a module with:

- ExplorerPanel: navigation tree/list and metadata browsing.
- EditorPanel: db-native query editor/builder.
- ActionsPanel: context actions (indexes, keys, views).
- DetailsPanel: schema/document/details and stats.
- EmptyState: onboarding/empty content view.
- ToolbarActions: db-specific actions (import/export, explain, analyze).

The shell wires these slots based on dbType selection.

### Data + Events

- Inputs: dbType, connectionId, database name, capabilities, normalized metadata.
- Events: onSelectEntity, onRunQuery, onConfirmDestructive, onRefreshMetadata.

## Editor Rules

- SQL dbTypes: Monaco editor is default.
- NoSQL/Cache dbTypes: use db-native builders or custom UI per dbType.
- If a database has no native editor, build an interactive builder that matches its model.
- Editor UI must honor the fixed-layout rule (internal scroll only).

## Chat UX (global)

- Chat page is ChatGPT/Claude-style with WebSocket streaming.
- Chat responses show natural-language answers with inline, collapsible working steps.
- Working steps stream live (ChatGPT-style progress updates).
- Confirmations appear as chat prompts per dbType.

## Capability-Driven UI Rules

- Hide or disable unsupported actions based on capability metadata.
- If capability is missing, show a minimal hint in the UI (no hard errors).
- Confirmations are UI-only with dbType-specific copy.

## Destructive Confirmation UX (per dbType)

- Each dbType defines destructive actions that require confirmation and copy.
- Confirmations are UI-only, no server-side confirm tokens.
- Example actions:
  - MongoDB: deleteMany, dropIndex, drop collection.
  - Redis: del keys, expireMany, flushall.
  - DynamoDB: batchWrite delete, delete table.
  - Cassandra: DELETE without partition key.
  - SQL: DROP/DELETE/UPDATE without WHERE.

## Data Contracts (UI)

- Inputs:
  - Capabilities from backend metadata.
  - Normalized metadata (collections/tables/keys).
  - Chat message schema for streaming responses (natural-language in chat + working steps).
- Outputs:
  - Query payloads compatible with adapter executeQuery.
  - UI confirmations recorded as chat message metadata.

## Delivery Plan (phased batches)

### Batch A: MongoDB, Redis

- MongoDB: Compass-style collection/doc browsing, aggregation, indexes, schema analysis.
- Redis: keyspace analysis, data-structure viewers/editors, TTL workflows.
- Confirmations: per-dbType destructive actions wired.

Acceptance:

- [ ] Explorer uses db-native components
- [ ] Editors are db-native (not Monaco)
- [ ] Confirmation copy + trigger rules implemented
- [ ] Capability-driven UI states applied

### Batch B: DynamoDB, Cassandra

- DynamoDB: table/item explorer, GSI/LSI pickers, capacity and key guidance.
- Cassandra: keyspace/table explorer, primary key/partition hints, CQL editor.

Acceptance:

- [ ] Explorer uses db-native components
- [ ] Editors are db-native
- [ ] Confirmation copy + trigger rules implemented
- [ ] Capability-driven UI states applied

### Batch C: CouchDB, Cosmos DB, Firestore

- CouchDB: Fauxton-style DB/Doc browser, Mango queries, design docs/views.
- Cosmos DB: container-centric UX with partition keys and RU/s hints.
- Firestore: collection/document tree, structured query builder, collection groups.

Acceptance:

- [ ] Explorer uses db-native components
- [ ] Editors are db-native
- [ ] Confirmation copy + trigger rules implemented
- [ ] Capability-driven UI states applied

### Batch D: HBase, Memcached

- HBase: namespace/table browser, column-family focus, scan/get tools.
- Memcached: key/value browser, stats + slab views where possible.

Acceptance:

- [ ] Explorer uses db-native components
- [ ] Editors are db-native
- [ ] Confirmation copy + trigger rules implemented
- [ ] Capability-driven UI states applied

### Batch E (SQL-native polish)

- MySQL: Workbench-style schema, SQL editor, visual explain, admin panels.
- PostgreSQL: pgAdmin-style navigation, schema, extensions, query tooling.
- MSSQL: SSMS-style object explorer, query editor, execution plan viewer.
- Oracle: SQL Developer-style navigation, packages, execution plan tools.
- SQLite: lightweight DB browser, schema editor, query scratchpad.

Acceptance:

- [ ] SQL shell matches dbType conventions
- [ ] Visual explain/plan is accessible
- [ ] Admin panels follow dbType workflows
- [ ] Capability-driven UI states applied

## Phase Checklist (mark when verified)

- [ ] Batch A complete
- [ ] Batch B complete
- [ ] Batch C complete
- [ ] Batch D complete
- [ ] Batch E complete

## Progress Log (fill as work is done)

- Date:
  Batch:
  Summary:
  Verified by:

- Date: 2026-01-17
  Batch: Planning
  Summary: Aligned this plan with the shadcn UI foundation and fixed-layout/scrolling rules.
  Verified by: Manual review

- Date: 2026-01-17
  Batch: A
  Summary: Implemented MongoDB and Redis dbType-specific explorers with a shell registry, actions panels, and capability-driven states. Verification pending.
  Verified by: Pending
