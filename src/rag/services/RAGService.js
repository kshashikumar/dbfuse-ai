const QueryCache = require("../cache/QueryCache");
const logger = require("../../utils/logger");

const EmbeddingService = require("./EmbeddingService");
const GraphBuilderService = require("./GraphBuilderService");
const SchemaExtractorService = require("./SchemaExtractorService");
const SchemaRetriever = require("./SchemaRetriever");

const DEFAULT_SCHEMA_CACHE_TTL_MS = Number(process.env.RAG_SCHEMA_CACHE_TTL_MS) || 300000;
const DEFAULT_SCHEMA_CACHE_MAX_SIZE = Number(process.env.RAG_SCHEMA_CACHE_MAX_SIZE) || 50;
const DEFAULT_CONTEXT_MAX_TABLES = Number(process.env.RAG_CONTEXT_MAX_TABLES) || 8;
const DEFAULT_CONTEXT_MAX_COLUMNS = Number(process.env.RAG_CONTEXT_MAX_COLUMNS) || 20;

class RAGService {
  constructor(options = {}) {
    this.schemaExtractor = options.schemaExtractor || new SchemaExtractorService();
    this.graphBuilder = options.graphBuilder || new GraphBuilderService();
    this.embeddingService = options.embeddingService || new EmbeddingService();
    this.schemaRetriever =
      options.schemaRetriever ||
      new SchemaRetriever({
        embeddingService: this.embeddingService,
      });
    this.indexedConnections = new Set();
    this.queryCache = options.queryCache || new QueryCache();
    this.schemaCache =
      options.schemaCache ||
      new QueryCache({
        maxSize: DEFAULT_SCHEMA_CACHE_MAX_SIZE,
        ttlMs: DEFAULT_SCHEMA_CACHE_TTL_MS,
      });
    this.contextMaxTables = DEFAULT_CONTEXT_MAX_TABLES;
    this.contextMaxColumns = DEFAULT_CONTEXT_MAX_COLUMNS;
  }

  async indexSchema({ connectionId, dbName, force = false } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for schema indexing");
    }

    const cacheKey = `${connectionId}|${dbName || ""}`;
    if (!force) {
      const cached = this.schemaCache.get(cacheKey);
      if (cached) {
        this.indexedConnections.add(cacheKey);
        return cached;
      }
    }

    if (force) {
      this.queryCache.clearMatching((key) => key.startsWith(`${connectionId}|`));
      this.schemaCache.clearMatching((key) => key.startsWith(`${connectionId}|`));
    }

    const schema = await this.schemaExtractor.extract({ connectionId, dbName });
    await this.graphBuilder.buildGraph(schema);
    await this.embeddingService.generateForSchema(schema);

    const resolvedKey = `${connectionId}|${schema.database || dbName || ""}`;
    this.schemaCache.set(resolvedKey, schema);
    if (resolvedKey !== cacheKey) {
      this.schemaCache.set(cacheKey, schema);
    }
    this.indexedConnections.add(resolvedKey);
    this.indexedConnections.add(cacheKey);
    return schema;
  }

  async retrieveContext({ connectionId, dbName, query, options = {} } = {}) {
    if (!query) {
      throw new Error("query is required for retrieval");
    }

    const cacheKey = `${connectionId}|${dbName || ""}`;
    const fallbackDatabase = dbName || "default";
    const cachedSchema = this.schemaCache.get(cacheKey);
    if (!cachedSchema) {
      this.indexedConnections.delete(cacheKey);
    }

    if (options.backgroundIndex && !cachedSchema && !this.indexedConnections.has(cacheKey)) {
      this.indexSchema({ connectionId, dbName, force: options.force }).catch((error) => {
        logger.warn("RAG background schema indexing failed:", error);
      });
      return {
        database: fallbackDatabase,
        tables: [],
        relationships: [],
        matches: [],
      };
    }

    const schema = cachedSchema
      ? cachedSchema
      : options.indexTimeoutMs
        ? await this._withTimeout(
            this.indexSchema({ connectionId, dbName, force: options.force }),
            options.indexTimeoutMs,
            "Schema indexing timed out.",
          )
        : await this.indexSchema({ connectionId, dbName, force: options.force });
    const database = schema?.database || dbName || "default";

    const useCache = options.useCache !== false;
    const queryCacheKey = this._makeCacheKey({ connectionId, database, query });
    if (useCache) {
      const cached = this.queryCache.get(queryCacheKey);
      if (cached) {
        return {
          database,
          ...cached,
        };
      }
    }

    const context = await this.schemaRetriever.retrieveContext({
      query,
      database,
      limit: options.limit,
      minScore: options.minScore,
    });

    const packedContext = this._packContext(context, options);

    if (useCache) {
      this.queryCache.set(queryCacheKey, packedContext);
    }

    return {
      database,
      ...packedContext,
    };
  }

  _makeCacheKey({ connectionId, database, query }) {
    return `${connectionId}|${database}|${String(query || "").trim()}`;
  }

  _packContext(context, options = {}) {
    if (!context || typeof context !== "object") {
      return context;
    }
    const maxTables = Number.isFinite(options.contextMaxTables)
      ? options.contextMaxTables
      : this.contextMaxTables;
    const maxColumns = Number.isFinite(options.contextMaxColumns)
      ? options.contextMaxColumns
      : this.contextMaxColumns;

    const tables = Array.isArray(context.tables) ? context.tables : [];
    const limitedTables =
      Number.isFinite(maxTables) && maxTables > 0 ? tables.slice(0, maxTables) : tables;
    const packedTables = limitedTables.map((table) => {
      const cols = Array.isArray(table.columns) ? table.columns : [];
      const packedCols =
        Number.isFinite(maxColumns) && maxColumns > 0 ? cols.slice(0, maxColumns) : cols;
      return {
        ...table,
        columns: packedCols,
      };
    });

    const allowed = new Set(packedTables.map((table) => table.name).filter(Boolean));
    const relationships = Array.isArray(context.relationships)
      ? context.relationships.filter((rel) => allowed.has(rel.from) || allowed.has(rel.to))
      : context.relationships;
    const matches = Array.isArray(context.matches)
      ? context.matches.filter((match) => allowed.has(match?.metadata?.table))
      : context.matches;

    return {
      ...context,
      tables: packedTables,
      relationships,
      matches,
    };
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

module.exports = RAGService;
