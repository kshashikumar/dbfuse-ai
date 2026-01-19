# Backend Plan: Strategy, Capabilities, and APIs

Scope: Strategy contract extensions, capability gating, metadata endpoints, response normalization.
Status: Active (Phase 1 implementation present; verification pending)

## How to Use This Plan

- This doc is self-contained and must be followed even without prior chat context.
- Update the checklist only after manual verification passes.
- Tests are out of scope for early shipping; focus on working flows.

## Goals

- Extend the base strategy contract for capability discovery and validation.
- Provide NoSQL metadata endpoints aligned with NoSQL concepts.
- Normalize response shapes across adapters.
- Enforce capability gating for MCP and API operations.

## Current State (as-built)

- Strategy implementations exist for all dbTypes under `src/config/strategies`.
- `executeQuery` accepts string or object payloads.
- NoSQL metadata endpoints exist but UI may still call SQL-style aliases (`/tables`, `/table-info`).
- Capability metadata is static via `create-strategy` and needs per-dbType verification.
- Normalization hooks exist; adapter coverage needs validation.

## Base Strategy Extensions (required)

Add to the base strategy contract:

- getCapabilities(): returns supported operations, features, and limits.
- validateOperation(operation, payload): deny unsupported operations before execution.
- normalizeResult(raw): map results to the unified response contract.
- normalizeMetadata(raw): map metadata to the shared metadata contract.

Suggested capability model:

```
{
  operations: ["query", "command", "crud", "indexes", "explain"],
  features: ["pagination", "ttl", "aggregation", "transactions"],
  limits: { maxPageSize, maxScan, supportsWrite: true }
}
```

## NoSQL Metadata Endpoints

Add endpoints:

- GET /collections
- GET /collection-info
- GET /key-patterns

Maintain legacy aliases:

- GET /tables
- GET /table-info

Response requirements:

- Use normalized metadata contract for all dbTypes.
- Include dbType and database context in responses.

## Response Normalization

- Enforce the shared response contract:
  - rows, documents, keys, columns, stats, raw
- Ensure pagination/continuation tokens are mapped consistently.

### Normalized Result Contract (summary)

- `rows`: SQL row arrays.
- `documents`: NoSQL documents (Mongo/Couch/Firestore).
- `keys`: key/value entries (Redis/Memcached/DynamoDB).
- `columns`: column metadata when applicable.
- `stats`: counts, page info, durations.
- `raw`: adapter-native response for debugging.

## Capability Gating (required)

- Reject unsupported operations per dbType before adapter execution.
- MCP tools must check capabilities and deny unsupported operations.

## Verification Focus (manual)

- Validate capability gating before execution for each dbType.
- Verify legacy aliases map to normalized metadata contracts.
- Confirm pagination defaults and safe limits are enforced.

## Safety Rules (backend)

- Enforce safe limits and pagination defaults per dbType.
- Destructive confirmations are UI-only; backend validates limits only.

## Strategy Verification Checklist (manual)

Per dbType, verify:

- Connection lifecycle (connect/validate/disconnect)
- Metadata retrieval (databases, collections/tables, collection info)
- Query/command execution behavior
- CRUD operations (where supported)
- Index operations (where supported)
- Pagination/limit handling

## Phase Checklist (mark when verified)

Phase 1:

- [ ] Base strategy extensions implemented
- [ ] Capabilities exposed and used for gating
- [ ] NoSQL metadata endpoints added with legacy aliases
- [ ] Unified response normalization is enforced
- [ ] Safe limits enforced per dbType

## Progress Log (fill as work is done)

- Date:
  Phase:
  Summary:
  Verified by:

- Date: 2026-01-16
  Phase: Phase 1
  Summary: Added base strategy extensions, capability model wiring, MCP gating, NoSQL metadata endpoints, normalization hooks, and safe paging defaults.
  Verified by: Pending (manual verification required)

- Date: 2026-01-17
  Phase: Phase 1
  Summary: Updated plan details and clarified verification scope for capabilities, metadata, and normalization.
  Verified by: Manual review
