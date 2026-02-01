const crypto = require("crypto");

const { createTaskStep } = require("./TaskStepSchema");
const { buildMcpInvocation } = require("./TaskStepMapper");

class TaskPlanner {
  buildPlan({
    taskId,
    prompt,
    dbType,
    dbName,
    analysis,
    strategyName,
    query,
    selectedTables = [],
    queryAnalysis = null,
    model = null,
  } = {}) {
    const safeTaskId = taskId || this._createId();
    const now = new Date().toISOString();
    const planStepId = `${safeTaskId}-plan`;
    const executeStepId = `${safeTaskId}-execute`;
    const resultStepId = `${safeTaskId}-result`;

    const planStep = createTaskStep({
      taskId: safeTaskId,
      stepId: planStepId,
      type: "plan",
      description: "Analyze intent and select a strategy",
      dbType,
      operation: "plan",
      capabilityRequired: null,
      payload: {
        prompt,
        dbName,
        strategy: strategyName,
        selectedTables: Array.isArray(selectedTables) ? selectedTables : [],
      },
      requiresConfirmation: false,
      dependsOn: [],
      status: "done",
      result: { analysis },
      error: null,
      startedAt: now,
      finishedAt: now,
    });

    const executePayload = {
      prompt,
      dbName,
      dbType,
      model,
    };

    const mcpInvocation = buildMcpInvocation("generate_sql", {
      prompt,
      dbName,
      model,
    });
    if (mcpInvocation) {
      executePayload.mcp = mcpInvocation;
    }

    const executeStep = createTaskStep({
      taskId: safeTaskId,
      stepId: executeStepId,
      type: "execute",
      description: "Generate query draft",
      dbType,
      operation: "generate_sql",
      capabilityRequired: null,
      payload: executePayload,
      requiresConfirmation: false,
      dependsOn: [planStepId],
      status: "done",
      result: { query },
      error: null,
      startedAt: now,
      finishedAt: now,
    });

    const resultStep = createTaskStep({
      taskId: safeTaskId,
      stepId: resultStepId,
      type: "result",
      description: "Query ready for review",
      dbType,
      operation: "result",
      capabilityRequired: null,
      payload: { query },
      requiresConfirmation: false,
      dependsOn: [executeStepId],
      status: "done",
      result: { query, queryAnalysis },
      error: null,
      startedAt: now,
      finishedAt: now,
    });

    return [planStep, executeStep, resultStep];
  }

  _createId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

module.exports = TaskPlanner;
