const crypto = require("crypto");

const { connectionManager } = require("../../config");
const llmService = require("../../services/LLMService");
const logger = require("../../utils/logger");
const RAGService = require("../services/RAGService");
const DirectSQLStrategy = require("../strategies/DirectSQLStrategy");
const DecompositionStrategy = require("../strategies/DecompositionStrategy");
const ExplanationStrategy = require("../strategies/ExplanationStrategy");
const RAGEnhancedStrategy = require("../strategies/RAGEnhancedStrategy");
const SuggestionStrategy = require("../strategies/SuggestionStrategy");
const storageManager = require("../storage/StorageManager");

const QueryAnalyzer = require("./QueryAnalyzer");
const StrategySelector = require("./StrategySelector");
const TaskPlanner = require("./TaskPlanner");
const { validateTaskSteps } = require("./TaskStepSchema");

const CONTEXT_MAX_TABLES = Number(process.env.RAG_CONTEXT_MAX_TABLES) || 8;
const CONTEXT_MAX_COLUMNS = Number(process.env.RAG_CONTEXT_MAX_COLUMNS) || 24;
const RAG_SAMPLE_ROWS_PER_TABLE = Number(process.env.RAG_SAMPLE_ROWS_PER_TABLE) || 0;
const RAG_SAMPLE_MAX_TABLES = Number(process.env.RAG_SAMPLE_MAX_TABLES) || 3;

class QueryOrchestrator {
  constructor(options = {}) {
    this.ragService = options.ragService || new RAGService();
    this.llmService = options.llmService || llmService;
    this.analyzer = options.analyzer || new QueryAnalyzer();
    this.selector = options.selector || new StrategySelector();
    this.strategies = {
      DirectSQLStrategy: new DirectSQLStrategy(),
      RAGEnhancedStrategy: new RAGEnhancedStrategy(),
      DecompositionStrategy: new DecompositionStrategy(),
      ...(options.strategies || {}),
    };
    this.explanationStrategy = options.explanationStrategy || new ExplanationStrategy();
    this.suggestionStrategy = options.suggestionStrategy || new SuggestionStrategy();
    this.taskPlanner = options.taskPlanner || new TaskPlanner();
  }

  analyze(prompt) {
    return this.analyzer.analyze(prompt);
  }

  async execute({ connectionId, dbType, dbName, prompt, model, apiKey, options = {} } = {}) {
    const startTime = Date.now();
    if (!connectionId) {
      throw new Error("connectionId is required");
    }
    if (!dbType) {
      throw new Error("dbType is required");
    }
    if (!prompt) {
      throw new Error("prompt is required");
    }

    this.llmService.initialize(model, apiKey);

    const strategy = connectionManager.getConnection(connectionId);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    if (!currentDb) {
      throw new Error("Unable to determine target database");
    }

    const catalog = await strategy.getTables(currentDb);
    const catalogNames = this._normalizeTableNames(catalog);

    const requestedTableMatch = prompt.match(/for (\w+) table/i);
    const requestedTable = requestedTableMatch ? requestedTableMatch[1] : null;

    const analysis = this.analyzer.analyze(prompt);
    let context = null;

    if (options.useRag !== false) {
      context = await this._retrieveContext({
        connectionId,
        dbName: currentDb,
        prompt,
        options,
      });
    }

    const capabilities =
      typeof strategy.getCapabilities === "function" ? strategy.getCapabilities() : null;
    const strategyName = this.selector.select({
      analysis,
      context,
      capabilities,
      dbType,
    });
    const selectedStrategy = this.strategies[strategyName] || this.strategies.DirectSQLStrategy;

    const { dbMeta, selectedTables } = await this._buildDbMeta({
      strategy,
      currentDb,
      catalogNames,
      requestedTable,
      prompt,
      dbType,
      context,
    });

    let query;
    let queryId = this._createId();
    try {
      query = await selectedStrategy.execute({
        llmService: this.llmService,
        dbMeta,
        databaseName: currentDb,
        prompt,
        dbType,
        selectedTables,
        context,
        analysis,
      });
    } catch (error) {
      await this._recordHistory({
        id: queryId,
        prompt,
        query: `ERROR: ${error.message}`,
        strategy: selectedStrategy.name,
        success: false,
        executionTime: Date.now() - startTime,
        feedback: { error: error.message },
      });
      throw error;
    }

    const includeExplanation = options.includeExplanation !== false;
    const includeSuggestions = options.includeSuggestions !== false;
    const explanation = includeExplanation
      ? this.explanationStrategy.generate({
          analysis,
          context,
          selectedTables,
          dbType,
          dbName: currentDb,
        })
      : null;
    const suggestions = includeSuggestions
      ? this.suggestionStrategy.generate({
          analysis,
          context,
          selectedTables,
        })
      : null;

    const queryAnalysis =
      typeof strategy.analyzeQuery === "function" ? strategy.analyzeQuery(query) : null;
    const taskSteps = this.taskPlanner.buildPlan({
      taskId: queryId,
      prompt,
      dbType,
      dbName: currentDb,
      analysis,
      strategyName: selectedStrategy.name,
      query,
      selectedTables,
      queryAnalysis,
      model,
    });
    const stepValidation = validateTaskSteps(taskSteps);
    if (!stepValidation.valid) {
      logger.warn("Task-step validation failed", {
        errors: stepValidation.errors,
        taskId: queryId,
      });
    }

    await this._recordHistory({
      id: queryId,
      prompt,
      query,
      strategy: selectedStrategy.name,
      success: true,
      executionTime: Date.now() - startTime,
      feedback: null,
    });

    return {
      queryId,
      taskId: queryId,
      query,
      strategy: selectedStrategy.name,
      analysis,
      explanation,
      suggestions,
      taskSteps,
      context: context
        ? {
            tables: context.tables,
            relationships: context.relationships,
          }
        : null,
    };
  }

