const crypto = require("crypto");
const { connectionManager } = require("../config");
const llmService = require("../services/LLMService");
const logger = require("../utils/logger");
const QueryAnalyzer = require("../rag/orchestrator/QueryAnalyzer");
const QueryOrchestrator = require("../rag/orchestrator/QueryOrchestrator");
const EmbeddingService = require("../rag/services/EmbeddingService");
const storageManager = require("../rag/storage/StorageManager");
const ChatStepTracker = require("./ChatStepTracker");
const McpToolRunner = require("./McpToolRunner");

const DEFAULT_STEP_DEFS = [
  { id: "plan", label: "Plan request" },
  { id: "clarify", label: "Clarify requirements" },
  { id: "schema", label: "Retrieve schema context" },
  { id: "rag", label: "Enrich request context" },
  { id: "generate", label: "Generate query draft" },
  { id: "execute", label: "Execute query" },
  { id: "summarize", label: "Summarize results" },
];

const STEP_TEMPLATES = {
  list_tables: [
    { id: "plan", label: "Identify request", confidence: 0.95 },
    { id: "schema", label: "Fetch table list", confidence: 0.95 },
    { id: "summarize", label: "Format response", confidence: 0.95 },
  ],
  simple_select: [
    { id: "plan", label: "Analyze simple query", confidence: 0.9 },
    { id: "generate", label: "Generate SELECT query", confidence: 0.9 },
    { id: "execute", label: "Execute query", confidence: 0.9 },
    { id: "summarize", label: "Format results", confidence: 0.9 },
  ],
  time_filter: [
    { id: "plan", label: "Detect time range", confidence: 0.85 },
    { id: "schema", label: "Verify date columns", confidence: 0.85 },
    { id: "generate", label: "Generate time-filtered query", confidence: 0.85 },
    { id: "execute", label: "Execute query", confidence: 0.85 },
    { id: "summarize", label: "Summarize results", confidence: 0.85 },
  ],
  join_query: [
    { id: "plan", label: "Identify tables to join", confidence: 0.75 },
    { id: "schema", label: "Fetch table schemas", confidence: 0.8 },
    { id: "rag", label: "Validate relationships", confidence: 0.75 },
    { id: "generate", label: "Generate JOIN query", confidence: 0.75 },
    { id: "execute", label: "Execute query", confidence: 0.8 },
    { id: "summarize", label: "Summarize results", confidence: 0.8 },
  ],
  aggregation_pipeline: [
    { id: "plan", label: "Design aggregation", confidence: 0.8 },
    { id: "schema", label: "Fetch collection schema", confidence: 0.85 },
    { id: "generate", label: "Build aggregation pipeline", confidence: 0.75 },
    { id: "execute", label: "Execute aggregation", confidence: 0.8 },
    { id: "summarize", label: "Format results", confidence: 0.85 },
  ],
  key_scan: [
    { id: "plan", label: "Identify key pattern", confidence: 0.85 },
    { id: "generate", label: "Generate key scan command", confidence: 0.85 },
    { id: "execute", label: "Scan keys", confidence: 0.9 },
    { id: "summarize", label: "Format key list", confidence: 0.9 },
  ],
  partition_query: [
    { id: "plan", label: "Identify partition key", confidence: 0.75 },
    { id: "schema", label: "Verify table schema", confidence: 0.8 },
    { id: "generate", label: "Generate partition query", confidence: 0.75 },
    { id: "execute", label: "Execute query", confidence: 0.8 },
    { id: "summarize", label: "Format results", confidence: 0.8 },
  ],
  collection_query: [
    { id: "plan", label: "Analyze collection query", confidence: 0.8 },
    { id: "schema", label: "Fetch collection info", confidence: 0.85 },
    { id: "generate", label: "Generate query", confidence: 0.8 },
    { id: "execute", label: "Execute query", confidence: 0.85 },
    { id: "summarize", label: "Format documents", confidence: 0.85 },
  ],
};

