# DBType Onboarding Guide (End-to-End)

Project: DBFuse AI
Scope: Add a new database type (SQL / NoSQL / Cache)
Status: Draft

## 0) Checklist Summary

- [ ] Backend strategy + adapter implemented
- [ ] Strategy metadata + capability model added
- [ ] Metadata endpoints return normalized contract
- [ ] UI explorer/editor created and registered
- [ ] Confirmation rules + capability gating applied
- [ ] RAG prompt + schema mapping updated
- [ ] Docs and tests added

## 1) Backend: Strategy + Adapter

### 1.1 Add Strategy Class

Location: `src/config/strategies/`

- Create `{dbType}-strategy.js` implementing:
  - `connect(config)`
  - `disconnect()`
  - `validateConnection()`
  - `getDatabases()`
  - `getTables()` / `getCollections()`
  - `getTableInfo()` / `getCollectionInfo()`
  - `executeQuery(query, options)`

### 1.2 Register Strategy

Location: `src/config/create-strategy.js`

- Add to `strategyMap`
- Add metadata entry in `strategyMetadata`
- Ensure capability model covers operations/features

### 1.3 Normalize Operations

- Add `_normalizeQuery` to map UI payloads to adapter inputs
- Return standardized shapes:
  - `rows` for SQL-like results
  - `documents` for NoSQL-like results
  - `result` or `{ inserted, updated, deleted }` for writes

## 2) Backend: API Contracts

### 2.1 Metadata Endpoints

- `getDatabases()` returns `{ databases, count, retrievedAt }`
- `getTables()` returns `{ tables, count, database, retrievedAt }`
- `getTableInfo()` returns normalized `TableInfo`

### 2.2 Query Endpoint

- Accepts string SQL or JSON payload
- Enforce capability checks in strategy
- Return pagination where supported

### 2.3 Capability Metadata

- Ensure `/strategy-metadata` returns the new dbType entry
- Update capability checks in API if needed

## 3) Frontend: UI Components

### 3.1 Create Explorer/Editor

Location: `client/dbfuse-ai-client/src/app/features/nosql/explorers/`

- Add `{dbType}-explorer` component with:
  - ExplorerPanel (list of dbs/tables/collections)
  - DetailsPanel (schema/sample data)
  - ActionsPanel (db-native operations)
  - Confirmations for destructive actions

### 3.2 Register in Shell

Location: `client/dbfuse-ai-client/src/app/features/nosql/nosql-explorer-shell/`

- Import component in `nosql-explorer-shell.component.ts`
- Add `ngSwitchCase` in `nosql-explorer-shell.component.html`

### 3.3 Capability-Driven UI

- Use `strategyMetadata.capabilities` and `supportedFeatures`
- Disable/hide actions based on capabilities
- Ensure NoSQL editors avoid Monaco

## 4) RAG + MCP Integration

### 4.1 Strategy Metadata Consumption

- Update prompt templates for dbType if needed
- Ensure schema extraction supports dbType metadata

### 4.2 Task Steps

- Add dbType-specific step labels
- Validate `operation` names used by the strategy

## 5) Testing & Verification

- Connection: verify connect + health
- Metadata: databases/tables/info
- Query: read + write + error handling
- UI: explorer selection + action results
- Chat: ensure RAG uses dbType with capabilities

## 6) Documentation Updates

- Update `docs/PLAN_UI_NATIVE_UX.md` if UI changes made
- Update `docs/DATABASE_PLATFORM_IMPLEMENTATION_PLAN.md` if phase completed
- Add dbType entry in `README.md` supported list if applicable

## 7) Example Payload Contract (NoSQL)

```
{
  "operation": "find",
  "collection": "users",
  "filter": { "status": "active" }
}
```

## 8) Example Payload Contract (Cache)

```
{
  "operation": "get",
  "key": "session:123"
}
```

## 9) Rollback Plan

- Keep legacy endpoints until Phase 6 cleanup
- Feature-flag new UI components per dbType
- Retain old strategy metadata until verification
