# System Map (Data Flow + Sequence)

Project: DBFuse AI
Scope: UI ? API ? Strategy ? Adapter ? DB + RAG/MCP
Status: Draft

## 1) High-Level Data Flow (Overview)

User Action (UI)
?
Client Data Layer (DbApiService / BackendService)
? (HTTP: x-db-type, x-connection-id)
API Router (dbRoutes)
?
DatabaseController / DatabaseService
?
Connection Manager + Strategy (dbType)
?
Adapter (driver SDK)
?
Database / Cache / NoSQL
?
Normalized Response (documents/rows + metadata + pagination)
?
UI Rendering (Explorer/Editor/Results/Chat)

## 2) Sequence Diagrams (Text)

### 2.1 Connect + Select DB

UI -> API: POST /api/sql/connect (dbType + config)
API -> Strategy: connect(config)
API -> ConnectionManager: register connection + id
API -> UI: connectionId + database name
UI -> Storage: persist connectionId + dbType

### 2.2 Load Metadata (Databases + Tables/Collections)

UI -> API: GET /api/sql/databases (x-db-type, x-connection-id)
API -> Strategy: getDatabases()
API -> UI: { databases[], count, retrievedAt }

UI -> API: GET /api/sql/tables?dbName=... (x-db-type, x-connection-id)
API -> Strategy: getTables(dbName)
API -> UI: { tables[], count, database }

UI -> API: GET /api/sql/table-info?table=...&dbName=...
API -> Strategy: getTableInfo(dbName, table)
API -> UI: TableInfo (columns + indexes + sample docs)

### 2.3 Execute Query (SQL)

UI -> API: POST /api/sql/query { query: "SELECT ..." }
API -> Strategy: executeQuery(sql)
API -> UI: { rows, totalRows, messages, pagination }
UI -> Results Grid: render rows

### 2.4 Execute Query (NoSQL/Cache)

UI -> API: POST /api/sql/query { query: { operation, collection/table, payload... } }
API -> Strategy: executeQuery(payload)
API -> UI: { documents | rows | result }
UI -> Explorer: render documents/keys/items

### 2.5 RAG + Chat (Query Suggestion)

UI -> API: POST /api/rag/query { databaseName, prompt }
API -> RAGService: build prompt + fetch schema
RAG -> Strategy: metadata sampling (optional)
RAG -> LLM: generate query + steps
API -> UI: response + task steps
UI -> User: render NL response + steps + optional execute

## 3) Responsibility Map

### UI

- dbType routing + component registry
- capability-driven UX (disable/hide actions)
- fixed-layout scrolling, virtualized lists
- no SQL editor for NoSQL/Cache

### API Layer

- enforce dbType + connection headers
- validate operations and capability checks
- normalize errors + responses

### Strategy Layer

- normalize payloads to adapter calls
- adapter-specific logic for operations
- return normalized responses

### Adapter Layer

- driver interactions
- translate operations to SDK calls
- return raw results

### RAG/MCP

- schema enrichment + reasoning
- structured task steps
- keep execution separate from reasoning

## 4) Known Coupling Points

- BackendService uses /api/sql/\* for all dbTypes
- Strategy metadata used inconsistently across UI/Backend
- Metadata endpoints mixed for tables/collections/keys
- Query results shape varies by adapter

## 5) Target Architecture (Post-Refactor)

- Unified routes: /api/db/_ and /api/metadata/_
- Single response envelope for metadata and queries
- Capability model enforced server-side and consumed in UI
- Strategy normalization centralized in shared helpers
- UI uses registry-based shells only

## 6) Diagnostics + Observability

- Trace IDs on every request
- per-dbType query latency and error rate
- strategy-level logs for operation selection
- RAG prompt + response size metrics