class ChatService {
  constructor(options = {}) {
    this.sqlDbTypes = new Set(["mysql2", "pg", "sqlite3", "mssql", "oracledb"]);
    this.noSqlDbTypes = new Set([
      "mongodb",
      "cassandra",
      "cosmosdb",
      "dynamodb",
      "firestore",
      "couchdb",
      "hbase",
    ]);
    this.cacheDbTypes = new Set(["redis", "memcached"]);
    this.analyzer = options.analyzer || new QueryAnalyzer();
    this.orchestrator = options.orchestrator || new QueryOrchestrator();
    this.embeddingService = options.embeddingService || new EmbeddingService();
    this.mcpRunner = options.mcpRunner || new McpToolRunner();
    this.storageManager = options.storageManager || storageManager;
    this.enrichmentCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  async enrichQuery({ connectionId, dbType, dbName, prompt, options = {} } = {}) {
    if (!connectionId) throw new Error("connectionId is required");
    if (!dbType) throw new Error("dbType is required");
    if (!prompt) throw new Error("prompt is required");

    const normalizedDbType = String(dbType).toLowerCase();
    // CRITICAL FIX: Include prompt hash in cache key so different queries don't return same cached result
    const promptHash = prompt.toLowerCase().replace(/\s+/g, "_").substring(0, 50);
    const cacheKey = `${connectionId}:${dbName}:${normalizedDbType}:${promptHash}`;
    const warnings = [];

    // Check cache unless explicitly skipped
    if (!options.skipCache) {
      const cached = this._getCachedContext(cacheKey);
      if (cached) {
        logger.info("⚡ Enrichment cache HIT", {
          connectionId,
          dbName,
          prompt: prompt.substring(0, 60),
          cachedIntent: cached.queryIntent,
          cachedTopEntity: cached.relevantEntities?.[0]?.name,
        });
        return { ...cached, fromCache: true };
      }
    }

    logger.info("Enriching query", {
      connectionId,
      dbType: normalizedDbType,
      dbName,
      promptLength: prompt.length,
    });

    // Phase 1: AI-powered intent detection with timeout
    let queryIntent;
    try {
      queryIntent = await Promise.race([
        this._detectQueryIntent(prompt, normalizedDbType),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Intent detection timeout")), 5000),
        ),
      ]);
      logger.debug("Query intent detected", {
        intent: queryIntent.type,
        confidence: queryIntent.confidence,
        recommendedStrategy: queryIntent.recommendedStrategy,
      });
    } catch (error) {
      logger.warn("AI intent detection failed, using fallback", { error: error?.message });
      warnings.push("Using simplified query analysis");
      // Fallback to basic pattern matching
      const lowerPrompt = prompt.toLowerCase();
      if (lowerPrompt.includes("show tables") || lowerPrompt.includes("list tables")) {
        queryIntent = {
          type: "list_tables",
          confidence: 0.8,
          template: "list_tables",
          recommendedStrategy: "DirectSQLStrategy",
        };
      } else if (lowerPrompt.includes("select") && lowerPrompt.split(" ").length < 10) {
        queryIntent = {
          type: "simple_select",
          confidence: 0.6,
          template: "simple_select",
          recommendedStrategy: "DirectSQLStrategy",
        };
      } else {
        queryIntent = {
          type: "complex_query",
          confidence: 0.5,
          template: null,
          recommendedStrategy: "RAGEnhancedStrategy",
        };
      }
    }

    // Use template steps if high confidence intent
    if (
      queryIntent.confidence >= 0.85 &&
      queryIntent.template &&
      STEP_TEMPLATES[queryIntent.template]
    ) {
      const enrichedContext = {
        queryIntent: queryIntent.type,
        confidence: queryIntent.confidence,
        complexity: "simple",
        selectedStrategy: "DirectSQLStrategy",
        plannedSteps: STEP_TEMPLATES[queryIntent.template],
        availableEntities: [],
        relevantEntities: [],
        capabilities: {},
        phase: "quick",
        timestamp: new Date().toISOString(),
      };

      logger.info("🎉 ENRICHMENT COMPLETE", {
        queryIntent: enrichedContext.queryIntent,
        topEntity: enrichedContext.relevantEntities?.[0]?.name,
        allRelevantEntities: enrichedContext.relevantEntities?.map((e) => e.name),
        complexity: enrichedContext.complexity,
        strategy: enrichedContext.selectedStrategy,
        confidence: enrichedContext.confidence,
      });

      this._setCachedContext(cacheKey, enrichedContext);
      return enrichedContext;
    }

    // Phase 2: Fetch available entities
    logger.info("🔬 PHASE 2: Fetching available entities");
    const connectionInfo = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;

    let availableEntities = [];
    try {
      const entitiesResult = await this.mcpRunner.run("get_tables", {
        connectionId,
        dbName: currentDb,
      });
      availableEntities = this._normalizeTableNames(entitiesResult?.tables || []);
      logger.info("✅ PHASE 2 Complete: Entities fetched", {
        tableCount: availableEntities.length,
        tables: availableEntities,
      });
    } catch (error) {
      logger.warn("Failed to fetch entities", { error: error?.message });
      warnings.push("Limited context available - could not fetch database entities");
      availableEntities = [];
    }

    // Phase 3: Run query analysis
    const analysis = this.analyzer.analyze(prompt);

    // Phase 4: Select relevant entities using embeddings with scores
    const rankedTables = this._rankTablesByEmbedding(prompt, availableEntities);
    const relevantEntities = rankedTables.slice(0, 5).map((entry) => ({
      name: entry.name,
      type: this._getEntityType(normalizedDbType),
      score: entry.score,
    }));

    logger.info("🔍 Entity ranking results", {
      prompt: prompt.substring(0, 80),
      allTables: availableEntities,
      rankedTop5: rankedTables
        .slice(0, 5)
        .map((e) => ({ name: e.name, score: e.score.toFixed(4) })),
      selectedEntities: relevantEntities.map((e) => ({ name: e.name, score: e.score.toFixed(4) })),
    });

    // Phase 5: Get strategy capabilities with error handling
    let strategyMetadata = null;
    let capabilities = { type: "unknown", operations: [], features: [] };
    try {
      const { getStrategyMetadata } = require("../config/create-strategy");
      strategyMetadata = getStrategyMetadata ? getStrategyMetadata(normalizedDbType) : null;
      if (strategyMetadata) {
        capabilities = {
          type: strategyMetadata.type || "sql",
          operations: strategyMetadata.capabilities || [],
          features: strategyMetadata.supportedFeatures || [],
        };
      }
    } catch (error) {
      logger.warn("Failed to fetch strategy metadata", { error: error?.message });
      warnings.push("Using default database capabilities");
      // Use default capabilities based on dbType
      if (this.sqlDbTypes.has(normalizedDbType)) {
        capabilities = {
          type: "sql",
          operations: ["SELECT", "INSERT", "UPDATE", "DELETE"],
          features: ["transactions"],
        };
      } else if (this.noSqlDbTypes.has(normalizedDbType)) {
        capabilities = {
          type: "nosql",
          operations: ["find", "insert", "update", "delete"],
          features: ["aggregation"],
        };
      }
    }

    // Phase 6: Select strategy with error handling
    let selectedStrategy = queryIntent.recommendedStrategy;
    let selectionSource = "AI";

    try {
      const StrategySelector = require("../rag/orchestrator/StrategySelector");
      const selector = new StrategySelector();

      // Validate AI recommendation against available strategies
      if (!selector.isStrategyAvailable(selectedStrategy)) {
        logger.debug("AI recommended unavailable strategy", {
          recommended: selectedStrategy,
          available: selector.getAvailableStrategies(),
        });

        selectedStrategy = selector.select({
          analysis,
          context: { tables: relevantEntities.map((t) => ({ name: t })) },
          queryIntent,
        });
        selectionSource = "StrategySelector";
      }

      logger.debug("Strategy selected", {
        strategy: selectedStrategy,
        source: selectionSource,
        availableStrategies: selector.getAvailableStrategies(),
      });
    } catch (error) {
      logger.warn("Strategy selection failed, using default", { error: error?.message });
      warnings.push("Using default query strategy");
      // Fallback to safe default
      selectedStrategy = "DirectSQLStrategy";
      selectionSource = "Fallback";
    }

    // Phase 7: Query history learning
    let similarQueries = [];
    let historicalPatterns = null;
    try {
      await this.storageManager.initialize();
      const historyStore = this.storageManager.getQueryHistoryStore();
      const recentHistory = await historyStore.listRecent(50);

      similarQueries = await this._findSimilarQueries(prompt, recentHistory, normalizedDbType);
      if (similarQueries.length > 0) {
        logger.debug("Found similar queries in history", { count: similarQueries.length });
        historicalPatterns = this._extractPatterns(similarQueries, normalizedDbType);
      }
    } catch (error) {
      logger.warn("Query history lookup failed", { error: error?.message });
    }

    // Phase 8: Get planned steps (use templates or LLM)
    let plannedSteps = [];
    if (queryIntent.template && STEP_TEMPLATES[queryIntent.template]) {
      plannedSteps = STEP_TEMPLATES[queryIntent.template];
    } else {
      plannedSteps = this._inferStepsFromAnalysis(analysis, selectedStrategy);
    }

    // Phase 9: Calculate confidence scores for steps
    const overallConfidence = this._calculateStepConfidence({
      queryIntent: queryIntent.type,
      complexity: analysis.complexity,
      entityMatch: relevantEntities.length > 0,
      historicalSuccess: historicalPatterns?.successRate,
      steps: plannedSteps,
    });

    // Update step confidence scores
    plannedSteps = plannedSteps.map((step, index) => ({
      ...step,
      confidence: overallConfidence.stepScores[index] || step.confidence || 0.7,
    }));

    // Check if clarification is needed
    const needsClarification = overallConfidence.overall < 0.5 && relevantEntities.length === 0;

    const enrichedContext = {
      queryIntent: queryIntent.type,
      confidence: overallConfidence.overall,
      reasoning: queryIntent.reasoning,
      complexity: analysis.complexity,
      selectedStrategy,
      alternativeStrategies: this._getAlternativeStrategies(selectedStrategy),
      plannedSteps,
      availableEntities,
      relevantEntities, // Already in correct format with { name, type, score }
      capabilities,
      similarQueries,
      historicalPatterns,
      needsClarification,
      fallbackUsed: warnings.length > 0,
      warnings: warnings.length > 0 ? warnings : undefined,
      phase: "semantic",
      timestamp: new Date().toISOString(),
    };

    this._setCachedContext(cacheKey, enrichedContext);
    logger.info("🎉 ENRICHMENT COMPLETE", {
      prompt: prompt.substring(0, 80),
      queryIntent: queryIntent.type,
      strategy: selectedStrategy,
      entitiesFound: availableEntities.length,
      topRelevantEntity: relevantEntities[0]?.name,
      allRelevantEntities: relevantEntities.map((e) => ({
        name: e.name,
        score: e.score.toFixed(3),
      })),
    });

    return enrichedContext;
  }

  _getCachedContext(cacheKey) {
    const entry = this.enrichmentCache.get(cacheKey);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > this.cacheTTL) {
      this.enrichmentCache.delete(cacheKey);
      return null;
    }

