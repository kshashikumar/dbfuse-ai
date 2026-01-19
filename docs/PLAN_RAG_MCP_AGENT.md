# RAG + MCP Agent Plan

Scope: Intent capture, schema enrichment, task-step schema, MCP execution loop.
Status: Active (phased)

## How to Use This Plan

- This doc is self-contained and must be followed even without prior chat context.
- Work on one phase at a time; update the Phase Checklist as items are verified.
- Do not mark items complete until the deliverables and verification steps are met.

## Goals

- Deliver a ChatGPT/Claude-style chat experience with streaming natural-language responses.
- Use RAG + graph search to ground decisions in schema context.
- Support internal multi-step task execution without exposing steps in the chat UI.
- Stream high-level working steps in real time (ChatGPT-style progress updates).

## Dependencies

- Backend capability gating (deny unsupported ops per dbType).
- Unified response contract and normalized metadata.
- WebSocket transport in backend + UI for chat streaming.

## Current State (as-built)

- SQL-first query orchestration; no NoSQL task planning or validation.
- Schema extraction available for SQL + MongoDB + Redis only.
- Chat UI uses WebSocket transport for streaming responses.
- Chat responses are natural-language; query payloads are internal.
- Chat sessions are in-memory (graph persistence later).
- Task-step schema + planner exist; UI shows derived high-level working steps only.
- Multi-step execution loop and follow-up steps are pending.
- Deterministic chat fallbacks handle list-tables and simple select prompts.
- Query result summaries normalize strategy outputs (queries[] -> rows/columns/sample).
- Chat shows inline collapsible working steps (high-level labels).
- Working steps appear, but ChatGPT-style step-by-step streaming updates are pending.
- Clarification loop is enforced before executing ambiguous queries.
- Chat DB operations run through MCP tools (schema, metadata, read/write).

## Task-Step Schema (internal contract)

Required fields:

```
{
  taskId,
  stepId,
  type: "plan" | "execute" | "result" | "followup",
  description,
  dbType,
  operation,
  capabilityRequired,
  payload,
  requiresConfirmation,
  dependsOn: [stepId],
  status: "pending" | "running" | "done" | "failed",
  result,
  error,
  startedAt,
  finishedAt
}
```

Notes:

- `capabilityRequired` must map to adapter capabilities.
- `payload` must be compatible with adapter executeQuery payloads.
- `requiresConfirmation` triggers UI-only confirmation.
- `capabilityRequired` may be null for non-DB steps (plan/result).
- Execute steps may include MCP tool mapping in payload when available.
- Task steps are internal; chat UI should not render them.

Example (MongoDB aggregate):

```
{
  "taskId": "t-1",
  "stepId": "s-2",
  "type": "execute",
  "description": "Aggregate top 5 customers by revenue",
  "dbType": "mongodb",
  "operation": "aggregate",
  "capabilityRequired": "aggregation",
  "payload": {
    "collection": "orders",
    "pipeline": [
      { "$group": { "_id": "$customerId", "total": { "$sum": "$amount" } } },
      { "$sort": { "total": -1 } },
      { "$limit": 5 }
    ]
  },
  "requiresConfirmation": false,
  "dependsOn": ["s-1"],
  "status": "pending"
}
```

## Components and Responsibilities

- Chat Controller: REST endpoints for session create/history/feedback; bridges to WS.
- WebSocket Gateway: streams assistant responses and status to the chat UI.
- Session Store: persists chat sessions and context per connectionId/dbType.
- Intent Capture: parse user goal, constraints, dbType, and data scope.
- Schema Retrieval: use RAG + graph search for tables/collections and fields.
- Planner: generate a sequence of task steps using the schema.
- MCP Executor: run steps via MCP tools with capability gating.
- Summarizer: present natural-language responses and optional follow-ups.
- Response Composer: normalize query results and generate consistent summaries/previews.
- Step Tracker: emits high-level working steps and streaming status updates for UI consumption (not raw task schema).
- Feedback Loop: user feedback updates future strategies.

## Phase Plan

### Phase 1: Conversational Chat Transport

Goals:

- Deliver a chat-first experience with streaming responses.

Implementation Steps:

- Add a Chat controller (REST) for session create/history/feedback.
- Add a WebSocket gateway for chat streaming (session + connectionId handshake).
- Add an in-memory session store (graph store persistence later).
- Ensure chat responses return natural-language answers (no task-step UI).
- Stream high-level working steps to the UI (collapsible).
- Define a streaming step envelope (status + label + timestamp) for UI updates.
- Update the chat UI to use WebSocket streaming; editor AI generate stays HTTP.

