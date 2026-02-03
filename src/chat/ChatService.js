const crypto = require("crypto");

const { connectionManager } = require("../config");
const llmService = require("../services/LLMService");
const QueryGenerationService = require("../services/QueryGenerationService");
const logger = require("../utils/logger");
const QueryAnalyzer = require("../rag/orchestrator/QueryAnalyzer");
const QueryOrchestrator = require("../rag/orchestrator/QueryOrchestrator");
const EmbeddingService = require("../rag/services/EmbeddingService");
const RAGService = require("../rag/services/RAGService");
const storageManager = require("../rag/storage/StorageManager");

const ChatStepTracker = require("./ChatStepTracker");
const McpToolRunner = require("./McpToolRunner");

const CHAT_DEFAULT_PAGE_SIZE = Number(process.env.CHAT_DEFAULT_PAGE_SIZE) || 50;
const CHAT_MAX_ROWS = Number(process.env.CHAT_MAX_ROWS) || 1000;
const CHAT_LLM_BUDGET_MS = Number(process.env.CHAT_LLM_BUDGET_MS) || 25000;
const CHAT_INTENT_TIMEOUT_MS = Number(process.env.CHAT_INTENT_TIMEOUT_MS) || 5000;
const CHAT_PLAN_TIMEOUT_MS = Number(process.env.CHAT_PLAN_TIMEOUT_MS) || 8000;
const CHAT_MIN_LLM_TIMEOUT_MS = Number(process.env.CHAT_MIN_LLM_TIMEOUT_MS) || 1200;
const CHAT_DUMMY_ROW_COUNT = Number(process.env.CHAT_DUMMY_ROW_COUNT) || 5;
const CHAT_DUMMY_MAX_ROWS = Number(process.env.CHAT_DUMMY_MAX_ROWS) || 100;
const CHAT_SCHEMA_CACHE_TTL_MS = Number(process.env.CHAT_SCHEMA_CACHE_TTL_MS) || 300000;
const CHAT_SCHEMA_CACHE_MAX_SIZE = Number(process.env.CHAT_SCHEMA_CACHE_MAX_SIZE) || 100;
const CHAT_TABLE_INFO_CACHE_TTL_MS = Number(process.env.CHAT_TABLE_INFO_CACHE_TTL_MS) || 300000;
const CHAT_TABLE_INFO_CACHE_MAX_SIZE = Number(process.env.CHAT_TABLE_INFO_CACHE_MAX_SIZE) || 200;
const CHAT_CONTEXT_MAX_TABLES = Number(process.env.CHAT_CONTEXT_MAX_TABLES) || 8;
const CHAT_CONTEXT_MAX_COLUMNS = Number(process.env.CHAT_CONTEXT_MAX_COLUMNS) || 24;
const CHAT_SAMPLE_ROWS_PER_TABLE = Number(process.env.CHAT_SAMPLE_ROWS_PER_TABLE) || 0;
const CHAT_SAMPLE_MAX_TABLES = Number(process.env.CHAT_SAMPLE_MAX_TABLES) || 3;
const CHAT_SAMPLE_CACHE_TTL_MS = Number(process.env.CHAT_SAMPLE_CACHE_TTL_MS) || 120000;
const CHAT_FOLLOWUP_ENABLED = process.env.CHAT_FOLLOWUP_ENABLED !== "false";
const CHAT_FOLLOWUP_MAX = Number(process.env.CHAT_FOLLOWUP_MAX) || 3;

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
  ddl_query: [
    { id: "plan", label: "Interpret request", confidence: 0.9 },
    { id: "schema", label: "Check schema context", confidence: 0.85 },
    { id: "generate", label: "Draft DDL", confidence: 0.8 },
    { id: "execute", label: "Execute change", confidence: 0.8 },
    { id: "summarize", label: "Summarize results", confidence: 0.85 },
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
    this.queryGenerator =
      options.queryGenerator ||
      new QueryGenerationService({ orchestrator: this.orchestrator, llmService });
    this.embeddingService = options.embeddingService || new EmbeddingService();
    this.ragService = options.ragService || new RAGService();
    this.mcpRunner = options.mcpRunner || new McpToolRunner();
    this.storageManager = options.storageManager || storageManager;
    this.enrichmentCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    this.schemaCache = new Map();
    this.tableInfoCache = new Map();
    this.sampleRowCache = new Map();
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
    const intentTimeoutMs = Number.isFinite(options.intentTimeoutMs)
      ? options.intentTimeoutMs
      : CHAT_INTENT_TIMEOUT_MS;
    try {
      if (intentTimeoutMs <= CHAT_MIN_LLM_TIMEOUT_MS) {
        throw new Error("Intent detection skipped due to timeout budget");
      }
      queryIntent = await this._detectQueryIntent(prompt, normalizedDbType, intentTimeoutMs);
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
      if (this._detectWriteIntent(lowerPrompt)) {
        queryIntent = {
          type: "ddl_query",
          confidence: 0.75,
          template: "ddl_query",
          recommendedStrategy: "DirectSQLStrategy",
        };
      } else if (lowerPrompt.includes("show tables") || lowerPrompt.includes("list tables")) {
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

    const isWriteIntent = this._detectWriteIntent(prompt);
    if (isWriteIntent) {
      queryIntent = {
        type: "ddl_query",
        confidence: Math.max(queryIntent?.confidence || 0.6, 0.75),
        template: "ddl_query",
        recommendedStrategy: "DirectSQLStrategy",
        tableName: queryIntent?.tableName || null,
        reasoning: queryIntent?.reasoning || "Write operation detected",
      };
    }

    // Use template steps if high confidence intent
    const isQuickIntent =
      queryIntent.confidence >= 0.85 &&
      queryIntent.template &&
      STEP_TEMPLATES[queryIntent.template];
    const isListTables = queryIntent.type === "list_tables";
    const isQuickDdl = queryIntent.type === "ddl_query";
    if (isQuickIntent && (isListTables || isQuickDdl)) {
      const enrichedContext = {
        queryIntent: queryIntent.type,
        confidence: queryIntent.confidence,
        complexity: "simple",
        selectedStrategy: queryIntent.recommendedStrategy || "DirectSQLStrategy",
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
    const currentDb = this._resolveDatabaseName({
      dbType: normalizedDbType,
      dbName,
      connectionInfo,
    });

    let availableEntities = [];
    try {
      availableEntities = await this._getTablesCached({
        connectionId,
        dbName: currentDb,
      });
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

    // Phase 4: Retrieve vector context (RAG) and rank relevant entities
    let ragContext = null;
    try {
      ragContext = await this.ragService.retrieveContext({
        connectionId,
        dbName: currentDb,
        query: prompt,
        options: {
          limit: 8,
          minScore: 0.2,
          useCache: true,
          backgroundIndex: false,
          indexTimeoutMs: 8000,
        },
      });
    } catch (error) {
      logger.warn("RAG context retrieval failed", { error: error?.message });
    }

    const rankedTables = this._rankTablesByEmbedding(prompt, availableEntities);
    const ragTables = Array.isArray(ragContext?.tables) ? ragContext.tables : [];
    const mergedScores = new Map();

    for (const entry of ragTables) {
      const name = entry?.name;
      if (!name || (availableEntities.length && !availableEntities.includes(name))) continue;
      mergedScores.set(name, (mergedScores.get(name) || 0) + (entry.score || 0) * 10);
    }

    for (const entry of rankedTables) {
      if (!entry?.name) continue;
      const score = (mergedScores.get(entry.name) || 0) + entry.score;
      mergedScores.set(entry.name, score);
    }

    const relevantEntities = Array.from(mergedScores.entries())
      .map(([name, score]) => ({
        name,
        type: this._getEntityType(normalizedDbType),
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    logger.info("🔍 Entity ranking results", {
      prompt: prompt.substring(0, 80),
      allTables: availableEntities,
      rankedTop5: rankedTables
        .slice(0, 5)
        .map((e) => ({ name: e.name, score: e.score.toFixed(4) })),
      selectedEntities: relevantEntities.map((e) => ({ name: e.name, score: e.score.toFixed(4) })),
    });

    // Phase 5: Get strategy capabilities with error handling
    let capabilities = { type: "unknown", operations: [], features: [], limits: {} };
    try {
      const { getStrategyMetadata, getCapabilityModel } = require("../config/create-strategy");
      const capabilityModel = getCapabilityModel ? getCapabilityModel(normalizedDbType) : null;
      const strategyMetadata = getStrategyMetadata ? getStrategyMetadata(normalizedDbType) : null;
      if (capabilityModel) {
        capabilities = {
          ...capabilityModel,
          type: capabilityModel.type || strategyMetadata?.type || "sql",
        };
      } else if (strategyMetadata) {
        capabilities = {
          type: strategyMetadata.type || "sql",
          operations: strategyMetadata.capabilities || [],
          features: strategyMetadata.supportedFeatures || [],
          limits: { supportsWrite: true },
        };
      }
    } catch (error) {
      logger.warn("Failed to fetch strategy metadata", { error: error?.message });
      warnings.push("Using default database capabilities");
      // Use default capabilities based on dbType
      if (this.sqlDbTypes.has(normalizedDbType)) {
        capabilities = {
          type: "sql",
          operations: ["query", "crud", "indexes", "explain"],
          features: ["transactions"],
          limits: { supportsWrite: true },
        };
      } else if (this.noSqlDbTypes.has(normalizedDbType)) {
        capabilities = {
          type: "nosql",
          operations: ["query", "crud", "indexes"],
          features: ["aggregation"],
          limits: { supportsWrite: true },
        };
      } else if (this.cacheDbTypes.has(normalizedDbType)) {
        capabilities = {
          type: "cache",
          operations: ["query", "crud", "command"],
          features: ["ttl"],
          limits: { supportsWrite: true },
        };
      }
    }

    // Phase 6: Select strategy with error handling
    let selectedStrategy = queryIntent.recommendedStrategy;
    let selectionSource = "AI";

    try {
      const StrategySelector = require("../rag/orchestrator/StrategySelector");
      const selector = new StrategySelector();

      const selectorPick = selector.select({
        analysis,
        context: { tables: relevantEntities.map((t) => ({ name: t.name || t })) },
        queryIntent,
        capabilities,
        dbType: normalizedDbType,
      });

      selectedStrategy = selectorPick || selectedStrategy;
      selectionSource = "StrategySelector";

      if (!selector.isStrategyAvailable(selectedStrategy)) {
        logger.debug("Selected unavailable strategy, falling back", {
          selected: selectedStrategy,
          available: selector.getAvailableStrategies(),
        });
        selectedStrategy = "DirectSQLStrategy";
        selectionSource = "Fallback";
      }

      logger.debug("Strategy selected", {
        strategy: selectedStrategy,
        source: selectionSource,
        availableStrategies: selector.getAvailableStrategies(),
      });
    } catch (error) {
      logger.warn("Strategy selection failed, using default", { error: error?.message });
      warnings.push("Using default query strategy");
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

  _getCachedValue(cache, cacheKey, ttlMs) {
    if (!cache) return null;
    const entry = cache.get(cacheKey);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
      cache.delete(cacheKey);
      return null;
    }
    return entry.value;
  }

  _setCachedValue(cache, cacheKey, value, maxSize) {
    if (!cache) return;
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(cacheKey, { value, timestamp: Date.now() });
  }

  async _getTablesCached({ connectionId, dbName } = {}) {
    const cacheKey = `${connectionId}|${dbName || ""}|tables`;
    const cached = this._getCachedValue(this.schemaCache, cacheKey, CHAT_SCHEMA_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
    const tablesPayload = await this.mcpRunner.run("get_tables", { connectionId, dbName });
    const tableNames = this._normalizeTableNames(tablesPayload?.tables || []);
    this._setCachedValue(this.schemaCache, cacheKey, tableNames, CHAT_SCHEMA_CACHE_MAX_SIZE);
    return tableNames;
  }

  async _getTableInfoCached({ connectionId, dbName, tableName } = {}) {
    const cacheKey = `${connectionId}|${dbName || ""}|${tableName || ""}|tableInfo`;
    const cached = this._getCachedValue(
      this.tableInfoCache,
      cacheKey,
      CHAT_TABLE_INFO_CACHE_TTL_MS,
    );
    if (cached) {
      return cached;
    }
    const tableInfo = await this.mcpRunner.run("get_table_info", {
      connectionId,
      dbName,
      tableName,
    });
    this._setCachedValue(this.tableInfoCache, cacheKey, tableInfo, CHAT_TABLE_INFO_CACHE_MAX_SIZE);
    return tableInfo;
  }

  async _getSampleRowsCached({ connectionId, dbName, dbType, tableName, limit } = {}) {
    const safeTable = this._sanitizeTableName(tableName);
    if (!safeTable || !limit || limit <= 0) return [];
    const cacheKey = `${connectionId}|${dbName || ""}|${safeTable}|samples|${limit}`;
    const cached = this._getCachedValue(this.sampleRowCache, cacheKey, CHAT_SAMPLE_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
    try {
      const query = this._buildSimpleSelectQuery(dbType, safeTable, limit);
      const execResult = await this.mcpRunner.run("execute_query", { connectionId, query });
      const rows = this._extractRowsFromResult(execResult?.result || execResult);
      const trimmed = rows.slice(0, limit);
      this._setCachedValue(this.sampleRowCache, cacheKey, trimmed, CHAT_TABLE_INFO_CACHE_MAX_SIZE);
      return trimmed;
    } catch (error) {
      logger.debug("Sample row fetch failed", {
        tableName: safeTable,
        error: error?.message,
      });
      return [];
    }
  }

  _attachSampleRows(tableInfoList, tableName, rows) {
    if (!Array.isArray(tableInfoList) || !tableName) return;
    const target = String(tableName || "").toLowerCase();
    for (const entry of tableInfoList) {
      const info = entry?.tableInfo || entry;
      const name = String(
        info?.table_name || info?.tableName || info?.name || info?.table || "",
      ).toLowerCase();
      if (!name || name !== target) continue;
      if (entry?.tableInfo) {
        entry.tableInfo.sampleRows = rows;
      } else {
        entry.sampleRows = rows;
      }
      return;
    }
  }

  _packTableInfoList(tableInfoList, maxTables, maxColumns) {
    if (!Array.isArray(tableInfoList)) return [];
    const limited =
      Number.isFinite(maxTables) && maxTables > 0
        ? tableInfoList.slice(0, maxTables)
        : tableInfoList;
    return limited.map((entry) => {
      const info = entry?.tableInfo || entry;
      const columns = Array.isArray(info?.columns) ? info.columns : [];
      const packedColumns =
        Number.isFinite(maxColumns) && maxColumns > 0 ? columns.slice(0, maxColumns) : columns;
      const packedInfo = {
        ...info,
        columns: packedColumns,
      };
      if (entry?.tableInfo) {
        return {
          ...entry,
          tableInfo: packedInfo,
        };
      }
      return packedInfo;
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
    };
    const allowed = new Set(["DirectSQLStrategy", "RAGEnhancedStrategy", "DecompositionStrategy"]);

    return available
      .filter((name) => name !== selectedStrategy && allowed.has(name))
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

  async _findSimilarQueries(prompt, history, _dbType) {
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

  _calculateStepConfidence({
    queryIntent: _queryIntent,
    complexity,
    entityMatch,
    historicalSuccess,
    steps,
  }) {
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
    conversationContext,
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
    const isSql = this.sqlDbTypes.has(normalizedDbType);
    const llmBudget = this._createLlmBudget(CHAT_LLM_BUDGET_MS);

    const connectionInfo = connectionManager.getConnectionInfo(connectionId);
    const currentDb = this._resolveDatabaseName({
      dbType: normalizedDbType,
      dbName,
      connectionInfo,
    });
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

    const tracker = new ChatStepTracker((steps) => {
      if (typeof onStep === "function") {
        onStep(this._sanitizeSteps(steps));
      }
    });

    if (!isSql) {
      const parsed = this._tryParseJsonPrompt(prompt);
      if (!parsed) {
        return {
          queryId: null,
          query: "",
          responseText:
            'For NoSQL/Cache databases, provide a JSON query payload (e.g., {"operation":"find","collection":"name"}).',
          queryAnalysis: null,
          resultSummary: null,
          executionError: null,
          steps: [],
        };
      }

      tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
      let execResult;
      try {
        execResult = await this.mcpRunner.run("execute_query", {
          connectionId,
          query: parsed,
        });
        const resultSummary = this._summarizeResult(execResult?.result || execResult);
        tracker.setStatus(
          "execute",
          "done",
          resultSummary?.rowCount != null ? `Rows: ${resultSummary.rowCount}` : null,
        );

        tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
        const tableData = this._buildTableDataResponse({
          tableName: parsed?.collection || parsed?.table || parsed?.key || "result",
          resultSummary,
          execResult,
          query: parsed,
          hasMore: false,
          approximateTotal: null,
          exactTotal: resultSummary?.rowCount,
        });

        const responseText = this._buildDeterministicResponse({
          tableName: parsed?.collection || parsed?.table || parsed?.key || "result",
          resultSummary,
          executionError: null,
          query: null,
        });
        const followUps = this._buildFollowUpSuggestions({
          intentType: "collection_query",
          tableName: parsed?.collection || parsed?.table || parsed?.key || "result",
          resultSummary,
          dbType: normalizedDbType,
          query: null,
        });
        const finalResponse = this._appendFollowUps(responseText, followUps);
        tracker.setStatus("summarize", "done");

        return {
          queryId: this._createId(),
          query: JSON.stringify(parsed),
          responseText: finalResponse,
          queryAnalysis: null,
          resultSummary,
          executionError: null,
          steps: this._sanitizeSteps(tracker.list()),
          tableData,
        };
      } catch (error) {
        const errorMessage = this._resolveExecutionError(error);
        tracker.setStatus("execute", "failed", errorMessage);
        return {
          queryId: null,
          query: JSON.stringify(parsed),
          responseText: errorMessage,
          queryAnalysis: null,
          resultSummary: null,
          executionError: errorMessage,
          steps: this._sanitizeSteps(tracker.list()),
        };
      }
    }

    // Phase 1: Enrich query context (optional but recommended)
    let enrichedContext = null;
    try {
      tracker.addStep({ id: "enrich", label: "Analyze query", status: "running" });
      enrichedContext = await this.enrichQuery({
        connectionId,
        dbType: normalizedDbType,
        dbName: currentDb,
        prompt,
        options: {
          intentTimeoutMs: llmBudget.nextTimeout(CHAT_INTENT_TIMEOUT_MS, CHAT_MIN_LLM_TIMEOUT_MS),
        },
      });
      tracker.setStatus("enrich", "done", `Intent: ${enrichedContext.queryIntent}`);
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
      timeoutMs: llmBudget.nextTimeout(CHAT_PLAN_TIMEOUT_MS, CHAT_MIN_LLM_TIMEOUT_MS),
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
        steps: this._sanitizeSteps(tracker.list()),
      };
    }

    // Use AI-determined intent from enrichedContext
    // If enrichment failed, the AI already has regex fallback built-in via _fallbackIntentDetection
    const shouldForceWrite = this._detectWriteIntent(prompt);
    const intent = enrichedContext?.queryIntent
      ? {
          type: shouldForceWrite ? "ddl_query" : enrichedContext.queryIntent,
          tableName: enrichedContext.relevantEntities?.[0]?.name || null,
        }
      : { type: "general" }; // This should rarely happen since enrichQuery has robust fallbacks

    logger.info("🎯 Intent determined", {
      type: intent.type,
      tableName: intent.tableName,
      fromEnrichment: !!enrichedContext,
    });

    const capabilityCheck = this._validateIntentCapabilities({
      intentType: intent.type,
      prompt,
      dbType: normalizedDbType,
      capabilities: enrichedContext?.capabilities,
    });
    if (!capabilityCheck.allowed) {
      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
      tracker.setStatus("summarize", "done");
      return {
        queryId: null,
        query: "",
        responseText: capabilityCheck.reason,
        queryAnalysis: null,
        resultSummary: null,
        executionError: capabilityCheck.reason,
        steps: this._sanitizeSteps(tracker.list()),
      };
    }

    const analysis = this.analyzer.analyze(prompt);

    if (this._isRawSqlPrompt(prompt)) {
      tracker.addStep({ id: "generate", label: "Use provided SQL", status: "done" });
      const direct = await this._executeDeterministicSql({
        connectionId,
        dbName: currentDb,
        dbType: normalizedDbType,
        query: prompt,
        tableName: this._extractFirstTableFromSql(prompt) || intent.tableName || "result",
        analysis,
        tracker,
      });
      this._markSkippedSteps(tracker, ["schema", "rag"]);
      return direct;
    }

    tracker.addStep({ id: "schema", label: "Retrieve schema context", status: "running" });
    const tableNames = await this._getTablesCached({
      connectionId,
      dbName: currentDb,
    });
    tracker.setStatus(
      "schema",
      "done",
      tableNames.length ? `Found ${tableNames.length} tables.` : "No tables found.",
    );

    const explicitTable = this._extractTableMention(prompt, tableNames);
    const fallbackTable =
      !explicitTable &&
      conversationContext?.tableName &&
      tableNames.includes(conversationContext.tableName)
        ? conversationContext.tableName
        : null;
    const shouldReuseTable = fallbackTable && this._shouldUseLastTable(prompt);

    if (intent.type === "list_tables") {
      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
      const responseText = this._formatTableListResponse(tableNames);
      const followUps = this._buildFollowUpSuggestions({
        intentType: "list_tables",
        tableName: null,
        resultSummary: null,
        dbType: normalizedDbType,
        query: null,
        availableTables: tableNames,
      });
      const finalResponse = this._appendFollowUps(responseText, followUps);
      tracker.setStatus("summarize", "done");
      this._markSkippedSteps(tracker, ["rag", "generate", "execute"]);
      return {
        queryId: null,
        query: "",
        responseText: finalResponse,
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: null,
        steps: this._sanitizeSteps(tracker.list()),
      };
    }

    tracker.addStep({ id: "rag", label: "Enrich request context", status: "running" });

    // CRITICAL FIX: Prioritize AI-detected entities over embedding similarity
    let selectedTables;
    if (explicitTable) {
      selectedTables = [explicitTable];
    } else if (shouldReuseTable) {
      selectedTables = [fallbackTable];
      intent.tableName = fallbackTable;
    } else {
      selectedTables =
        enrichedContext?.relevantEntities?.length > 0
          ? enrichedContext.relevantEntities.map((e) => e.name).slice(0, 8)
          : this._selectRelevantTables({
              prompt,
              tableNames,
              limit: 8,
            });
    }

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
        steps: this._sanitizeSteps(tracker.list()),
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
            this._getTableInfoCached({
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

    if (CHAT_SAMPLE_ROWS_PER_TABLE > 0 && isSql && selectedTables.length > 0) {
      const sampleTables = selectedTables.slice(0, CHAT_SAMPLE_MAX_TABLES);
      await Promise.all(
        sampleTables.map(async (tableName) => {
          const rows = await this._getSampleRowsCached({
            connectionId,
            dbName: currentDb,
            dbType: normalizedDbType,
            tableName,
            limit: CHAT_SAMPLE_ROWS_PER_TABLE,
          });
          if (rows.length) {
            this._attachSampleRows(tableInfoList, tableName, rows);
          }
        }),
      );
    }

    const isDummyDataRequest = this._isDummyDataRequest(prompt);
    if (intent.type === "ddl_query" && isDummyDataRequest) {
      const targetTable = intent.tableName || selectedTables[0] || null;
      const dummyRowCount = this._extractRowCountFromPrompt(prompt, CHAT_DUMMY_ROW_COUNT);
      const dummyPlan = await this._buildDummyDataInsert({
        connectionId,
        dbName: currentDb,
        dbType: normalizedDbType,
        tableName: targetTable,
        tableInfoList,
        rowCount: dummyRowCount,
      });

      if (!dummyPlan?.query && dummyPlan?.reason) {
        return {
          queryId: null,
          query: "",
          responseText: dummyPlan.reason,
          queryAnalysis: analysis,
          resultSummary: null,
          executionError: dummyPlan.reason,
          steps: this._sanitizeSteps(tracker.list()),
        };
      }

      if (dummyPlan?.query) {
        tracker.addStep({ id: "generate", label: "Draft dummy data insert", status: "done" });
        if (!clarificationContext?.answer) {
          tracker.addStep({ id: "clarify", label: "Confirm write", status: "pending" });
          tracker.setStatus("clarify", "pending", "Awaiting confirmation to insert data.");
          return {
            queryId: null,
            query: "",
            responseText: null,
            clarificationQuestion: this._formatDummyDataConfirmation(dummyPlan),
            queryAnalysis: analysis,
            resultSummary: null,
            executionError: null,
            steps: this._sanitizeSteps(tracker.list()),
          };
        }

        if (!this._isAffirmativeAnswer(clarificationContext.answer)) {
          return {
            queryId: null,
            query: "",
            responseText:
              "Okay, I won't insert any dummy data. Tell me if you'd like a different row count or columns.",
            queryAnalysis: analysis,
            resultSummary: null,
            executionError: null,
            steps: this._sanitizeSteps(tracker.list()),
          };
        }

        const direct = await this._executeDeterministicSql({
          connectionId,
          dbName: currentDb,
          dbType: normalizedDbType,
          query: dummyPlan.query,
          tableName: targetTable || "result",
          analysis,
          tracker,
        });
        return direct;
      }
    }

    if (intent.type === "simple_select") {
      tracker.addStep({ id: "generate", label: "Generate query draft", status: "done" });
      const baseLimit = Number.isFinite(Number(pageSize))
        ? Number(pageSize)
        : CHAT_DEFAULT_PAGE_SIZE;
      const limitOverride = this._extractLimitFromPrompt(prompt);
      const shouldFetchAll = this._shouldFetchAllRows(prompt);
      const effectiveLimit = shouldFetchAll ? CHAT_MAX_ROWS : limitOverride || baseLimit;

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
      const queryLimit = effectiveLimit + 1;
      const query = this._buildSimpleSelectQuery(normalizedDbType, targetTable, queryLimit);

      logger.info("🔍 EXECUTING QUERY", {
        selectQuery: query,
        targetTable,
        requestedLimit: effectiveLimit,
        actualLimit: queryLimit,
        prompt: prompt.substring(0, 60),
      });

      tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
      try {
        await this.mcpRunner.run("switch_database", { connectionId, dbName: currentDb });

        // Execute SELECT query with LIMIT + 1
        const execResult = await this.mcpRunner.run("execute_query", {
          connectionId,
          query: this._normalizeMySqlQuery(normalizedDbType, query),
        });

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
        const fetchedRows = this._extractRowsFromResult(execResult?.result || execResult);
        const totalRows = Number.isFinite(resultSummary?.totalRows)
          ? resultSummary.totalRows
          : null;

        // Detect pagination using LIMIT + 1 pattern or totalRows metadata
        const hasMoreRows =
          fetchedRows.length > effectiveLimit || (totalRows !== null && totalRows > effectiveLimit);
        const displayRows = hasMoreRows ? fetchedRows.slice(0, effectiveLimit) : fetchedRows;
        const responseSummary = {
          rowCount: displayRows.length,
          totalRows,
          columns:
            resultSummary?.columns?.length > 0
              ? resultSummary.columns
              : displayRows.length > 0
                ? Object.keys(displayRows[0])
                : [],
          sampleRows: displayRows.slice(0, Math.min(displayRows.length, 5)),
          hasMore: hasMoreRows,
          approximateTotal: null,
          exactTotal: null,
        };

        logger.info("📊 Pagination Detection", {
          rowCountReturned: fetchedRows.length,
          requestedLimit: effectiveLimit,
          queryLimit,
          hasMoreRows,
        });

        if (hasMoreRows) {
          if (totalRows !== null && totalRows > fetchedRows.length) {
            responseSummary.exactTotal = totalRows;
          } else {
            // Try to get approximate count for better UX (fast metadata query)
            responseSummary.approximateTotal = await this._getApproximateRowCount(
              connectionId,
              normalizedDbType,
              currentDb,
              targetTable,
            );
          }

          logger.info("???? Pagination Result (More Rows)", {
            trimmedRowCount: responseSummary.rowCount,
            hasMore: responseSummary.hasMore,
            approximateTotal: responseSummary.approximateTotal,
            exactTotal: responseSummary.exactTotal,
          });
        } else {
          responseSummary.exactTotal = totalRows || displayRows.length;

          logger.info("??? Pagination Result (All Rows)", {
            exactTotal: responseSummary.exactTotal,
            hasMore: responseSummary.hasMore,
          });
        }

        tracker.setStatus("execute", "done");
        tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });

        // Build structured table data for side panel display
        const tableData = this._buildTableDataResponse({
          tableName: targetTable,
          resultSummary: responseSummary,
          execResult: { rows: displayRows, dbType: normalizedDbType },
          query,
          hasMore: responseSummary.hasMore,
          approximateTotal: responseSummary.approximateTotal,
          exactTotal: responseSummary.exactTotal,
          columnsOverride: this._getColumnsForTable(tableInfoList, targetTable),
          allowEmpty: true,
        });

        logger.info("📦 TABLE DATA CREATED (simple_select)", {
          hasTableData: !!tableData,
          tableName: tableData?.tableName,
          rowCount: tableData?.rows?.length,
          columnCount: tableData?.columns?.length,
        });

        const responseText = this._buildDeterministicResponse({
          tableName: targetTable,
          resultSummary: responseSummary,
          executionError: null,
          query,
        });
        const followUps = this._buildFollowUpSuggestions({
          intentType: intent.type,
          tableName: targetTable,
          resultSummary: responseSummary,
          dbType: normalizedDbType,
          query,
        });
        const finalResponse = this._appendFollowUps(responseText, followUps);
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
          responseText: finalResponse,
          queryAnalysis: analysis,
          resultSummary: responseSummary,
          executionError: null,
          steps: this._sanitizeSteps(tracker.list()),
          tableData, // NEW: Structured data for side panel display
        };
      } catch (error) {
        const errorMessage = this._resolveExecutionError(error);
        tracker.setStatus("execute", "failed", errorMessage);
        logger.error("Simple select execution failed", {
          requestId,
          query,
          error: errorMessage,
        });
        return {
          queryId: null,
          query,
          responseText: errorMessage,
          queryAnalysis: analysis,
          resultSummary: null,
          executionError: errorMessage,
          steps: this._sanitizeSteps(tracker.list()),
        };
      }
    }

    const fallbackLimit = Number.isFinite(Number(pageSize))
      ? Number(pageSize)
      : CHAT_DEFAULT_PAGE_SIZE;
    const targetTable = intent.tableName || selectedTables[0] || null;

    if ((intent.type === "aggregation_query" || this._looksLikeCount(prompt)) && targetTable) {
      tracker.addStep({ id: "generate", label: "Generate aggregation query", status: "done" });
      const countQuery = this._buildCountQuery(normalizedDbType, targetTable);

      const direct = await this._executeDeterministicSql({
        connectionId,
        dbName: currentDb,
        dbType: normalizedDbType,
        query: countQuery,
        tableName: targetTable,
        analysis,
        tracker,
      });
      return direct;
    }

    if (intent.type === "join_query") {
      const joinQuery = this._buildJoinQuery({
        dbType: normalizedDbType,
        tables: selectedTables,
        tableInfoList,
        limit: this._extractLimitFromPrompt(prompt) || fallbackLimit,
      });
      if (joinQuery) {
        tracker.addStep({ id: "generate", label: "Generate JOIN query", status: "done" });
        const direct = await this._executeDeterministicSql({
          connectionId,
          dbName: currentDb,
          dbType: normalizedDbType,
          query: joinQuery,
          tableName: targetTable || "result",
          analysis,
          tracker,
        });
        return direct;
      }
    }

    if (intent.type === "ddl_query") {
      const writeQuery = this._buildSimpleWriteQuery(prompt);
      if (writeQuery) {
        tracker.addStep({ id: "generate", label: "Generate write query", status: "done" });
        const writeTable = this._extractFirstTableFromSql(writeQuery);
        if (!clarificationContext?.answer) {
          tracker.addStep({ id: "clarify", label: "Confirm write", status: "pending" });
          tracker.setStatus("clarify", "pending", "Awaiting confirmation to execute write.");
          return {
            queryId: null,
            query: "",
            responseText: null,
            clarificationQuestion:
              'This request will modify data. Reply "yes" to proceed or specify changes.',
            queryAnalysis: analysis,
            resultSummary: null,
            executionError: null,
            steps: this._sanitizeSteps(tracker.list()),
          };
        }

        if (!this._isAffirmativeAnswer(clarificationContext.answer)) {
          return {
            queryId: null,
            query: "",
            responseText:
              "Okay, I won't run that write operation. Tell me what changes you'd like.",
            queryAnalysis: analysis,
            resultSummary: null,
            executionError: null,
            steps: this._sanitizeSteps(tracker.list()),
          };
        }

        const direct = await this._executeDeterministicSql({
          connectionId,
          dbName: currentDb,
          dbType: normalizedDbType,
          query: writeQuery,
          tableName: writeTable || targetTable || "result",
          analysis,
          tracker,
        });
        return direct;
      }
    }

    const packedTableInfoList = this._packTableInfoList(
      tableInfoList,
      CHAT_CONTEXT_MAX_TABLES,
      CHAT_CONTEXT_MAX_COLUMNS,
    );
    const dbMeta = this._buildDbMeta(currentDb, packedTableInfoList);

    tracker.addStep({ id: "generate", label: "Generate query draft", status: "running" });
    let query;
    try {
      const generation = await this.queryGenerator.generate({
        connectionId,
        dbType: normalizedDbType,
        dbName: currentDb,
        prompt: this._buildPromptWithClarification(prompt, clarificationContext),
        model,
        apiKey,
        selectedTables,
        dbMeta,
        enrichedContext,
        llmOptions: {
          timeoutMs: llmBudget.nextTimeout(llmService.requestTimeoutMs || CHAT_LLM_BUDGET_MS),
          retryOnTimeout: true,
          maxRetries: 1,
          promptCharLimit: 800,
        },
      });

      query = generation?.query;
      tracker.setStatus(
        "generate",
        "done",
        generation?.source === "orchestrator" ? "Query draft ready" : null,
      );

      if (!query || typeof query !== "string" || query.trim().length === 0) {
        throw new Error("Generated query is empty or invalid");
      }
    } catch (error) {
      tracker.setStatus("generate", "failed", error?.message || "Query generation failed");
      logger.error("Query generation failed", { requestId, error: error?.message || error });
      return {
        queryId: null,
        query: "",
        responseText:
          "I couldn't generate a valid query for that request. Please provide the exact SQL or clarify the columns and table.",
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: error?.message || "Query generation failed",
        steps: this._sanitizeSteps(tracker.list()),
      };
    }

    if (this._isWriteSql(query)) {
      if (!clarificationContext?.answer) {
        tracker.addStep({ id: "clarify", label: "Confirm write", status: "pending" });
        tracker.setStatus("clarify", "pending", "Awaiting confirmation to execute write.");
        return {
          queryId: null,
          query,
          responseText: null,
          clarificationQuestion:
            'This query will modify data. Reply "yes" to proceed or provide changes.',
          queryAnalysis: analysis,
          resultSummary: null,
          executionError: null,
          steps: this._sanitizeSteps(tracker.list()),
        };
      }

      if (!this._isAffirmativeAnswer(clarificationContext.answer)) {
        return {
          queryId: null,
          query: "",
          responseText:
            "Okay, I won't run that write operation. Let me know what you'd like instead.",
          queryAnalysis: analysis,
          resultSummary: null,
          executionError: null,
          steps: this._sanitizeSteps(tracker.list()),
        };
      }
    }

    tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
    let execResult;
    try {
      await this.mcpRunner.run("switch_database", { connectionId, dbName: currentDb });
      const normalizedQuery = this._normalizeMySqlQuery(normalizedDbType, query);
      execResult = await this.mcpRunner.run("execute_query", {
        connectionId,
        query: normalizedQuery,
      });
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
      const followUps = this._buildFollowUpSuggestions({
        intentType: intent.type,
        tableName: intent.tableName || selectedTables[0] || "result",
        resultSummary,
        dbType: normalizedDbType,
        query,
      });
      const finalResponse = this._appendFollowUps(responseText, followUps);
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
        responseText: finalResponse,
        queryAnalysis: analysis,
        resultSummary,
        executionError: null,
        steps: this._sanitizeSteps(tracker.list()),
        tableData, // NEW: Structured data for side panel display
      };
    } catch (error) {
      const errorMessage = this._resolveExecutionError(error);
      tracker.setStatus("execute", "failed", errorMessage);
      logger.error("Query execution failed", {
        requestId,
        query,
        error: errorMessage,
        stack: error?.stack,
      });
      return {
        queryId: null,
        query,
        responseText: errorMessage,
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: errorMessage,
        steps: this._sanitizeSteps(tracker.list()),
      };
    }
  }

  async _planSteps({
    prompt,
    dbType,
    dbName,
    clarificationContext,
    enrichedContext,
    timeoutMs,
  } = {}) {
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

    const effectiveTimeout = Number.isFinite(timeoutMs) ? timeoutMs : CHAT_PLAN_TIMEOUT_MS;
    if (effectiveTimeout <= CHAT_MIN_LLM_TIMEOUT_MS) {
      logger.warn("Planning skipped due to timeout budget");
      return {
        needsClarification: false,
        clarificationQuestion: null,
        steps: enrichedContext?.plannedSteps?.length
          ? enrichedContext.plannedSteps.map((s) => ({
              id: s.id,
              label: s.label,
              reasoning: `Confidence: ${s.confidence || 0.5}`,
            }))
          : DEFAULT_STEP_DEFS,
      };
    }

    try {
      const response = await llmService.callWithTimeout(
        [
          { role: "system", content: system },
          {
            role: "user",
            content: `Plan steps for this database query:\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        effectiveTimeout,
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
      sampleRows: Array.isArray(info?.sampleRows) ? info.sampleRows : [],
    };
  }

  _getColumnsForTable(tableInfoList, tableName) {
    if (!tableName || !Array.isArray(tableInfoList)) {
      return [];
    }
    const target = String(tableName).toLowerCase();
    for (const entry of tableInfoList) {
      const info = entry?.tableInfo || entry;
      const name = String(
        info?.table_name || info?.tableName || info?.name || info?.table || "",
      ).toLowerCase();
      if (!name || name !== target) continue;
      const cols = Array.isArray(info?.columns) ? info.columns : [];
      return cols
        .map((col) => col.column_name ?? col.name ?? null)
        .filter((col) => typeof col === "string" && col.length > 0);
    }
    return [];
  }

  _extractTableMention(prompt, tableNames) {
    if (!prompt || !Array.isArray(tableNames) || tableNames.length === 0) {
      return null;
    }
    const text = String(prompt).toLowerCase();
    for (const name of tableNames) {
      if (!name) continue;
      const table = String(name).toLowerCase();
      const pattern = new RegExp(`\\b${table}\\b`, "i");
      if (pattern.test(text)) {
        return name;
      }
    }
    return null;
  }

  _shouldUseLastTable(prompt) {
    const text = String(prompt || "").toLowerCase();
    return /\b(now|again|same|it|that|those|all data|all rows|get all|show all)\b/.test(text);
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

  _extractRowsFromResult(result) {
    if (!result || typeof result !== "object") {
      return [];
    }

    if (Array.isArray(result.rows)) {
      return result.rows;
    }
    if (Array.isArray(result.result?.rows)) {
      return result.result.rows;
    }
    if (Array.isArray(result.documents)) {
      return result.documents;
    }
    if (Array.isArray(result.result?.documents)) {
      return result.result.documents;
    }
    if (Array.isArray(result.keys)) {
      const values = Array.isArray(result.values) ? result.values : [];
      return result.keys.map((key, idx) => ({
        key,
        value: values[idx],
      }));
    }
    if (result.key !== undefined) {
      return [
        {
          key: result.key,
          value: result.value,
        },
      ];
    }
    if (result.value !== undefined) {
      return [{ value: result.value }];
    }

    const queries = Array.isArray(result.queries)
      ? result.queries
      : Array.isArray(result.result?.queries)
        ? result.result.queries
        : null;
    if (Array.isArray(queries) && queries.length > 0) {
      const firstWithRows =
        queries.find((entry) => Array.isArray(entry?.rows)) ||
        queries.find((entry) => Array.isArray(entry?.results?.rows)) ||
        queries[0];
      if (Array.isArray(firstWithRows?.rows)) {
        return firstWithRows.rows;
      }
      if (Array.isArray(firstWithRows?.results?.rows)) {
        return firstWithRows.results.rows;
      }
    }

    return [];
  }

  _summarizeResult(result) {
    if (!result || typeof result !== "object") {
      return null;
    }

    let rows = [];
    let totalRows = null;
    let affectedRows = null;
    if (typeof result.affectedRows === "number") {
      affectedRows = result.affectedRows;
    } else if (typeof result.rowCount === "number") {
      affectedRows = result.rowCount;
    } else if (typeof result.rowsAffected === "number") {
      affectedRows = result.rowsAffected;
    } else if (typeof result?.stats?.affectedRows === "number") {
      affectedRows = result.stats.affectedRows;
    }
    if (Array.isArray(result.rows)) {
      rows = result.rows;
      totalRows = typeof result.totalRows === "number" ? result.totalRows : null;
    } else if (Array.isArray(result.documents)) {
      rows = result.documents;
      totalRows = typeof result.totalRows === "number" ? result.totalRows : null;
    } else if (Array.isArray(result.keys)) {
      const values = Array.isArray(result.values) ? result.values : [];
      rows = result.keys.map((key, idx) => ({
        key,
        value: values[idx],
      }));
      totalRows = rows.length;
    } else if (Array.isArray(result.queries)) {
      const firstWithRows =
        result.queries.find((entry) => Array.isArray(entry?.rows)) ||
        result.queries.find((entry) => Array.isArray(entry?.documents)) ||
        result.queries[0];
      if (Array.isArray(firstWithRows?.rows)) {
        rows = firstWithRows.rows;
      } else if (Array.isArray(firstWithRows?.documents)) {
        rows = firstWithRows.documents;
      } else {
        rows = [];
      }
      totalRows = typeof firstWithRows?.totalRows === "number" ? firstWithRows.totalRows : null;
    }
    const sampleRows = rows.slice(0, Math.min(rows.length, 5));
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    return {
      rowCount: rows.length,
      totalRows,
      columns,
      sampleRows,
      affectedRows,
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
    rowsOverride,
    columnsOverride,
    allowEmpty,
  }) {
    logger.info("🔧 BUILD TABLE DATA RESPONSE", {
      hasResultSummary: !!resultSummary,
      rowCount: resultSummary?.rowCount,
      hasExecResult: !!execResult,
      execResultKeys: execResult ? Object.keys(execResult) : [],
      sampleRowsLength: resultSummary?.sampleRows?.length,
    });

    if (!resultSummary || (!resultSummary.rowCount && !allowEmpty)) {
      logger.warn("⚠️ NO DATA TO DISPLAY - returning null", { resultSummary });
      return null; // No data to display
    }

    // Extract raw rows from execution result
    const rows =
      (Array.isArray(rowsOverride) ? rowsOverride : null) ||
      this._extractRowsFromResult(execResult) ||
      resultSummary.sampleRows ||
      [];

    const usedOverride = Array.isArray(rowsOverride);
    const usedSampleRows = rows === resultSummary.sampleRows;
    const usedExecResult = !usedOverride && !usedSampleRows;

    logger.info("📊 EXTRACTED ROWS", {
      rowCount: rows.length,
      fromExecResult: usedExecResult,
      fromOverride: usedOverride,
      fromSampleRows: usedSampleRows,
      firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
    });

    // Get column information
    const columns =
      Array.isArray(columnsOverride) && columnsOverride.length > 0
        ? columnsOverride
        : resultSummary?.columns?.length > 0
          ? resultSummary.columns
          : rows.length > 0
            ? Object.keys(rows[0])
            : [];

    // Detect database type to determine display format
    const dbType = execResult?.dbType || execResult?.result?.dbType || "sql";
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
      pageSize: rows.length,
      totalRows: exactTotal || approximateTotal || resultSummary?.totalRows || null,
      hasMore,
      isApproximate: approximateTotal !== null && exactTotal === null,
    };

    // If no rows were extracted, return null
    if (rows.length === 0 && !allowEmpty) {
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
      totalRows: exactTotal || approximateTotal || resultSummary?.totalRows || rows.length,
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

  _buildDeterministicResponse({ tableName, resultSummary, executionError, query }) {
    if (executionError) {
      return executionError;
    }
    if (!resultSummary) {
      return `I ran the query for ${tableName}, but couldn't summarize the results.`;
    }

    const isWrite =
      typeof query === "string" &&
      /^\s*(insert|update|delete|create|alter|drop|truncate)\b/i.test(query);
    if (isWrite) {
      const affected =
        typeof resultSummary.affectedRows === "number"
          ? resultSummary.affectedRows
          : typeof resultSummary.rowCount === "number"
            ? resultSummary.rowCount
            : null;
      if (typeof affected === "number" && affected > 0) {
        return `Query executed successfully (${affected} rows affected).`;
      }
      return `Query executed successfully${tableName ? ` on ${tableName}` : ""}.`;
    }

    if (!resultSummary.rowCount) {
      return `No rows found in ${tableName}.`;
    }

    // Build pagination-aware count message using LIMIT+1 detection
    const fetchedCount = resultSummary.rowCount;
    const exactTotal =
      typeof resultSummary.exactTotal === "number"
        ? resultSummary.exactTotal
        : typeof resultSummary.totalRows === "number"
          ? resultSummary.totalRows
          : null;
    let countMessage;

    logger.info("💬 Building Response Message", {
      fetchedCount,
      hasMore: resultSummary.hasMore,
      approximateTotal: resultSummary.approximateTotal,
      exactTotal: resultSummary.exactTotal,
    });

    if (resultSummary.hasMore) {
      if (exactTotal && exactTotal > fetchedCount) {
        countMessage = `I fetched ${fetchedCount} rows from ${tableName} (${exactTotal} total rows).`;
      } else if (resultSummary.approximateTotal && resultSummary.approximateTotal > fetchedCount) {
        countMessage = `I fetched ${fetchedCount} rows from ${tableName} (~${resultSummary.approximateTotal} total rows available).`;
      } else {
        countMessage = `I fetched ${fetchedCount} rows from ${tableName} (more rows available).`;
      }
    } else if (exactTotal !== null) {
      countMessage = `I fetched all ${exactTotal} rows from ${tableName}.`;
    } else {
      countMessage = `I fetched ${fetchedCount} rows from ${tableName}.`;
    }

    const columns =
      resultSummary.columns && resultSummary.columns.length
        ? ` Columns: ${resultSummary.columns.join(", ")}.`
        : "";
    return `${countMessage}${columns}`;
  }

  _buildFollowUpSuggestions({
    intentType,
    tableName,
    resultSummary,
    dbType,
    query,
    availableTables,
  }) {
    if (!CHAT_FOLLOWUP_ENABLED) return [];
    const suggestions = [];
    const safeTable = tableName || "the table";
    const rowCount = Number.isFinite(resultSummary?.rowCount) ? resultSummary.rowCount : null;
    const isWrite = intentType === "ddl_query" || this._isWriteSql(query);
    const normalizedDbType = String(dbType || "").toLowerCase();

    if (intentType === "list_tables") {
      if (Array.isArray(availableTables) && availableTables.length) {
        suggestions.push("Pick a table to preview columns.");
      }
      suggestions.push("Ask for a sample row from a specific table.");
      return suggestions.slice(0, CHAT_FOLLOWUP_MAX);
    }

    if (isWrite) {
      suggestions.push(`Verify changes by selecting recent rows in ${safeTable}.`);
      suggestions.push("Check how many rows were affected.");
      suggestions.push("I can help update or delete specific records.");
      return suggestions.slice(0, CHAT_FOLLOWUP_MAX);
    }

    if (rowCount === 0) {
      suggestions.push(`Check filters or try a smaller sample from ${safeTable}.`);
      suggestions.push(`List columns for ${safeTable} to refine the query.`);
      return suggestions.slice(0, CHAT_FOLLOWUP_MAX);
    }

    if (rowCount !== null) {
      suggestions.push(`Get a total count for ${safeTable}.`);
      if (this.sqlDbTypes.has(normalizedDbType)) {
        suggestions.push("Add filters (date, status) to narrow results.");
        suggestions.push("Sort by a column to see top results.");
      } else {
        suggestions.push("Filter by a field value to narrow results.");
      }
    }

    return suggestions.slice(0, CHAT_FOLLOWUP_MAX);
  }

  _appendFollowUps(responseText, suggestions) {
    if (!CHAT_FOLLOWUP_ENABLED) return responseText;
    if (!responseText) return responseText;
    if (!Array.isArray(suggestions) || suggestions.length === 0) return responseText;
    const suffix = suggestions.join(" ");
    const spacer = responseText.endsWith(".") ? " " : ". ";
    return `${responseText}${spacer}Next steps: ${suffix}`;
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

  _shouldFetchAllRows(prompt) {
    const text = String(prompt || "").toLowerCase();
    return /\b(all|entire|everything|every|full|complete)\b/.test(text);
  }

  _formatStrategyLabel(strategyName) {
    const map = {
      DirectSQLStrategy: "Direct SQL",
      RAGEnhancedStrategy: "RAG Enhanced",
      DecompositionStrategy: "Decompose & Query",
      ExplanationStrategy: "Explain",
      SuggestionStrategy: "Suggest alternatives",
    };
    return map[strategyName] || strategyName || "Strategy";
  }

  _formatStepLabel(step) {
    const map = {
      enrich: "Analyze request",
      plan: "Plan steps",
      schema: "Fetch schema",
      rag: "Find relevant tables",
      generate: "Write query",
      execute: "Run query",
      summarize: "Summarize results",
      clarify: "Clarify question",
      explain: "Explain response",
      suggest: "Suggest options",
      analyze: "Analyze request",
    };
    if (step?.label && step.label !== step.id) {
      return step.label;
    }
    if (step?.id && map[step.id]) {
      return map[step.id];
    }
    return step?.label || step?.id || "Step";
  }

  _resolveDatabaseName({ dbType, dbName, connectionInfo } = {}) {
    let currentDb =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database || null;
    const normalized = String(dbType || "").toLowerCase();
    if (normalized !== "oracledb") {
      return currentDb;
    }
    const serviceName = connectionInfo?.config?.database || null;
    const username = connectionInfo?.config?.username || null;
    if (!currentDb || (serviceName && currentDb === serviceName)) {
      currentDb = username || currentDb;
    }
    return currentDb;
  }

  _resolveExecutionError(error) {
    if (!error) return "Query execution failed.";
    if (typeof error === "string") return error;
    return (
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.cause?.message ||
      error?.message ||
      "Query execution failed."
    );
  }

  _tryParseJsonPrompt(prompt) {
    if (!prompt || typeof prompt !== "string") return null;
    const trimmed = prompt.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  _isRawSqlPrompt(prompt) {
    if (!prompt || typeof prompt !== "string") return false;
    const text = prompt.trim();
    if (!text) return false;
    const lower = text.toLowerCase();

    if (/^(select|with)\b/.test(lower)) return true;

    if (/^insert\b/.test(lower)) {
      return (
        /\binsert\s+into\b/.test(lower) && (/\bvalues\b/.test(lower) || /\bselect\b/.test(lower))
      );
    }

    if (/^update\b/.test(lower)) {
      return /\bupdate\s+[\w.]+\s+set\b/.test(lower);
    }

    if (/^delete\b/.test(lower)) {
      return /\bdelete\s+from\b/.test(lower);
    }

    if (/^create\b/.test(lower)) {
      if (/\bcreate\s+table\b/.test(lower)) {
        return /\(/.test(lower) || /\bas\s+select\b/.test(lower);
      }
      if (/\bcreate\s+index\b/.test(lower)) {
        return /\bon\b/.test(lower);
      }
      if (/\bcreate\s+(view|schema|database)\b/.test(lower)) {
        return true;
      }
      return false;
    }

    if (/^alter\b/.test(lower)) {
      return /\balter\s+table\b/.test(lower);
    }

    if (/^drop\b/.test(lower)) {
      return /\bdrop\s+(table|index|view|schema|database)\b/.test(lower);
    }

    if (/^truncate\b/.test(lower)) {
      return /\btruncate\s+table\b/.test(lower);
    }

    if (/^show\b/.test(lower)) {
      return /^(show\s+(tables|databases|columns|index|indexes|create))\b/.test(lower);
    }

    if (/^describe\b/.test(lower)) {
      return /^describe\s+\w+/.test(lower);
    }

    if (/^explain\b/.test(lower)) {
      return /^explain\s+\w+/.test(lower);
    }

    return false;
  }

  _extractFirstTableFromSql(sql) {
    if (!sql || typeof sql !== "string") return null;
    const m = sql.match(/\b(from|join|into|update|table)\s+([`"'[\]]?[\w.]+[`"'[\]]?)/i);
    if (!m || !m[2]) return null;
    return m[2].replace(/^[`"'[\]]+|[`"'[\]]+$/g, "");
  }

  _extractLimitFromPrompt(prompt) {
    if (!prompt || typeof prompt !== "string") return null;
    const text = prompt.toLowerCase();
    const match =
      text.match(/\b(?:limit|top|first)\s+(\d+)\b/) ||
      text.match(/\b(?:show|list|get|fetch|display)\s+(\d+)\s+(?:rows|items|records)?\b/) ||
      text.match(/\b(\d+)\s+(?:rows|items|records)\b/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  _extractRowCountFromPrompt(prompt, fallback = CHAT_DUMMY_ROW_COUNT) {
    if (!prompt || typeof prompt !== "string") return fallback;
    const text = prompt.toLowerCase();
    const match =
      text.match(/\b(?:add|insert|seed|populate)\s+(\d+)\s+(?:rows|records|items)\b/) ||
      text.match(/\b(\d+)\s+(?:rows|records|items)\b/);
    if (!match) return fallback;
    const value = parseInt(match[1], 10);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(value, CHAT_DUMMY_MAX_ROWS);
  }

  _isDummyDataRequest(prompt) {
    const text = String(prompt || "").toLowerCase();
    return (
      /\b(dummy|sample|fake|test)\s+data\b/.test(text) ||
      /\b(seed|populate|bootstrap)\b/.test(text) ||
      /\b(add|insert)\s+dummy\s+data\b/.test(text)
    );
  }

  _isAffirmativeAnswer(answer) {
    const text = String(answer || "")
      .trim()
      .toLowerCase();
    return /^(y|yes|ok|okay|sure|confirm|proceed|do it)\b/.test(text);
  }

  _isNegativeAnswer(answer) {
    const text = String(answer || "")
      .trim()
      .toLowerCase();
    return /^(n|no|nope|stop|cancel|dont|don't)\b/.test(text);
  }

  _sanitizeIdentifier(identifier) {
    return String(identifier || "").replace(/[^\w_]/g, "");
  }

  _sanitizeTableName(name) {
    return String(name || "")
      .split(".")
      .map((part) => this._sanitizeIdentifier(part))
      .filter(Boolean)
      .join(".");
  }

  _applyLimit(dbType, baseQuery, limit) {
    if (!limit || !baseQuery) return baseQuery;
    const normalized = String(dbType || "").toLowerCase();
    if (normalized === "mssql") {
      return baseQuery.replace(/^\s*select\s+/i, `SELECT TOP (${limit}) `);
    }
    if (normalized === "oracledb") {
      return `${baseQuery} FETCH FIRST ${limit} ROWS ONLY`;
    }
    return `${baseQuery} LIMIT ${limit}`;
  }

  _buildCountQuery(dbType, tableName) {
    const safeTable = this._sanitizeTableName(tableName);
    if (!safeTable) return null;
    return `SELECT COUNT(*) AS count FROM ${safeTable}`;
  }

  _looksLikeCount(prompt) {
    const text = String(prompt || "").toLowerCase();
    return /\b(count|how many|number of|total)\b/.test(text);
  }

  _buildJoinQuery({ dbType, tables, tableInfoList, limit } = {}) {
    if (!Array.isArray(tables) || tables.length < 2) return null;
    const infoByName = new Map();
    for (const info of tableInfoList || []) {
      if (info?.table_name) {
        infoByName.set(String(info.table_name).toLowerCase(), info);
      }
    }

    const normalizeName = (name) => String(name || "").toLowerCase();

    const findFkJoin = () => {
      for (const info of tableInfoList || []) {
        const tableName = info?.table_name;
        const foreignKeys = Array.isArray(info?.foreign_keys) ? info.foreign_keys : [];
        for (const fk of foreignKeys) {
          if (fk?.column_name && fk?.referenced_table && fk?.referenced_column) {
            return {
              leftTable: tableName,
              leftColumn: fk.column_name,
              rightTable: fk.referenced_table,
              rightColumn: fk.referenced_column,
            };
          }
          if (fk?.definition) {
            const def = String(fk.definition);
            const m = def.match(
              /FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]+)\)/i,
            );
            if (m && m[1] && m[2] && m[3]) {
              return {
                leftTable: tableName,
                leftColumn: m[1].split(",")[0].trim(),
                rightTable: m[2].replace(/["'`]/g, ""),
                rightColumn: m[3].split(",")[0].trim(),
              };
            }
          }
        }
      }
      return null;
    };

    const fkJoin = findFkJoin();
    if (fkJoin) {
      const leftTable = this._sanitizeTableName(fkJoin.leftTable);
      const rightTable = this._sanitizeTableName(fkJoin.rightTable);
      const leftColumn = this._sanitizeIdentifier(fkJoin.leftColumn);
      const rightColumn = this._sanitizeIdentifier(fkJoin.rightColumn);
      if (leftTable && rightTable && leftColumn && rightColumn) {
        const base = `SELECT * FROM ${leftTable} JOIN ${rightTable} ON ${leftTable}.${leftColumn} = ${rightTable}.${rightColumn}`;
        return this._applyLimit(dbType, base, limit);
      }
    }

    const tableA = tables[0];
    const tableB = tables[1];
    const infoA = infoByName.get(normalizeName(tableA));
    const infoB = infoByName.get(normalizeName(tableB));
    const colsA = (infoA?.columns || []).map((c) =>
      String(c.column_name || c.name || "").toLowerCase(),
    );
    const colsB = (infoB?.columns || []).map((c) =>
      String(c.column_name || c.name || "").toLowerCase(),
    );

    const nameA = normalizeName(tableA);
    const nameB = normalizeName(tableB);
    const candidateA = `${nameB}_id`;
    const candidateB = `${nameA}_id`;

    if (colsA.includes(candidateA) && colsB.includes("id")) {
      const base = `SELECT * FROM ${this._sanitizeTableName(tableA)} JOIN ${this._sanitizeTableName(tableB)} ON ${this._sanitizeTableName(tableA)}.${this._sanitizeIdentifier(candidateA)} = ${this._sanitizeTableName(tableB)}.id`;
      return this._applyLimit(dbType, base, limit);
    }

    if (colsB.includes(candidateB) && colsA.includes("id")) {
      const base = `SELECT * FROM ${this._sanitizeTableName(tableB)} JOIN ${this._sanitizeTableName(tableA)} ON ${this._sanitizeTableName(tableB)}.${this._sanitizeIdentifier(candidateB)} = ${this._sanitizeTableName(tableA)}.id`;
      return this._applyLimit(dbType, base, limit);
    }

    const common = colsA.find((col) => colsB.includes(col) && col.endsWith("_id"));
    if (common) {
      const base = `SELECT * FROM ${this._sanitizeTableName(tableA)} JOIN ${this._sanitizeTableName(tableB)} ON ${this._sanitizeTableName(tableA)}.${this._sanitizeIdentifier(common)} = ${this._sanitizeTableName(tableB)}.${this._sanitizeIdentifier(common)}`;
      return this._applyLimit(dbType, base, limit);
    }

    return null;
  }

  _createLlmBudget(totalMs) {
    const total = Number.isFinite(totalMs) ? totalMs : CHAT_LLM_BUDGET_MS;
    const startedAt = Date.now();
    const remainingMs = () => Math.max(0, total - (Date.now() - startedAt));
    const nextTimeout = (preferredMs) => {
      const remaining = remainingMs();
      if (!Number.isFinite(preferredMs)) {
        return remaining;
      }
      return Math.min(preferredMs, remaining);
    };
    return { totalMs: total, remainingMs, nextTimeout };
  }

  async _buildDummyDataInsert({
    connectionId,
    dbName,
    dbType,
    tableName,
    tableInfoList,
    rowCount,
  } = {}) {
    const safeTable = this._sanitizeTableName(tableName);
    if (!safeTable) return null;

    const normalizeName = (name) => String(name || "").toLowerCase();
    const targetName = normalizeName(safeTable);
    const infoEntry =
      (tableInfoList || []).find((entry) => {
        const info = entry?.tableInfo || entry;
        const name = info?.table_name || info?.tableName || info?.name || info?.table;
        return normalizeName(name) === targetName;
      }) || null;

    const info = infoEntry?.tableInfo || infoEntry;
    const columnsRaw = Array.isArray(info?.columns) ? info.columns : [];
    if (columnsRaw.length === 0) return null;

    const columns = columnsRaw
      .map((col) => ({
        name: col.column_name ?? col.name ?? null,
        dataType: col.data_type ?? col.dataType ?? col.type ?? "",
        isNullable: col.is_nullable ?? col.isNullable ?? null,
        defaultValue: col.column_default ?? col.default_value ?? col.defaultValue ?? null,
        extra: col.extra ?? "",
        isPrimaryKey: col.is_primary_key ?? col.isPrimaryKey ?? col.column_key === "PRI",
      }))
      .filter((col) => col.name);

    const insertable = columns.filter((col) => !this._isAutoIncrementColumn(col));
    const required = insertable.filter((col) => this._isRequiredColumn(col));
    const selected =
      required.length > 0 ? required : insertable.slice(0, Math.min(insertable.length, 8));

    if (!selected.length) return null;

    const count = Math.min(
      Math.max(1, Number.isFinite(rowCount) ? rowCount : CHAT_DUMMY_ROW_COUNT),
      CHAT_DUMMY_MAX_ROWS,
    );
    const fkMap = new Map();
    const foreignKeys = Array.isArray(info?.foreign_keys) ? info.foreign_keys : [];
    foreignKeys.forEach((fk) => {
      if (fk?.column_name && fk?.referenced_table && fk?.referenced_column) {
        fkMap.set(String(fk.column_name), {
          table: fk.referenced_table,
          column: fk.referenced_column,
        });
      }
    });

    const fkValues = {};
    for (const col of selected) {
      const fk = fkMap.get(col.name);
      if (!fk) continue;
      const value = await this._resolveForeignKeyValue({
        connectionId,
        dbName,
        dbType,
        referencedTable: fk.table,
        referencedColumn: fk.column,
      });
      if (value === null || value === undefined) {
        return {
          reason: `The ${safeTable}.${col.name} column references ${fk.table}.${fk.column}, but no matching rows were found. Please seed ${fk.table} first or provide a valid ${col.name}.`,
        };
      }
      fkValues[col.name] = value;
    }

    const rows = [];
    let previewRow = null;
    for (let i = 0; i < count; i += 1) {
      const values = selected.map((col) => {
        if (Object.prototype.hasOwnProperty.call(fkValues, col.name)) {
          return fkValues[col.name];
        }
        return this._dummyValueForColumn(col, i);
      });
      if (i === 0) {
        previewRow = selected.reduce((acc, col, idx) => {
          acc[col.name] = values[idx];
          return acc;
        }, {});
      }
      rows.push(`(${values.map((val, idx) => this._sqlValue(val, selected[idx])).join(", ")})`);
    }

    const columnsSql = selected.map((col) => this._sanitizeIdentifier(col.name)).join(", ");
    const query = `INSERT INTO ${safeTable} (${columnsSql}) VALUES ${rows.join(", ")}`;

    return {
      query,
      tableName: safeTable,
      columns: selected.map((col) => col.name),
      rowCount: count,
      previewRow,
    };
  }

  _formatDummyDataConfirmation(dummyPlan) {
    const tableName = dummyPlan?.tableName || "the table";
    const count = dummyPlan?.rowCount || CHAT_DUMMY_ROW_COUNT;
    const columns = Array.isArray(dummyPlan?.columns) ? dummyPlan.columns : [];
    const preview = dummyPlan?.previewRow ? this._safeRowToString(dummyPlan.previewRow) : null;
    const columnText = columns.length ? ` Columns: ${columns.join(", ")}.` : "";
    const previewText = preview ? ` Preview row: ${preview}.` : "";
    return `I can insert ${count} dummy rows into ${tableName}.${columnText}${previewText} Reply "yes" to proceed or specify a different row count.`;
  }

  _isAutoIncrementColumn(column) {
    const extra = String(column?.extra || "").toLowerCase();
    return extra.includes("auto_increment");
  }

  _isRequiredColumn(column) {
    const isNullable = column?.isNullable;
    const nullable =
      isNullable === true || isNullable === "YES" || isNullable === "yes" || isNullable === 1;
    const hasDefault = column?.defaultValue !== null && column?.defaultValue !== undefined;
    return !nullable && !hasDefault && !this._isAutoIncrementColumn(column);
  }

  _dummyValueForColumn(column, index) {
    const name = String(column?.name || "").toLowerCase();
    const type = String(column?.dataType || "").toLowerCase();
    const seq = index + 1;

    if (name.includes("email")) {
      return `user${seq}@example.com`;
    }
    if (name.includes("phone")) {
      return `555-010${seq.toString().padStart(2, "0")}`;
    }
    if (name.includes("zip") || name.includes("postal")) {
      return `1000${seq}`;
    }
    if (name.includes("city")) {
      return "Springfield";
    }
    if (name.includes("state")) {
      return "CA";
    }
    if (name.includes("country")) {
      return "USA";
    }
    if (name.includes("street") || name.includes("address")) {
      return `${100 + seq} Main St`;
    }
    if (name.includes("name")) {
      return `Sample ${name.replace(/_/g, " ")} ${seq}`;
    }
    if (name.includes("status")) {
      return "active";
    }

    if (type.includes("bool")) {
      return seq % 2 === 0;
    }
    if (type.includes("int") || type.includes("decimal") || type.includes("numeric")) {
      return seq;
    }
    if (type.includes("float") || type.includes("double")) {
      return Number((seq * 10.5).toFixed(2));
    }
    if (type.includes("date") && !type.includes("time")) {
      return this._formatDate(new Date(Date.now() - index * 86400000));
    }
    if (type.includes("timestamp") || type.includes("datetime")) {
      return this._formatDateTime(new Date(Date.now() - index * 3600000));
    }
    if (type.includes("time")) {
      return "12:00:00";
    }
    if (type.includes("json")) {
      return JSON.stringify({ sample: seq });
    }

    return `sample_${name || "value"}_${seq}`;
  }

  async _resolveForeignKeyValue({
    connectionId,
    dbName,
    dbType,
    referencedTable,
    referencedColumn,
  } = {}) {
    if (!connectionId || !referencedTable || !referencedColumn) {
      return null;
    }
    const rows = await this._getSampleRowsCached({
      connectionId,
      dbName,
      dbType,
      tableName: referencedTable,
      limit: 1,
    });
    if (!rows.length) {
      return null;
    }
    const row = rows[0];
    return this._pickColumnValue(row, referencedColumn);
  }

  _pickColumnValue(row, columnName) {
    if (!row || !columnName) return null;
    if (Object.prototype.hasOwnProperty.call(row, columnName)) {
      return row[columnName];
    }
    const lower = String(columnName).toLowerCase();
    const key = Object.keys(row).find((k) => String(k).toLowerCase() === lower);
    return key ? row[key] : null;
  }

  _formatDate(date) {
    const iso = new Date(date).toISOString();
    return iso.slice(0, 10);
  }

  _formatDateTime(date) {
    const iso = new Date(date).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  }

  _sqlValue(value, column) {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }
    const type = String(column?.dataType || "").toLowerCase();
    if (type.includes("int") || type.includes("decimal") || type.includes("numeric")) {
      const num = Number(value);
      return Number.isFinite(num) ? String(num) : "NULL";
    }
    const text = String(value).replace(/'/g, "''");
    return `'${text}'`;
  }

  _buildSimpleWriteQuery(prompt) {
    const rawText = String(prompt || "");
    const text = rawText.toLowerCase();
    const createMatch = text.match(
      /\bcreate\s+(?:a\s+new\s+)?table\s+["'`]?([a-zA-Z0-9_]+)["'`]?\b/,
    );
    if (createMatch) {
      const table = this._sanitizeTableName(createMatch[1]);
      if (!table) return null;
      const wantsCustomerLink =
        /\bcustomer(s)?\b/.test(text) || /\bforeign\s+key\b/.test(text) || /\blink\b/.test(text);
      const columns = [];

      if (table === "address" || text.includes("address")) {
        columns.push("id INT PRIMARY KEY");
        if (wantsCustomerLink) {
          columns.push("customer_id INT NOT NULL");
        }
        columns.push("street VARCHAR(250)");
        columns.push("city VARCHAR(120)");
        columns.push("state VARCHAR(80)");
        columns.push("zip_code VARCHAR(20)");
        columns.push("country VARCHAR(80)");
        columns.push("created_at TIMESTAMP");
        let ddl = `CREATE TABLE ${table} (${columns.join(", ")}`;
        if (wantsCustomerLink) {
          ddl += ", FOREIGN KEY (customer_id) REFERENCES customers(id)";
        }
        ddl += ")";
        return ddl;
      }

      columns.push("id INT PRIMARY KEY");
      if (wantsCustomerLink) {
        columns.push("customer_id INT");
      }
      columns.push("created_at TIMESTAMP");
      let ddl = `CREATE TABLE ${table} (${columns.join(", ")}`;
      if (wantsCustomerLink) {
        ddl += ", FOREIGN KEY (customer_id) REFERENCES customers(id)";
      }
      ddl += ")";
      return ddl;
    }

    const dropMatch = text.match(/\bdrop\s+table\s+([a-zA-Z0-9_]+)\b/);
    if (dropMatch) {
      const table = this._sanitizeTableName(dropMatch[1]);
      return table ? `DROP TABLE ${table}` : null;
    }

    const insertMatch = text.match(
      /\binsert\s+(?:a\s+row\s+)?into\s+([a-zA-Z0-9_]+).*?\bid\s*(?:=|is)?\s*(\d+)/,
    );
    if (insertMatch) {
      const table = this._sanitizeTableName(insertMatch[1]);
      const id = parseInt(insertMatch[2], 10);
      if (!table || !Number.isFinite(id)) return null;
      return `INSERT INTO ${table} (id) VALUES (${id})`;
    }

    return null;
  }

  async _executeDeterministicSql({
    connectionId,
    dbName,
    dbType,
    query,
    tableName,
    analysis,
    tracker,
  }) {
    tracker.addStep({ id: "execute", label: "Execute query", status: "running" });
    try {
      await this.mcpRunner.run("switch_database", { connectionId, dbName });
      const normalizedQuery = this._normalizeMySqlQuery(dbType, query);
      const execResult = await this.mcpRunner.run("execute_query", {
        connectionId,
        query: normalizedQuery,
      });
      const resultSummary = this._summarizeResult(execResult?.result || execResult);
      tracker.setStatus(
        "execute",
        "done",
        resultSummary?.rowCount != null ? `Rows: ${resultSummary.rowCount}` : null,
      );

      tracker.addStep({ id: "summarize", label: "Summarize results", status: "running" });
      const safeTable = tableName || this._extractFirstTableFromSql(query) || "result";
      const tableData = this._buildTableDataResponse({
        tableName: safeTable,
        resultSummary,
        execResult,
        query,
        hasMore: false,
        approximateTotal: null,
        exactTotal: resultSummary?.rowCount,
      });
      const responseText = this._buildDeterministicResponse({
        tableName: safeTable,
        resultSummary,
        executionError: null,
        query,
      });
      const followUps = this._buildFollowUpSuggestions({
        intentType: analysis?.intent || "simple_select",
        tableName: safeTable,
        resultSummary,
        dbType,
        query,
      });
      const finalResponse = this._appendFollowUps(responseText, followUps);
      tracker.setStatus("summarize", "done");

      return {
        queryId: this._createId(),
        query: normalizedQuery,
        responseText: finalResponse,
        queryAnalysis: analysis,
        resultSummary,
        executionError: null,
        steps: this._sanitizeSteps(tracker.list()),
        tableData,
      };
    } catch (error) {
      const errorMessage = this._resolveExecutionError(error);
      tracker.setStatus("execute", "failed", errorMessage);
      return {
        queryId: null,
        query,
        responseText: errorMessage,
        queryAnalysis: analysis,
        resultSummary: null,
        executionError: errorMessage,
        steps: this._sanitizeSteps(tracker.list()),
      };
    }
  }

  _detectWriteIntent(prompt) {
    const text = String(prompt || "").toLowerCase();
    return (
      /\bcreate\b\s+(?:a\s+new\s+)?table\b/.test(text) ||
      /\b(alter|drop|truncate)\b\s+table\b/.test(text) ||
      /\binsert\b\s+(?:a\s+row\s+)?into\b/.test(text) ||
      /\bupdate\b\s+\w+/.test(text) ||
      /\bdelete\b\s+from\b/.test(text) ||
      /\bcreate\b\s+index\b/.test(text) ||
      /\badd\b\s+column\b/.test(text) ||
      this._isDummyDataRequest(text)
    );
  }

  _isWriteSql(query) {
    if (!query || typeof query !== "string") return false;
    return /^\s*(insert|update|delete|create|alter|drop|truncate)\b/i.test(query);
  }

  _getCapabilitiesForDbType(dbType) {
    try {
      const { getCapabilityModel } = require("../config/create-strategy");
      return getCapabilityModel ? getCapabilityModel(String(dbType || "").toLowerCase()) : null;
    } catch (error) {
      logger.debug("Capability lookup failed", { error: error?.message });
      return null;
    }
  }

  _validateIntentCapabilities({ intentType, prompt, dbType, capabilities } = {}) {
    const caps = capabilities ||
      this._getCapabilitiesForDbType(dbType) || {
        type: this.sqlDbTypes.has(String(dbType || "").toLowerCase()) ? "sql" : "unknown",
        operations: [],
        features: [],
        limits: {},
      };
    const ops = Array.isArray(caps.operations)
      ? caps.operations.map((op) => String(op).toLowerCase())
      : [];
    const features = Array.isArray(caps.features)
      ? caps.features.map((feature) => String(feature).toLowerCase())
      : [];
    const type = String(caps.type || "").toLowerCase();

    const isWrite = intentType === "ddl_query" || this._detectWriteIntent(prompt);
    if (isWrite) {
      const supportsWrite = caps?.limits?.supportsWrite !== false;
      const canWrite = supportsWrite && (ops.includes("crud") || type === "sql");
      if (!canWrite) {
        return {
          allowed: false,
          reason: `Write operations are not supported for ${dbType || "this database"}.`,
        };
      }
    }

    if (intentType === "explain_query" && !ops.includes("explain") && type !== "sql") {
      return {
        allowed: false,
        reason: `Explain plans are not supported for ${dbType || "this database"}.`,
      };
    }

    if (intentType === "aggregation_query" && type !== "sql" && !features.includes("aggregation")) {
      return {
        allowed: false,
        reason: `Aggregation queries are not supported for ${dbType || "this database"}.`,
      };
    }

    if (intentType === "join_query" && type !== "sql") {
      return {
        allowed: false,
        reason: `Join queries are not supported for ${dbType || "this database"}.`,
      };
    }

    if (ops.length > 0 && intentType === "simple_select" && !ops.includes("query")) {
      return {
        allowed: false,
        reason: `Read queries are not supported for ${dbType || "this database"}.`,
      };
    }

    return { allowed: true };
  }

  _normalizeMySqlQuery(dbType, query) {
    if (!query || typeof query !== "string") {
      return query;
    }
    const normalized = String(dbType || "").toLowerCase();
    if (normalized !== "mysql2" && normalized !== "mysql") {
      return query;
    }

    // Fix invalid numeric precision like INT(10,0) from cross-dialect generation
    let cleaned = query.replace(
      /\b(INT|BIGINT|SMALLINT|TINYINT|MEDIUMINT)\s*\(\s*\d+\s*,\s*0\s*\)/gi,
      "$1",
    );
    // Normalize NUMBER(x,0) to INT, NUMBER(x,y) to DECIMAL(x,y)
    cleaned = cleaned.replace(/\bNUMBER\s*\(\s*(\d+)\s*,\s*0\s*\)/gi, "INT");
    cleaned = cleaned.replace(/\bNUMBER\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi, "DECIMAL($1,$2)");
    return cleaned;
  }

  _sanitizeStepNote(note) {
    if (!note) {
      return null;
    }
    let clean = String(note);
    const strategies = [
      "DirectSQLStrategy",
      "RAGEnhancedStrategy",
      "DecompositionStrategy",
      "ExplanationStrategy",
      "SuggestionStrategy",
    ];
    for (const name of strategies) {
      if (clean.includes(name)) {
        clean = clean.replace(name, this._formatStrategyLabel(name));
      }
    }
    if (/^Strategy:\s*/i.test(clean)) {
      clean = clean.replace(/^Strategy:\s*/i, "Approach: ");
    }
    return clean.trim() || null;
  }

  _sanitizeSteps(steps) {
    if (!Array.isArray(steps)) {
      return [];
    }
    const allowed = new Set([
      "enrich",
      "plan",
      "schema",
      "rag",
      "generate",
      "execute",
      "summarize",
      "clarify",
      "explain",
      "suggest",
      "analyze",
    ]);
    return steps
      .filter((step) => step && step.id && allowed.has(step.id) && step.status !== "skipped")
      .map((step) => ({
        ...step,
        label: this._formatStepLabel(step),
        note: this._sanitizeStepNote(step.note),
      }));
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
      tracker.addStep({ id, label: id, status: "skipped" });
      tracker.setStatus(id, "skipped");
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

  async _detectQueryIntent(prompt, dbType, timeoutMs) {
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
      '  "intent": "list_tables|simple_select|ddl_query|time_filter_query|join_query|aggregation_query|key_scan|partition_query|collection_query|complex_query|explain_query|suggest_alternatives",',
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
        Number.isFinite(timeoutMs) ? timeoutMs : CHAT_INTENT_TIMEOUT_MS,
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
      ddl_query: "ddl_query",
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

  _fallbackIntentDetection(prompt, _dbType) {
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

    if (/\b(explain|describe|how)\b/.test(text) && !this._detectWriteIntent(text)) {
      return {
        type: "explain_query",
        confidence: 0.8,
        template: null,
        recommendedStrategy: "ExplanationStrategy",
      };
    }

    if (/\b(suggest|recommend|alternative|better)\b/.test(text) && !this._detectWriteIntent(text)) {
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
      "Do not list raw rows; summarize findings and refer to the results panel.",
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
