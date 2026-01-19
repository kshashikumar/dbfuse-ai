# Database Platform Master Plan

Project: DBFuse AI
Owner: Product/Engineering
Scope: SQL + NoSQL support across backend, UI, RAG, MCP
Status: Active (phased)

## How to Use This Plan

- This is the single source of truth for delivery and verification.
- Each phase references a detailed feature plan doc.
- Mark the checklist items here only after the feature doc phase is complete and verified.

## Decisions (current)

- Ship full read/write mode for all dbTypes; use per-dbType confirmations for destructive actions.
- UI-only confirmations (no server-side confirm token).
- Keep authentication simple (user/pass only) in v1; no IAM/service accounts.
- Auto-switch native UI components based on selected dbType (no toggle).
- Default editor behavior: SQL uses Monaco; NoSQL/Cache uses db-native builders or custom UI per dbType.
- MCP must deny unsupported operations per dbType capability checks.
- Chat UX is ChatGPT/Claude-style via WebSockets; chat responses return natural-language answers.
- Raw task-step schema is internal; UI shows derived, high-level working steps inline (collapsible) and streams them as they progress.
- Chat routes all DB operations through MCP tools (schema, metadata, read/write).

## Document Index (feature plans)

- UI: `docs/PLAN_UI_NATIVE_UX.md`
- Backend + Strategy + API: `docs/PLAN_BACKEND_STRATEGY_API.md`
- RAG + MCP Agent: `docs/PLAN_RAG_MCP_AGENT.md`

## Phased Roadmap (summary)

Phase 0: UI foundation (shadcn)

- Tokenized design system + shadcn primitives
- Layout/nav refactor + fixed layout scrolling
- Core pages updated (landing, home, chat, SQL, NoSQL, settings/auth)
- No separate plan doc; foundation lives in code + this master plan

Phase 1: Platform alignment

- Capability introspection + base strategy extensions
- NoSQL metadata endpoints + response normalization
- Task-step schema + MCP capability gating

Phase 2: Database-native UI (phased batches)

- Batch A: MongoDB, Redis
- Batch B: DynamoDB, Cassandra
- Batch C: CouchDB, Cosmos DB, Firestore
- Batch D: HBase, Memcached
- Batch E (SQL-native polish): MySQL, PostgreSQL, MSSQL, Oracle, SQLite

Phase 3: RAG + Agent workflow

- Intent capture + graph-driven schema enrichment
- Multi-step task loop and per-dbType strategy selection
- Conversational chat controller + WebSocket streaming
- Response composer for consistent chat summaries (row counts + samples)
- Clarification loop + working steps UI in chat
- Working steps streaming updates (ChatGPT-style)

Phase 4: Observability + Feedback

- Telemetry + user feedback loops per dbType workflow
- Iterative UX improvements based on feedback

## Master Checklist (mark when verified)

Phase 0: UI foundation (shadcn)

- [x] Tokens + primitives updated
- [x] Layout/nav refactor complete
- [x] Core pages updated + scroll containment

Phase 1: Platform alignment

- [ ] Base strategy extensions + capability model implemented
- [ ] NoSQL metadata endpoints added (collections/collectionInfo/key patterns)
- [ ] Unified response contract enforced across adapters
- [ ] MCP capability gating for unsupported ops

Phase 2: Database-native UI (phased)

- [ ] Batch A UI delivered (MongoDB, Redis)
- [ ] Batch B UI delivered (DynamoDB, Cassandra)
- [ ] Batch C UI delivered (CouchDB, Cosmos DB, Firestore)
- [ ] Batch D UI delivered (HBase, Memcached)
- [ ] Batch E UI delivered (MySQL, PostgreSQL, MSSQL, Oracle, SQLite)

Phase 3: RAG + Agent workflow

- [ ] Intent capture + schema enrichment implemented
- [ ] NoSQL-aware strategy selection implemented
- [ ] Multi-step task loop with confirmations implemented
- [x] Chat controller + WebSocket streaming implemented
- [x] Chat UI renders natural-language responses
- [x] Chat response summaries normalize query results
- [x] Chat clarification loop + working steps UI implemented
- [x] Working steps stream live (ChatGPT-style)
- [x] MCP-backed chat execution pipeline implemented

Phase 4: Observability + Feedback

- [ ] Telemetry and feedback loops implemented
- [ ] UX improvements based on feedback applied

## Supported Databases (target)

SQL:

- MySQL
- PostgreSQL
- SQLite
- MSSQL
- Oracle

Document:

- MongoDB
- CouchDB
- Cosmos DB
- Firestore

Key-Value:

- Redis
- Memcached
- DynamoDB

Wide-Column:

- Cassandra
- HBase

## Verification Notes

- Verification is functional: confirm each phase item in the feature doc and then mark here.
- Tests are out of scope for early shipping; focus on working workflows and feedback.