Deliverables:

- Chat controller + WebSocket gateway wired.
- Chat UI streams assistant responses.
- Chat responses are natural-language (query payload optional for editor).
- In-memory chat session store in place.
- Step streaming envelope defined (status + label + timestamp).

Verification:

- Chat send/receive works over WebSocket.
- Natural-language payloads render in chat.
- Session reconnect works without losing context.

### Phase 2: RAG Enrichment

Goals:

- Improve schema grounding for NoSQL and caches.

Implementation Steps:

- Expand schema adapters beyond MongoDB/Redis.
- Add graph-search enrichment for NoSQL metadata.
- Include relevance scoring and context packaging for planners.

Deliverables:

- Adapter coverage for all dbTypes.
- Enriched context returned to the planner.

Verification:

- Context includes relevant collections/keys for each dbType.
- Planner uses enrichment to reduce hallucinations.

### Phase 3: dbType-Aware Strategy Selection

Goals:

- Ensure generation and validation are dbType-specific.

Implementation Steps:

- Add per-dbType strategy selection rules.
- Add validation for payload shapes and supported operations.
- Add fallback strategy when a dbType feature is unsupported.
- Normalize query results for chat summaries (rows/columns/sample across adapters).
- Add deterministic fallbacks for list-tables + simple select prompts.
- Add clarification loop before executing ambiguous requests.
- Stream working steps to the chat UI.
- Stream step updates in real time (pending -> running -> done/failed) like ChatGPT.

Deliverables:

- Strategy selection map per dbType.
- Validation errors are explicit and actionable.
- Response composer used by chat for consistent summaries.
- Step streaming contract implemented for chat with incremental updates.

Verification:

- Unsupported operations are rejected before execution.
- Planner chooses correct strategy for each dbType.
- Chat responses reflect actual row counts and sample data.
- Chat shows working steps and asks clarifying questions before executing.
- Working steps stream live as they progress (not only after completion).

### Phase 4: Multi-Step Workflows

Goals:

- Create iterative task loops and follow-ups.

Implementation Steps:

- Add follow-up step generation on partial results.
- Add confirmation prompts for destructive steps (UI-only).
- Add summary + next step suggestions.

Deliverables:

- Multi-step execution pipeline (internal).
- Follow-up steps generated when required.
- Chat UI remains natural-language with confirmations.

Verification:

- Destructive steps require confirmation.
- Follow-ups are generated based on results.

## MCP Integration Rules

- MCP must deny unsupported operations per dbType capability checks.
- MCP payloads must conform to task-step schema.
- Results feed back into RAG context for follow-up steps.
- All DB operations for chat go through MCP tools (no direct adapter calls).

## Risks and Guardrails

- Risk: Planner generates unsupported operations.
  Guardrail: capabilityRequired validation before execution.
- Risk: NoSQL schema extraction is weak.
  Guardrail: use sampling + enrichment + fallback queries.

## Phase Checklist (mark when verified)

Phase 1:

- [x] Chat controller + WebSocket streaming implemented
- [x] Chat UI renders natural-language responses

Phase 2:

- [ ] Schema adapters extended across dbTypes
- [ ] RAG enrichment feeds planner

Phase 3:

- [ ] dbType-aware strategy selection
- [ ] Payload validation and capability gating
- [x] Result normalization + deterministic chat fallbacks
- [x] Chat clarification loop + working steps UI
- [x] Working steps stream live (ChatGPT-style)
- [x] MCP-backed chat execution pipeline

Phase 4:

- [ ] Multi-step execution loop (internal)
- [ ] Follow-up steps + summaries

## Progress Log (fill as work is done)

- Date: 2026-01-16
  Phase: 1 (previous scope)
  Summary: Task-step schema + planner were added; chat UI rendering will be removed in favor of WebSocket chat.
  Verified by: Manual review
- Date: 2026-01-16
  Phase: 1
  Summary: Added chat controller + WS gateway, in-memory session store, chat service returns natural-language responses, and chat UI uses WebSocket streaming.
  Verified by: Manual review
- Date: 2026-01-17
  Phase: 3
  Summary: Normalized query result summaries for chat and added deterministic fallbacks for list tables and simple selects.
  Verified by: Manual review
- Date: 2026-01-17
  Phase: 3
  Summary: Added clarification loop, MCP-backed chat execution, and inline working steps in chat UI.
  Verified by: Manual review
- Date: 2026-01-18
  Phase: 3
  Summary: Implemented ChatGPT-style working steps streaming. Steps now stream live in real-time as they progress (pending -> running -> done) via WebSocket with visual status indicators.
  Verified by: Pending