    return entry.context;
  }

  _setCachedContext(cacheKey, context) {
    this.enrichmentCache.set(cacheKey, {
      context,
      timestamp: Date.now(),
    });
  }

  _getAlternativeStrategies(selectedStrategy) {
    const StrategySelector = require("../rag/orchestrator/StrategySelector");
    const selector = new StrategySelector();
    const available = selector.getAvailableStrategies();

    const descriptions = {
      DirectSQLStrategy: "Simple direct query execution",
      RAGEnhancedStrategy: "Context-enriched query with RAG",
      DecompositionStrategy: "Break down complex queries",
      ExplanationStrategy: "Explain query or results",
      SuggestionStrategy: "Suggest alternative approaches",
    };

    return available
      .filter((name) => name !== selectedStrategy)
      .map((name) => ({
        name,
        description: descriptions[name] || "Query execution strategy",
      }));
  }

  _inferStepsFromAnalysis(analysis, strategy) {
    const steps = [];

    steps.push({ id: "plan", label: "Analyze request", confidence: 0.8 });

    if (analysis.hasJoins || analysis.hasAggregation) {
      steps.push({ id: "schema", label: "Retrieve schemas", confidence: 0.8 });
    }

    if (strategy === "RAGEnhancedStrategy") {
      steps.push({ id: "rag", label: "Enrich context", confidence: 0.75 });
    }

    if (strategy === "ExplanationStrategy") {
      steps.push({ id: "explain", label: "Generate explanation", confidence: 0.85 });
      return steps;
    }

    if (strategy === "SuggestionStrategy") {
      steps.push({ id: "analyze", label: "Analyze alternatives", confidence: 0.8 });
      steps.push({ id: "suggest", label: "Generate suggestions", confidence: 0.8 });
      return steps;
    }

    steps.push({ id: "generate", label: "Generate query", confidence: 0.7 });
    steps.push({ id: "execute", label: "Execute query", confidence: 0.8 });
    steps.push({ id: "summarize", label: "Format results", confidence: 0.8 });

    return steps;
  }

  _getEntityType(dbType) {
    const normalized = String(dbType || "").toLowerCase();
    if (this.sqlDbTypes.has(normalized)) return "table";
    if (normalized === "mongodb" || normalized === "firestore" || normalized === "cosmosdb")
      return "collection";
    if (normalized === "cassandra") return "table";
    if (normalized === "dynamodb" || normalized === "hbase") return "table";
    if (this.cacheDbTypes.has(normalized)) return "keyspace";
    return "table";
  }

  async _findSimilarQueries(prompt, history, dbType) {
    if (!history || history.length === 0) return [];

    const promptLower = prompt.toLowerCase();
    const promptWords = new Set(promptLower.split(/\s+/).filter((w) => w.length > 2));

    const similarities = history.map((entry) => {
      const queryLower = (entry.nlQuery || "").toLowerCase();
      const queryWords = new Set(queryLower.split(/\s+/).filter((w) => w.length > 2));

      // Calculate Jaccard similarity
      const intersection = new Set([...promptWords].filter((w) => queryWords.has(w)));
      const union = new Set([...promptWords, ...queryWords]);
      const similarity = union.size > 0 ? intersection.size / union.size : 0;

      return {
        ...entry,
        similarity,
      };
    });

    // Filter by threshold and sort by similarity
    const threshold = 0.4; // Lower than 0.7 for more matches
    return similarities
      .filter((s) => s.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .map(({ similarity, ...entry }) => ({
        prompt: entry.nlQuery,
        query: entry.generatedQuery,
        success: entry.success,
        executionTime: entry.executionTime,
        feedback: entry.feedback,
        similarity,
      }));
  }

  _extractPatterns(similarQueries, dbType) {
    if (!similarQueries || similarQueries.length === 0) return null;

    const successful = similarQueries.filter((q) => q.success);
    if (successful.length === 0) return null;

    // Calculate average execution time for complexity estimation
    const avgExecutionTime =
      successful.reduce((sum, q) => sum + (q.executionTime || 0), 0) / successful.length;
    const estimatedComplexity =
      avgExecutionTime > 1000 ? "complex" : avgExecutionTime > 500 ? "medium" : "simple";

    // Extract common query patterns based on dbType
    const patterns = [];
    const normalized = String(dbType || "").toLowerCase();

    if (this.sqlDbTypes.has(normalized)) {
      // SQL patterns: extract common WHERE clauses, JOINs, etc.
      successful.forEach((q) => {
        const query = q.query || "";
        if (/WHERE\s+status\s*=\s*['"]active['"]/i.test(query)) {
          patterns.push({ type: "filter", field: "status", value: "active" });
        }
        if (/JOIN/i.test(query)) {
          patterns.push({ type: "join", detected: true });
        }
        if (/GROUP BY/i.test(query)) {
          patterns.push({ type: "aggregation", detected: true });
        }
      });
    } else if (normalized === "mongodb") {
      // MongoDB patterns: extract common filters
      successful.forEach((q) => {
        const query = q.query || "";
        if (/\{\s*status\s*:\s*['"]active['"]\s*\}/i.test(query)) {
          patterns.push({ type: "filter", field: "status", value: "active" });
        }
        if (/\$lookup/i.test(query)) {
          patterns.push({ type: "lookup", detected: true });
        }
        if (/\$group/i.test(query)) {
          patterns.push({ type: "aggregation", detected: true });
        }
      });
    }

    // Deduplicate patterns
    const uniquePatterns = Array.from(
      new Map(patterns.map((p) => [JSON.stringify(p), p])).values(),
    );

    return {
      avgExecutionTime,
      estimatedComplexity,
      successRate: successful.length / similarQueries.length,
      patterns: uniquePatterns,
      sampleQueries: successful.slice(0, 3).map((q) => ({
        prompt: q.prompt,
        query: q.query,
      })),
    };
  }

  _calculateStepConfidence({ queryIntent, complexity, entityMatch, historicalSuccess, steps }) {
    // Base confidence factors
    let entityScore = 0.5; // Default
    if (entityMatch === true) {
      entityScore = 1.0; // Exact entity match
    } else if (entityMatch === "semantic") {
      entityScore = 0.7; // Semantic match
    } else if (entityMatch === "fuzzy") {
      entityScore = 0.4; // Fuzzy match
    }

    // Complexity-based confidence
    const complexityScores = {
      simple: 0.9,
      medium: 0.7,
      complex: 0.5,
    };
    const complexityScore = complexityScores[complexity] || 0.6;

    // Historical success rate (if available)
    const historicalScore = historicalSuccess !== undefined ? historicalSuccess : 0.7;

    // Calculate overall confidence (weighted average)
    const overall = entityScore * 0.3 + complexityScore * 0.4 + historicalScore * 0.3;

    // Calculate per-step confidence
    const stepScores = steps.map((step, index) => {
      let stepConfidence = overall;

      // Adjust based on step type
      if (step.id === "plan" || step.id === "schema") {
        stepConfidence = Math.min(stepConfidence + 0.1, 1.0); // Higher confidence for planning/schema
      } else if (step.id === "generate") {
        stepConfidence = Math.max(stepConfidence - 0.1, 0.3); // Lower confidence for generation
      } else if (step.id === "execute") {
        stepConfidence = Math.min(stepConfidence + 0.05, 1.0); // Slightly higher for execution
      }

      // Adjust based on position (later steps inherit uncertainty)
      const positionPenalty = index * 0.02;
      stepConfidence = Math.max(stepConfidence - positionPenalty, 0.3);

      return Math.min(Math.max(stepConfidence, 0.0), 1.0);
    });

    return {
      overall: Math.min(Math.max(overall, 0.0), 1.0),
      stepScores,
      factors: {
        entityScore,
        complexityScore,
        historicalScore,
      },
    };
  }

  async generateResponse({
    connectionId,
    dbType,
    dbName,
    prompt,
    model,
    apiKey,
    pageSize,
    requestId,
    onStep,
    clarificationContext,
  } = {}) {
    const startedAt = Date.now();
    if (!connectionId) {
      throw new Error("connectionId is required");
    }
    if (!dbType) {
      throw new Error("dbType is required");
    }
    if (!prompt) {
      throw new Error("prompt is required");
    }

    const normalizedDbType = String(dbType).toLowerCase();

    if (!this.sqlDbTypes.has(normalizedDbType)) {
      return {
        queryId: null,
        query: "",
        responseText:
          "Chat to DB is currently available for SQL databases only. Switch to a SQL connection to continue.",
        queryAnalysis: null,
        resultSummary: null,
        executionError: null,
        steps: [],
      };
    }

    const connectionInfo = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;
    if (!currentDb) {
      throw new Error("Unable to determine target database");
    }

    logger.info("Chat generate started", {
      requestId,
      connectionId,
      dbType: normalizedDbType,
      dbName: currentDb,
      promptLength: String(prompt || "").length,
    });

    llmService.initialize(model, apiKey);

    const tracker = new ChatStepTracker(onStep);

    // Phase 1: Enrich query context (optional but recommended)
    let enrichedContext = null;
    try {
      tracker.addStep({ id: "enrich", label: "Analyze query", status: "running" });
      enrichedContext = await this.enrichQuery({
        connectionId,
        dbType: normalizedDbType,
        dbName: currentDb,
        prompt,
      });
      tracker.setStatus(
        "enrich",
        "done",
        `Intent: ${enrichedContext.queryIntent}, Strategy: ${enrichedContext.selectedStrategy}`,
      );
      logger.info("✅ Query enriched successfully", {
        intent: enrichedContext.queryIntent,
        strategy: enrichedContext.selectedStrategy,
        entities: enrichedContext.relevantEntities?.map((e) => ({ name: e.name, score: e.score })),
        complexity: enrichedContext.complexity,
        confidence: enrichedContext.confidence,
      });
    } catch (enrichError) {
      tracker.setStatus("enrich", "done", "Using basic analysis");
      logger.warn("Query enrichment failed, continuing without enrichment", {
        error: enrichError?.message,
      });
    }

    // Phase 2: Plan steps with enriched context
    tracker.addStep({ id: "plan", label: "Planning request", status: "running" });
    const plan = await this._planSteps({
      prompt,
      dbType: normalizedDbType,
      dbName: currentDb,
      clarificationContext,
      enrichedContext,
    });
    this._applyPlanSteps(tracker, plan.steps);
    tracker.setStatus("plan", "done");

    if (plan.needsClarification && !clarificationContext?.answer) {
      tracker.addStep({ id: "clarify", label: "Clarify requirements", status: "pending" });
      tracker.setStatus(
        "clarify",
        "pending",
        plan.clarificationQuestion || "Awaiting clarification.",
      );
      return {
        queryId: null,
        query: "",
        responseText: null,
        clarificationQuestion: plan.clarificationQuestion || "Could you clarify the request?",
        queryAnalysis: null,
        resultSummary: null,
        executionError: null,
        steps: tracker.list(),
      };
    }

    // Use AI-determined intent from enrichedContext
    // If enrichment failed, the AI already has regex fallback built-in via _fallbackIntentDetection
    const intent = enrichedContext?.queryIntent
      ? {
          type: enrichedContext.queryIntent,
          tableName: enrichedContext.relevantEntities?.[0]?.name || null,
        }
      : { type: "general" }; // This should rarely happen since enrichQuery has robust fallbacks

    logger.info("🎯 Intent determined", {
      type: intent.type,
      tableName: intent.tableName,
      fromEnrichment: !!enrichedContext,
    });

    const analysis = this.analyzer.analyze(prompt);

    tracker.addStep({ id: "schema", label: "Retrieve schema context", status: "running" });
    const tablesPayload = await this.mcpRunner.run("get_tables", {
      connectionId,
      dbName: currentDb,
    });
    const tableNames = this._normalizeTableNames(tablesPayload?.tables || []);
    tracker.setStatus(
      "schema",
      "done",
      tableNames.length ? `Found ${tableNames.length} tables.` : "No tables found.",
    );

    if (intent.type === "list_tables") {
      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
      const responseText = this._formatTableListResponse(tableNames);
      tracker.setStatus("summarize", "done");
      this._markSkippedSteps(tracker, ["rag", "generate", "execute"]);
      return {
        queryId: null,
        query: "",
        responseText,
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: null,
        steps: tracker.list(),
      };
    }

    tracker.addStep({ id: "rag", label: "Enrich request context", status: "running" });

    // CRITICAL FIX: Prioritize AI-detected entities over embedding similarity
    const selectedTables =
      enrichedContext?.relevantEntities?.length > 0
        ? enrichedContext.relevantEntities.map((e) => e.name).slice(0, 8)
        : this._selectRelevantTables({
            prompt,
            tableNames,
            limit: 8,
          });

    logger.info("📊 Tables selected", {
      prompt: prompt.substring(0, 50),
      selectedTables,
      fromAI: enrichedContext?.relevantEntities?.length > 0,
      allAvailable: tableNames,
    });

    tracker.setStatus(
      "rag",
      "done",
      selectedTables.length ? `Selected ${selectedTables.length} tables.` : "No tables selected.",
    );

    if (selectedTables.length === 0) {
      tracker.addStep({ id: "clarify", label: "Clarify requirements", status: "pending" });
      tracker.setStatus("clarify", "pending", "Need a specific table or entity to continue.");
      return {
        queryId: null,
        query: "",
        responseText: null,
        clarificationQuestion:
          "I couldn't identify which table to use. Which table or entity should I query?",
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: null,
        steps: tracker.list(),
      };
    }

    const tableInfoList = [];
    if (selectedTables.length > 0) {
      tracker.setStatus("schema", "running", "Fetching table details.");
      const schemaStart = Date.now();

      // PERFORMANCE FIX: Fetch all tables in parallel instead of sequentially
      tableInfoList.push(
        ...(await Promise.all(
          selectedTables.map((tableName) =>
            this.mcpRunner.run("get_table_info", {
              connectionId,
              dbName: currentDb,
              tableName,
            }),
          ),
        )),
      );

      const schemaTime = Date.now() - schemaStart;
      logger.info(`⚡ Schema fetched in ${schemaTime}ms`, {
        tableCount: tableInfoList.length,
        parallel: true,
      });

      tracker.setStatus("schema", "done", `Loaded ${tableInfoList.length} tables.`);
    }

    if (intent.type === "simple_select") {
      tracker.addStep({ id: "generate", label: "Generate query draft", status: "done" });
      const limit = Number.isFinite(Number(pageSize)) ? Number(pageSize) : 10;

      // CRITICAL FIX: Fallback to first selected table if intent.tableName is null
      const targetTable = intent.tableName || selectedTables[0];

      logger.info("⚡ Using simple_select fast path", {
        intentTable: intent.tableName,
        fallbackTable: selectedTables[0],
        finalTable: targetTable,
        allSelectedTables: selectedTables,
      });

      // Use LIMIT + 1 pattern: query for limit+1 rows to detect if there are more
      // This is efficient even for tables with millions of rows
      const queryLimit = limit + 1;
      const query = this._buildSimpleSelectQuery(normalizedDbType, targetTable, queryLimit);

      logger.info("🔍 EXECUTING QUERY", {
        selectQuery: query,
        targetTable,
        requestedLimit: limit,
        actualLimit: queryLimit,
        prompt: prompt.substring(0, 60),
      });

      tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
      await this.mcpRunner.run("switch_database", { connectionId, dbName: currentDb });

      // Execute SELECT query with LIMIT + 1
      const execResult = await this.mcpRunner.run("execute_query", { connectionId, query });

      logger.info("🔍 EXEC RESULT STRUCTURE", {
        hasResult: !!execResult?.result,
        hasRows: !!execResult?.rows,
        hasResultRows: !!execResult?.result?.rows,
        rowCountDirect: execResult?.rows?.length,
        rowCountNested: execResult?.result?.rows?.length,
        keys: Object.keys(execResult || {}),
        resultKeys: execResult?.result ? Object.keys(execResult.result) : [],
      });

      const resultSummary = this._summarizeResult(execResult?.result || execResult);

      // Detect pagination using LIMIT + 1 pattern
      const hasMoreRows = resultSummary.rowCount > limit;

      logger.info("📊 Pagination Detection", {
        rowCountReturned: resultSummary.rowCount,
        requestedLimit: limit,
        queryLimit,
        hasMoreRows,
      });

      if (hasMoreRows) {
        // Trim extra row and mark that more rows exist
        resultSummary.rowCount = limit;
        resultSummary.sampleRows = resultSummary.sampleRows?.slice(0, limit);
        resultSummary.hasMore = true;

        // Try to get approximate count for better UX (fast metadata query)
        resultSummary.approximateTotal = await this._getApproximateRowCount(
          connectionId,
          normalizedDbType,
          currentDb,
          targetTable,
        );

        logger.info("📈 Pagination Result (More Rows)", {
          trimmedRowCount: resultSummary.rowCount,
          hasMore: resultSummary.hasMore,
          approximateTotal: resultSummary.approximateTotal,
        });
      } else {
        resultSummary.hasMore = false;
        resultSummary.exactTotal = resultSummary.rowCount;

        logger.info("✅ Pagination Result (All Rows)", {
          exactTotal: resultSummary.exactTotal,
          hasMore: resultSummary.hasMore,
        });
      }

      tracker.setStatus("execute", "done");
      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });

      // Build structured table data for side panel display
      const tableData = this._buildTableDataResponse({
        tableName: targetTable,
        resultSummary,
        execResult: execResult?.result || execResult,
        query,
        hasMore: resultSummary.hasMore,
        approximateTotal: resultSummary.approximateTotal,
        exactTotal: resultSummary.exactTotal,
      });

      logger.info("📦 TABLE DATA CREATED (simple_select)", {
        hasTableData: !!tableData,
        tableName: tableData?.tableName,
        rowCount: tableData?.rows?.length,
        columnCount: tableData?.columns?.length,
      });

      const responseText = this._buildDeterministicResponse({
        tableName: targetTable,
        resultSummary,
        executionError: null,
      });
      tracker.setStatus("summarize", "done");

      const totalTime = Date.now() - startedAt;
      logger.info(`✅ Chat generate used simple select (${totalTime}ms)`, {
        requestId,
        durationMs: totalTime,
        query,
        table: targetTable,
      });

      logger.info("🚀 RETURNING FROM ENRICH QUERY", {
        hasTableData: !!tableData,
        tableName: tableData?.tableName,
        rowCount: tableData?.rows?.length,
        columnCount: tableData?.columns?.length,
      });

      return {
        queryId: null,
        query,
        responseText,
        queryAnalysis: analysis,
        resultSummary,
        executionError: null,
        steps: tracker.list(),
        tableData, // NEW: Structured data for side panel display
      };
    }

    const dbMeta = this._buildDbMeta(currentDb, tableInfoList);

    tracker.addStep({ id: "generate", label: "Generate query draft", status: "running" });
    let query;
    let strategyUsed = null;
    try {
      // Use QueryOrchestrator for strategy-based execution if enrichment context available
      if (enrichedContext && enrichedContext.complexity !== "simple") {
        logger.debug("Using QueryOrchestrator for query generation", {
          strategy: enrichedContext.selectedStrategy,
          complexity: enrichedContext.complexity,
        });

        const orchestratorResult = await this.orchestrator.execute({
          connectionId,
          dbType: normalizedDbType,
          dbName: currentDb,
          prompt: this._buildPromptWithClarification(prompt, clarificationContext),
          model,
          apiKey,
          options: {
            useRag: true,
            includeExplanation: false,
            includeSuggestions: false,
          },
        });

        query = orchestratorResult.query;
        strategyUsed = orchestratorResult.strategy;

        // Add strategy info to tracker
        tracker.setStatus("generate", "done", `Strategy: ${strategyUsed}`);
      } else {
        // Fallback to direct LLM call for simple queries
        query = await llmService.generateSQLQuery(
          dbMeta,
          currentDb,
          this._buildPromptWithClarification(prompt, clarificationContext),
          normalizedDbType,
          selectedTables,
        );
        tracker.setStatus("generate", "done");
      }

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new Error("Generated query is empty or invalid");
      }
    } catch (error) {
      tracker.setStatus("generate", "failed", error?.message || "Query generation failed");
      logger.error("Query generation failed", { requestId, error: error?.message || error });
      throw error;
    }

    tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
    let execResult;
    try {
      await this.mcpRunner.run("switch_database", { connectionId, dbName: currentDb });
      execResult = await this.mcpRunner.run("execute_query", { connectionId, query });
      const resultSummary = this._summarizeResult(execResult?.result || execResult);
      tracker.setStatus(
        "execute",
        "done",
        resultSummary?.rowCount != null ? `Rows: ${resultSummary.rowCount}` : null,
      );

      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
      const responseText = await this._buildNaturalLanguageResponse({
        prompt: this._buildPromptWithClarification(prompt, clarificationContext),
        dbType: normalizedDbType,
        dbName: currentDb,
        query,
        queryAnalysis: analysis,
        resultSummary,
        executionError: null,
        requestId,
      });
      tracker.setStatus("summarize", "done");

      logger.info("Chat generate completed", {
        requestId,
        durationMs: Date.now() - startedAt,
      });

      // Build structured table data for side panel display
      const tableData = this._buildTableDataResponse({
        tableName: intent.tableName || selectedTables[0] || "result",
        resultSummary,
        execResult,
        query,
        hasMore: false, // Regular path doesn't use LIMIT+1 pattern yet
        approximateTotal: null,
        exactTotal: resultSummary?.rowCount,
      });

      return {
        queryId: this._createId(),
        query,
        responseText,
        queryAnalysis: analysis,
        resultSummary,
        executionError: null,
        steps: tracker.list(),
        tableData, // NEW: Structured data for side panel display
      };
    } catch (error) {
      tracker.setStatus("execute", "failed", error?.message || "Query execution failed");
      logger.error("Query execution failed", {
        requestId,
        query,
        error: error?.message || error,
        stack: error?.stack,
      });
      throw error;
    }
  }

  async _planSteps({ prompt, dbType, dbName, clarificationContext, enrichedContext } = {}) {
    const normalized = String(dbType || "").toLowerCase();
    const dbCategory = this.sqlDbTypes.has(normalized)
      ? "SQL"
      : this.noSqlDbTypes.has(normalized)
        ? "NoSQL"
        : this.cacheDbTypes.has(normalized)
          ? "Cache"
          : "Unknown";

    const system = [
      "You are a planner for a database assistant supporting SQL, NoSQL, and Cache databases.",
      `Current database type: ${dbType} (${dbCategory}).`,
      enrichedContext
        ? `Query intent: ${enrichedContext.queryIntent}, Complexity: ${enrichedContext.complexity}, Strategy: ${enrichedContext.selectedStrategy}.`
        : "",
      enrichedContext?.capabilities?.operations?.length
        ? `Available capabilities: ${enrichedContext.capabilities.operations.join(", ")}.`
        : "",
      enrichedContext?.availableEntities?.length
        ? `Available entities: ${enrichedContext.availableEntities.slice(0, 5).join(", ")}${enrichedContext.availableEntities.length > 5 ? "..." : ""}.`
        : "",
      "",
      "Database-specific operations:",
      "- SQL: SELECT, JOIN, GROUP BY, aggregate functions, views, procedures",
      "- MongoDB: find(), aggregate(), $match, $group, $lookup pipelines",
      "- Redis: GET, SET, SCAN, keys with patterns, TTL operations",
      "- Cassandra/DynamoDB: partition key queries, range queries, GSI/LSI",
      "- Firestore/CosmosDB: collection queries, document filters, subcollections",
      "",
      "Return STRICT JSON with fields:",
      "{",
      '  "needsClarification": boolean,',
      '  "clarificationQuestion": string|null,',
      '  "steps": [',
      "    {",
      '      "id": "plan|clarify|schema|rag|generate|execute|summarize|explain|suggest",',
      '      "label": "descriptive label specific to database type and operation",',
      '      "reasoning": "brief explanation why this step is needed"',
      "    }",
      "  ]",
      "}",
      "",
      "Step guidelines:",
      "- Use 'explain' step for ExplanationStrategy queries",
      "- Use 'suggest' step for SuggestionStrategy queries",
      "- For NoSQL, use dbType-specific terminology (collections, documents, pipelines)",
      "- Include 'schema' step only if querying structure (tables/collections)",
      "- Include 'rag' step for complex queries needing context enrichment",
      "- Skip unnecessary steps based on query intent and complexity",
      "",
      "If clarification was already provided, set needsClarification=false.",
      "Ask for clarification only if the request is ambiguous enough to block execution.",
      "Do not include any text outside JSON.",
    ]
      .filter(Boolean)
      .join(" ");

    const payload = {
      prompt,
      dbType: normalized,
      dbCategory,
      dbName,
      clarification: clarificationContext?.answer || null,
      context: enrichedContext
        ? {
            intent: enrichedContext.queryIntent,
            complexity: enrichedContext.complexity,
            strategy: enrichedContext.selectedStrategy,
            entitiesAvailable: enrichedContext.availableEntities?.length || 0,
            capabilities: enrichedContext.capabilities?.operations || [],
          }
        : null,
    };

    try {
      const response = await llmService.callWithTimeout(
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Plan steps for this database query:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        8000,
        "Planning timed out.",
      );

      const text = llmService.extractResponseText(response).trim();
      const jsonText = this._extractJson(text);
      const parsed = JSON.parse(jsonText);
      const steps = Array.isArray(parsed.steps) ? parsed.steps : [];

      logger.debug("AI planned steps", {
        stepsCount: steps.length,
        needsClarification: parsed.needsClarification,
        strategy: enrichedContext?.selectedStrategy,
      });

      return {
        needsClarification: Boolean(parsed.needsClarification) && !clarificationContext?.answer,
        clarificationQuestion: parsed.clarificationQuestion || null,
        steps,
      };
    } catch (error) {
      logger.warn("Planning fallback used:", error?.message || error);

      // Use enriched context steps if available, otherwise use defaults
      if (enrichedContext?.plannedSteps && enrichedContext.plannedSteps.length > 0) {
        return {
          needsClarification: false,
          clarificationQuestion: null,
          steps: enrichedContext.plannedSteps.map((s) => ({
            id: s.id,
            label: s.label,
            reasoning: `Confidence: ${s.confidence || 0.5}`,
          })),
        };
      }

      return {
        needsClarification: false,
        clarificationQuestion: null,
        steps: DEFAULT_STEP_DEFS,
      };
    }
  }

  _applyPlanSteps(tracker, plannedSteps) {
    if (!Array.isArray(plannedSteps) || plannedSteps.length === 0) {
      // Fallback to defaults if no plan provided
      DEFAULT_STEP_DEFS.forEach((def) => {
        tracker.addStep({ id: def.id, label: def.label });
      });
      return;
    }

    // Only add the steps that were actually planned by the AI
    plannedSteps.forEach((step) => {
      if (step?.id && step?.label) {
        tracker.addStep({ id: step.id, label: step.label });
      }
    });
  }

  _selectRelevantTables({ prompt, tableNames, limit = 8 } = {}) {
    if (!Array.isArray(tableNames) || tableNames.length === 0) {
      return [];
    }

    const ranked = this._rankTablesByEmbedding(prompt, tableNames);
    const sliceLimit = Math.min(limit, ranked.length);
    return ranked.slice(0, sliceLimit).map((entry) => entry.name);
  }

  _rankTablesByEmbedding(prompt, tableNames) {
    if (!Array.isArray(tableNames) || tableNames.length === 0) {
      return [];
    }

    const promptLower = prompt.toLowerCase();
    const queryVector = this.embeddingService.embedText(prompt);

    const scores = tableNames.map((name) => {
      const nameLower = name.toLowerCase();
      const nameWords = nameLower.replace(/_/g, " ").split(/\s+/);

      // Calculate base embedding score
      const vector = this.embeddingService.embedText(name);
      let score = this._dot(queryVector, vector);

      // CRITICAL FIX: Boost score for exact/partial name matches
      // This ensures "menu items" strongly matches "menu_items" table

      // Exact match (e.g., "orders" in "get all orders")
      if (promptLower.includes(nameLower)) {
        score += 10.0; // Strong boost
        logger.debug(`Exact match boost: "${name}" found in prompt`);
      }
      // Partial word match (e.g., "menu" matches "menu_items")
      else if (nameWords.some((word) => word.length > 3 && promptLower.includes(word))) {
        score += 5.0; // Medium boost
        logger.debug(`Partial match boost: word from "${name}" found in prompt`);
      }
      // Fuzzy match for multi-word tables (e.g., "menu items" → "menu_items")
      else {
        const promptWords = promptLower.split(/\s+/);
        const matchingWords = nameWords.filter((nw) =>
          promptWords.some((pw) => pw.includes(nw) || nw.includes(pw)),
        );
        if (matchingWords.length > 0) {
          score += matchingWords.length * 2.0; // Boost per matching word
          logger.debug(`Fuzzy match boost: ${matchingWords.length} words from "${name}"`);
        }
      }

      return {
        name,
        score,
      };
    });

    return scores.sort((a, b) => b.score - a.score);
  }

  _dot(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
      return 0;
    }
    const len = Math.min(vecA.length, vecB.length);
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
      sum += vecA[i] * vecB[i];
    }
    return sum;
  }

  _buildDbMeta(dbName, tableInfoList = []) {
    const tables = tableInfoList
      .map((entry) => this._normalizeTableInfo(entry))
      .filter((entry) => entry && entry.name);

    return [
      {
        name: dbName,
        tables,
      },
    ];
  }

  _normalizeTableInfo(payload) {
    const info = payload?.tableInfo || payload;
    const tableName = info?.table_name || info?.tableName || info?.name || info?.table;
    const columns = Array.isArray(info?.columns) ? info.columns : [];
    return {
      name: tableName,
      columns: this._normalizeColumns(columns),
    };
  }

  _normalizeColumns(columns) {
    return columns.map((col) => ({
      column_name: col.column_name ?? col.name ?? null,
      data_type: col.data_type ?? col.dataType ?? col.type ?? null,
      is_nullable: col.is_nullable ?? col.isNullable ?? null,
      default_value: col.default_value ?? col.defaultValue ?? null,
      extra: col.extra ?? null,
      is_primary_key: col.is_primary_key ?? col.isPrimaryKey ?? null,
      length: col.length ?? col.data_length ?? null,
      precision: col.precision ?? null,
      scale: col.scale ?? null,
    }));
  }

  _summarizeResult(result) {
    if (!result || typeof result !== "object") {
      return null;
    }

    let rows = [];
    let totalRows = null;
    if (Array.isArray(result.rows)) {
      rows = result.rows;
      totalRows = typeof result.totalRows === "number" ? result.totalRows : null;
    } else if (Array.isArray(result.queries)) {
      const firstWithRows =
        result.queries.find((entry) => Array.isArray(entry?.rows)) || result.queries[0];
      rows = Array.isArray(firstWithRows?.rows) ? firstWithRows.rows : [];
      totalRows = typeof firstWithRows?.totalRows === "number" ? firstWithRows.totalRows : null;
    }
    const sampleRows = rows.slice(0, Math.min(rows.length, 5));
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      rowCount: typeof totalRows === "number" ? totalRows : rows.length,
      columns,
      sampleRows,
    };
  }

  /**
   * Build structured table data response for side panel display (like Claude artifacts).
   * Works for both SQL and NoSQL databases.
   */
  _buildTableDataResponse({
    tableName,
    resultSummary,
    execResult,
    query,
    hasMore,
    approximateTotal,
    exactTotal,
  }) {
    logger.info("🔧 BUILD TABLE DATA RESPONSE", {
      hasResultSummary: !!resultSummary,
      rowCount: resultSummary?.rowCount,
      hasExecResult: !!execResult,
      execResultKeys: execResult ? Object.keys(execResult) : [],
      sampleRowsLength: resultSummary?.sampleRows?.length,
    });

    if (!resultSummary || !resultSummary.rowCount) {
      logger.warn("⚠️ NO DATA TO DISPLAY - returning null", { resultSummary });
      return null; // No data to display
    }

    // Extract raw rows from execution result
    // Try multiple possible locations for row data
    // execResult structure: { connectionId, result: { queries: [{ results: { rows } }] } }
    const rowsFromQuery = execResult?.result?.queries?.[0]?.results?.rows;
    const rows =
      execResult?.rows ||
      execResult?.result?.rows ||
      rowsFromQuery ||
      resultSummary.sampleRows ||
      [];

    logger.info("📊 EXTRACTED ROWS", {
      rowCount: rows.length,
      fromExecResult: !!(execResult?.rows || execResult?.result?.rows),
      fromQueryResults: !!rowsFromQuery,
      fromSampleRows: rows === resultSummary.sampleRows,
      firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
    });

    // Get column information
    const columns = resultSummary.columns || [];

    // Detect database type to determine display format
    const dbType = execResult?.dbType || "sql";
    const nosqlDatabases = ["mongodb", "redis", "cassandra", "dynamodb", "couchdb", "cosmosdb"];
    const isNoSQL = nosqlDatabases.some((db) => dbType.toLowerCase().includes(db));
    const displayType = isNoSQL ? "json" : "table";

    // Infer column types from first row if available
    const columnTypes = {};
    if (rows.length > 0 && columns.length > 0) {
      const firstRow = rows[0];
      columns.forEach((col) => {
        const value = firstRow[col];
        if (value === null || value === undefined) {
          columnTypes[col] = "unknown";
        } else if (typeof value === "number") {
          columnTypes[col] = Number.isInteger(value) ? "integer" : "decimal";
        } else if (typeof value === "boolean") {
          columnTypes[col] = "boolean";
        } else if (value instanceof Date) {
          columnTypes[col] = "datetime";
        } else if (typeof value === "object") {
          columnTypes[col] = "json";
        } else {
          columnTypes[col] = "string";
        }
      });
    }

    // Build pagination info
    const paginationInfo = {
      currentPage: 1,
      pageSize: resultSummary.rowCount,
      totalRows: exactTotal || approximateTotal || null,
      hasMore,
      isApproximate: approximateTotal !== null && exactTotal === null,
    };

    // If no rows were extracted, return null
    if (rows.length === 0) {
      logger.warn("⚠️ NO ROWS EXTRACTED - returning null", {
        hadExecResult: !!execResult,
        hadSampleRows: !!resultSummary.sampleRows,
      });
      return null;
    }

    const tableDataResult = {
      type: displayType, // 'table' for SQL, 'json' for NoSQL
      tableName,
      query,
      timestamp: new Date().toISOString(),
      columns: columns.map((col) => ({
        name: col,
        type: columnTypes[col] || "string",
        sortable: true,
        filterable: true,
      })),
      rows: rows.map((row, index) => ({
        _index: index,
        ...row,
      })),
      pagination: paginationInfo,
      metadata: {
        rowCount: resultSummary.rowCount,
        executionTime: resultSummary.executionTime,
        queryId: this._createId(),
      },
    };

    logger.info("✅ TABLE DATA BUILT SUCCESSFULLY", {
      tableName: tableDataResult.tableName,
      rowCount: tableDataResult.rows.length,
      columnCount: tableDataResult.columns.length,
      displayType: tableDataResult.type,
    });

    return tableDataResult;
  }

  _buildSimpleSelectQuery(dbType, tableName, limit) {
    const safeTable = String(tableName);
    const normalized = String(dbType || "").toLowerCase();
    const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 10;

    if (normalized === "mssql") {
      return `SELECT TOP (${safeLimit}) * FROM ${safeTable}`;
    }
    if (normalized === "oracledb") {
      return `SELECT * FROM ${safeTable} FETCH FIRST ${safeLimit} ROWS ONLY`;
    }
    return `SELECT * FROM ${safeTable} LIMIT ${safeLimit}`;
  }

  /**
   * Get approximate row count using database-specific fast metadata queries.
   * Falls back to null if metadata not available. Never uses COUNT(*) for performance.
   */
  async _getApproximateRowCount(connectionId, dbType, dbName, tableName) {
    try {
      const normalized = String(dbType || "").toLowerCase();
      let query = null;

      // Database-specific fast count queries using metadata
      if (normalized === "postgresql" || normalized === "pg") {
        // Use pg_class statistics (very fast, approximate)
        // Escape single quotes in table name
        const escapedTable = tableName.replace(/'/g, "''");
        query = `SELECT reltuples::bigint as approximate_count 
                 FROM pg_class 
                 WHERE relname = '${escapedTable}'`;
      } else if (normalized === "mysql" || normalized === "mysql2") {
        // Use information_schema statistics (fast, approximate)
        const escapedDb = dbName.replace(/'/g, "''");
        const escapedTable = tableName.replace(/'/g, "''");
        query = `SELECT table_rows as approximate_count 
                 FROM information_schema.tables 
                 WHERE table_schema = '${escapedDb}' AND table_name = '${escapedTable}'`;
      } else if (normalized === "mssql") {
        // Use sys.partitions statistics (very fast, exact for non-partitioned tables)
        const escapedTable = tableName.replace(/'/g, "''");
        query = `SELECT SUM(p.rows) as approximate_count 
                 FROM sys.tables t 
                 INNER JOIN sys.partitions p ON t.object_id = p.object_id 
                 WHERE t.name = '${escapedTable}' AND p.index_id IN (0, 1)`;
      } else if (normalized === "oracledb") {
        // Use all_tables statistics (fast, approximate)
        const escapedTable = tableName.replace(/'/g, "''").toUpperCase();
        query = `SELECT num_rows as approximate_count 
                 FROM all_tables 
                 WHERE table_name = '${escapedTable}'`;
      } else if (normalized === "sqlite" || normalized === "sqlite3") {
        // For SQLite, use dbstat if available, otherwise return null
        // dbstat is a virtual table that provides storage information
        query = `SELECT SUM(ncell) as approximate_count FROM dbstat WHERE name = '${tableName.replace(/'/g, "''")}'`;
      }

      if (!query) {
        logger.debug("No approximate count query available for dbType", { dbType: normalized });
        return null;
      }

      logger.info("🔢 Fetching Approximate Count", {
        dbType: normalized,
        tableName,
        query: query.substring(0, 100),
      });

      const result = await this.mcpRunner.run("execute_query", { connectionId, query });
      const data = result?.result?.rows?.[0] || result?.rows?.[0];
      const count = data?.approximate_count || data?.APPROXIMATE_COUNT || data?.table_rows;

      logger.info("🔢 Approximate Count Result", {
        rawData: data,
        extractedCount: count,
      });

      return count ? parseInt(count, 10) : null;
    } catch (error) {
      // Silently fail - approximate count is optional
      logger.debug("Could not get approximate row count", {
        error: error?.message,
        tableName,
        dbType,
      });
      return null;
    }
  }

  _buildDeterministicResponse({ tableName, resultSummary, executionError }) {
    if (executionError) {
      return executionError;
    }
    if (!resultSummary) {
      return `I ran the query for ${tableName}, but couldn't summarize the results.`;
    }
    if (!resultSummary.rowCount) {
      return `No rows found in ${tableName}.`;
    }

    // Build pagination-aware count message using LIMIT+1 detection
    const fetchedCount = resultSummary.rowCount;
    let countMessage;

    logger.info("💬 Building Response Message", {
      fetchedCount,
      hasMore: resultSummary.hasMore,
      approximateTotal: resultSummary.approximateTotal,
      exactTotal: resultSummary.exactTotal,
    });

    if (resultSummary.hasMore) {
      // More rows available - show approximate total if available
      if (resultSummary.approximateTotal && resultSummary.approximateTotal > fetchedCount) {
        countMessage = `I fetched ${fetchedCount} rows from ${tableName} (~${resultSummary.approximateTotal} total rows available).`;
      } else {
        countMessage = `I fetched ${fetchedCount} rows from ${tableName} (more rows available).`;
      }
    } else if (resultSummary.exactTotal !== undefined) {
      // All rows fetched
      countMessage = `I fetched all ${fetchedCount} rows from ${tableName}.`;
    } else {
      // No pagination detection (shouldn't happen with new logic)
      countMessage = `I fetched ${fetchedCount} rows from ${tableName}.`;
    }

    const columns =
      resultSummary.columns && resultSummary.columns.length
        ? ` Columns: ${resultSummary.columns.join(", ")}.`
        : "";
    const samples = resultSummary.sampleRows || [];
    const preview = this._formatRowPreview(samples);
    const previewLine = preview ? ` Showing ${samples.length} sample rows: ${preview}.` : "";
    return `${countMessage}${columns}${previewLine}`;
  }

  _formatTableListResponse(tableNames) {
    if (!tableNames.length) {
      return "I couldn't find any tables in the selected database.";
    }

    const max = 50;
    const shown = tableNames.slice(0, max);
    const remaining = tableNames.length - shown.length;
    const suffix = remaining > 0 ? ` (and ${remaining} more)` : "";
    return `Available tables (${tableNames.length}): ${shown.join(", ")}${suffix}`;
  }

  _formatRowPreview(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return "";
    }
    const maxRows = 3;
    const previewRows = rows.slice(0, maxRows).map((row) => this._safeRowToString(row));
    return previewRows.join(" | ");
  }

  _safeRowToString(row) {
    if (!row || typeof row !== "object") {
      return String(row);
    }
    try {
      const json = JSON.stringify(row);
      if (json.length > 220) {
        return `${json.slice(0, 217)}...`;
      }
      return json;
    } catch {
      return "[row]";
    }
  }

  _normalizeTableNames(tables) {
    const names = tables
      .map((table) => {
        if (typeof table === "string") {
          return table;
        }
        return table?.name || table?.table_name || table?.tableName || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _markSkippedSteps(tracker, stepIds) {
    stepIds.forEach((id) => {
      tracker.addStep({ id, label: id, status: "done", note: "Skipped." });
      tracker.setStatus(id, "done", "Skipped.");
    });
  }

  _extractJson(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1);
    }
    return text;
  }

  _buildPromptWithClarification(prompt, clarificationContext) {
    if (!clarificationContext?.answer) {
      return prompt;
    }
    return `${prompt}\nClarification: ${clarificationContext.answer}`;
  }

  async _detectQueryIntent(prompt, dbType) {
    const normalized = String(dbType || "").toLowerCase();

    // Get available strategies dynamically
    const StrategySelector = require("../rag/orchestrator/StrategySelector");
    const selector = new StrategySelector();
    const availableStrategies = selector.getAvailableStrategies().join("|");

    const system = [
      "You are a database query intent classifier.",
      "Analyze the user's query and determine the intent.",
      "Return STRICT JSON with schema:",
      "{",
      '  "intent": "list_tables|simple_select|time_filter_query|join_query|aggregation_query|key_scan|partition_query|collection_query|complex_query|explain_query|suggest_alternatives",',
      '  "confidence": 0.0-1.0,',
      '  "reasoning": "brief explanation",',
      `  "recommendedStrategy": "${availableStrategies}",`,
      '  "tableName": "extracted table name if applicable"',
      "}",
      "Do not include text outside JSON.",
    ].join(" ");

    const dbTypeInfo = this._getDbTypeInfo(normalized);
    const payload = {
      prompt,
      dbType: normalized,
      dbCategory: dbTypeInfo.category,
      supportedOperations: dbTypeInfo.operations,
    };

    try {
      const response = await llmService.callWithTimeout(
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Classify this query:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        5000,
        "Intent detection timed out.",
      );

      const text = llmService.extractResponseText(response).trim();
      const jsonText = this._extractJson(text);
      const parsed = JSON.parse(jsonText);

      const template = this._mapIntentToTemplate(parsed.intent, normalized);

      return {
        type: parsed.intent || "complex_query",
        confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5,
        template,
        tableName: parsed.tableName || null,
        reasoning: parsed.reasoning || null,
        recommendedStrategy: parsed.recommendedStrategy || "RAGEnhancedStrategy",
      };
    } catch (error) {
      logger.warn("Intent detection failed, using fallback", { error: error?.message });
      return this._fallbackIntentDetection(prompt, normalized);
    }
  }

  _getDbTypeInfo(dbType) {
    if (this.sqlDbTypes.has(dbType)) {
      return {
        category: "sql",
        operations: ["select", "join", "aggregate", "where", "group by", "order by"],
      };
    }
    if (dbType === "mongodb") {
      return {
        category: "nosql-document",
        operations: ["find", "aggregate", "insert", "update", "delete", "createIndex"],
      };
    }
    if (this.cacheDbTypes.has(dbType)) {
      return {
        category: "cache",
        operations: ["get", "set", "delete", "scan", "keys", "ttl"],
      };
    }
    if (dbType === "cassandra" || dbType === "dynamodb") {
      return {
        category: "nosql-wide-column",
        operations: ["select", "insert", "update", "delete", "partition query"],
      };
    }
    return {
      category: "nosql",
      operations: ["query", "insert", "update", "delete"],
    };
  }

  _mapIntentToTemplate(intent, dbType) {
    const templateMap = {
      list_tables: "list_tables",
      simple_select: "simple_select",
      time_filter_query: "time_filter",
      join_query: "join_query",
      aggregation_query: dbType === "mongodb" ? "aggregation_pipeline" : "join_query",
      key_scan: "key_scan",
      partition_query: "partition_query",
      collection_query: "collection_query",
      explain_query: null,
      suggest_alternatives: null,
    };
    return templateMap[intent] || null;
  }

  _fallbackIntentDetection(prompt, dbType) {
    const text = String(prompt || "")
      .toLowerCase()
      .trim();

    if (/\blist\s+tables\b|\bshow\s+tables\b/.test(text)) {
      return {
        type: "list_tables",
        confidence: 0.9,
        template: "list_tables",
        recommendedStrategy: "DirectSQLStrategy",
      };
    }

    if (/^(?:get|list|show)\s+\w+/.test(text)) {
      return {
        type: "simple_select",
        confidence: 0.7,
        template: "simple_select",
        recommendedStrategy: "DirectSQLStrategy",
      };
    }

    if (/\b(explain|describe|how)\b/.test(text)) {
      return {
        type: "explain_query",
        confidence: 0.8,
        template: null,
        recommendedStrategy: "ExplanationStrategy",
      };
    }

    if (/\b(suggest|recommend|alternative|better)\b/.test(text)) {
      return {
        type: "suggest_alternatives",
        confidence: 0.8,
        template: null,
        recommendedStrategy: "SuggestionStrategy",
      };
    }

    return {
      type: "complex_query",
      confidence: 0.5,
      template: null,
      recommendedStrategy: "RAGEnhancedStrategy",
    };
  }

  async _buildNaturalLanguageResponse({
    prompt,
    dbType,
    dbName,
    query,
    queryAnalysis,
    resultSummary,
    executionError,
    requestId,
  }) {
    const system = [
      "You are DBFuse AI, a database assistant.",
      "Answer the user in natural language.",
      "Use query results when provided; do not invent data.",
      "If results are missing or execution requires confirmation, say so clearly.",
      "Do not include SQL unless the user asks for it.",
    ].join(" ");

    const payload = {
      question: prompt,
      dbType,
      dbName,
      query,
      queryAnalysis,
      resultSummary,
      executionError,
    };

    try {
      const startedAt = Date.now();
      const response = await llmService.callWithTimeout(
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Respond using this context JSON:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        undefined,
        "Chat response timed out.",
      );
      logger.info("Chat response LLM completed", {
        requestId,
        durationMs: Date.now() - startedAt,
      });
      const text = llmService.extractResponseText(response).trim();
      return text || "I couldn't generate a response for that request.";
    } catch (error) {
      logger.warn("Chat response generation failed:", {
        requestId,
        error: error?.message || error,
        stack: error?.stack,
      });
      if (executionError) {
        return executionError;
      }
      return "I couldn't generate a response for that request.";
    }
  }

  _createId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

module.exports = new ChatService();
