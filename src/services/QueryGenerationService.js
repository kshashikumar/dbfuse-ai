const llmService = require("./LLMService");
const logger = require("../utils/logger");
const QueryOrchestrator = require("../rag/orchestrator/QueryOrchestrator");
const { compactTaskSteps } = require("../utils/compactTaskSteps");

class QueryGenerationService {
  constructor(options = {}) {
    this.orchestrator = options.orchestrator || new QueryOrchestrator();
    this.llmService = options.llmService || llmService;
  }

  async generate({
    connectionId,
    dbType,
    dbName,
    prompt,
    model,
    apiKey,
    selectedTables = [],
    dbMeta,
    enrichedContext,
    compactTaskSteps: compactSteps = false,
    llmOptions = {},
  } = {}) {
    if (!prompt) {
      throw new Error("prompt is required");
    }

    this.llmService.initialize(model, apiKey);

    const shouldUseOrchestrator =
      enrichedContext &&
      (enrichedContext.complexity !== "simple" ||
        enrichedContext.selectedStrategy === "RAGEnhancedStrategy" ||
        enrichedContext.selectedStrategy === "DecompositionStrategy");

    if (shouldUseOrchestrator) {
      logger.debug("Using QueryOrchestrator for query generation", {
        strategy: enrichedContext?.selectedStrategy,
        complexity: enrichedContext?.complexity,
      });

      const orchestratorResult = await this.orchestrator.execute({
        connectionId,
        dbType,
        dbName,
        prompt,
        model,
        apiKey,
        options: {
          useRag: true,
          includeExplanation: false,
          includeSuggestions: false,
        },
      });

      const taskSteps = compactSteps
        ? compactTaskSteps(orchestratorResult?.taskSteps)
        : orchestratorResult?.taskSteps;

      return {
        query: orchestratorResult?.query,
        source: "orchestrator",
        strategy: orchestratorResult?.strategy,
        analysis: orchestratorResult?.analysis,
        taskSteps,
      };
    }

    const query = await this.llmService.generateSQLQuery(
      dbMeta,
      dbName,
      prompt,
      dbType,
      selectedTables,
      llmOptions,
    );

    return {
      query,
      source: "llm",
    };
  }
}

module.exports = QueryGenerationService;