  async _buildDbMeta({
    strategy,
    currentDb,
    catalogNames,
    requestedTable,
    prompt,
    dbType,
    context,
  }) {
    if (requestedTable && catalogNames.includes(requestedTable)) {
      const tableInfo = await strategy.getTableInfo(currentDb, requestedTable);
      const packedColumns = this._packColumns(this._normalizeColumns(tableInfo?.columns || []));
      return {
        selectedTables: [requestedTable],
        dbMeta: [
          {
            name: currentDb,
            tables: [
              {
                name: requestedTable,
                columns: packedColumns,
              },
            ],
          },
        ],
      };
    }

    const contextNames = Array.isArray(context?.tables)
      ? context.tables.map((entry) => entry.name).filter(Boolean)
      : [];
    const contextSelection = Array.from(new Set(contextNames)).filter((name) =>
      catalogNames.includes(name),
    );

    const suggestedSelection =
      contextSelection.length > 0
        ? contextSelection.slice(0, 12)
        : await this.llmService.selectRelevantTables(dbType, catalogNames, prompt);

    const selectedTables =
      suggestedSelection && suggestedSelection.length
        ? suggestedSelection
        : catalogNames.slice(0, Math.min(12, catalogNames.length));

    const limitedSelection = this._limitSelection(selectedTables, CONTEXT_MAX_TABLES);
    const multiInfo = await strategy.getMultipleTablesInfo(currentDb, limitedSelection);
    const infoByName = new Map(
      multiInfo.map((tableInfo) => [this._getTableName(tableInfo), tableInfo]),
    );

    const tables = limitedSelection.map((name) => {
      if (infoByName.has(name)) {
        const tableInfo = infoByName.get(name);
        return {
          name,
          columns: this._packColumns(this._normalizeColumns(tableInfo?.columns || [])),
        };
      }
      return { name, columns: [] };
    });

    if (RAG_SAMPLE_ROWS_PER_TABLE > 0 && this._isSqlDbType(dbType)) {
      const sampleTargets = limitedSelection.slice(0, RAG_SAMPLE_MAX_TABLES);
      await Promise.all(
        sampleTargets.map(async (tableName) => {
          const rows = await this._fetchSampleRows({
            strategy,
            dbType,
            dbName: currentDb,
            tableName,
            limit: RAG_SAMPLE_ROWS_PER_TABLE,
          });
          if (rows.length) {
            const target = tables.find((table) => table.name === tableName);
            if (target) {
              target.sampleRows = rows;
            }
          }
        }),
      );
    }

    return {
      selectedTables: limitedSelection,
      dbMeta: [
        {
          name: currentDb,
          tables,
        },
      ],
    };
  }

  _normalizeTableNames(tables) {
    return tables
      .map((table) => {
        if (typeof table === "string") {
          return table;
        }
        return table?.name || table?.table_name || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);
  }

  _getTableName(tableInfo) {
    return tableInfo?.table_name || tableInfo?.name || tableInfo?.table;
  }

  _normalizeColumns(columns) {
    return columns.map((col) => ({
      column_name: col.column_name ?? col.name ?? null,
      data_type: col.data_type ?? col.type ?? null,
      is_nullable: col.is_nullable ?? col.isNullable ?? null,
      default_value: col.default_value ?? col.defaultValue ?? null,
      extra: col.extra ?? null,
      is_primary_key: col.is_primary_key ?? col.isPrimaryKey ?? null,
      length: col.length ?? col.data_length ?? null,
      precision: col.precision ?? null,
      scale: col.scale ?? null,
    }));
  }

  _packColumns(columns) {
    if (!Array.isArray(columns)) return [];
    if (!Number.isFinite(CONTEXT_MAX_COLUMNS) || CONTEXT_MAX_COLUMNS <= 0) {
      return columns;
    }
    return columns.slice(0, CONTEXT_MAX_COLUMNS);
  }

  _limitSelection(tables, maxTables) {
    if (!Array.isArray(tables)) return [];
    if (!Number.isFinite(maxTables) || maxTables <= 0) {
      return tables;
    }
    return tables.slice(0, maxTables);
  }

  _isSqlDbType(dbType) {
    const normalized = String(dbType || "").toLowerCase();
    return [
      "mysql",
      "mysql2",
      "pg",
      "postgresql",
      "sqlite",
      "sqlite3",
      "mssql",
      "oracledb",
    ].includes(normalized);
  }

  _sanitizeTableName(name) {
    return String(name || "")
      .split(".")
      .map((part) => String(part || "").replace(/[^\w_]/g, ""))
      .filter(Boolean)
      .join(".");
  }

  _buildSimpleSelectQuery(dbType, tableName, limit) {
    const safeTable = this._sanitizeTableName(tableName);
    const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 5;
    const normalized = String(dbType || "").toLowerCase();
    if (normalized === "mssql") {
      return `SELECT TOP (${safeLimit}) * FROM ${safeTable}`;
    }
    if (normalized === "oracledb") {
      return `SELECT * FROM ${safeTable} FETCH FIRST ${safeLimit} ROWS ONLY`;
    }
    return `SELECT * FROM ${safeTable} LIMIT ${safeLimit}`;
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

  async _fetchSampleRows({ strategy, dbType, dbName, tableName, limit } = {}) {
    if (!strategy || !tableName || !limit) return [];
    try {
      const query = this._buildSimpleSelectQuery(dbType, tableName, limit);
      const result = await strategy.executeQuery(query, { dbName, page: 1, pageSize: limit });
      const rows = this._extractRowsFromResult(result);
      return rows.slice(0, limit);
    } catch (error) {
      logger.debug("RAG sample row fetch failed", {
        tableName,
        error: error?.message || error,
      });
      return [];
    }
  }

  async _recordHistory(entry) {
    await storageManager.initialize();
    const store = storageManager.getQueryHistoryStore();
    await store.record({
      id: entry.id,
      nlQuery: entry.prompt,
      generatedQuery: entry.query,
      strategy: entry.strategy,
      success: entry.success,
      executionTime: entry.executionTime,
      feedback: entry.feedback,
    });
  }

  _createId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  async _retrieveContext({ connectionId, dbName, prompt, options }) {
    const ragOptions = {
      limit: options.limit,
      minScore: options.minScore,
      force: options.force,
      useCache: options.useCache,
      backgroundIndex: options.backgroundIndex,
      indexTimeoutMs: options.indexTimeoutMs,
    };
    const timeoutMs = Number.isFinite(options.ragTimeoutMs)
      ? options.ragTimeoutMs
      : Number(process.env.RAG_CONTEXT_TIMEOUT_MS) || 15000;

    try {
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return await this._withTimeout(
          this.ragService.retrieveContext({
            connectionId,
            dbName,
            query: prompt,
            options: ragOptions,
          }),
          timeoutMs,
          "RAG context retrieval timed out.",
        );
      }

      return await this.ragService.retrieveContext({
        connectionId,
        dbName,
        query: prompt,
        options: ragOptions,
      });
    } catch (error) {
      logger.warn("RAG context retrieval failed:", error);
      return null;
    }
  }

  _withTimeout(promise, timeoutMs, errorMessage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(errorMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

module.exports = QueryOrchestrator;
