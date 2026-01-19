const SchemaExtractorService = require("./SchemaExtractorService");
const GraphBuilderService = require("./GraphBuilderService");
const EmbeddingService = require("./EmbeddingService");
const SchemaRetriever = require("./SchemaRetriever");
const QueryCache = require("../cache/QueryCache");
const logger = require("../../utils/logger");

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
  }

  async indexSchema({ connectionId, dbName, force = false } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for schema indexing");
    }

    const cacheKey = `${connectionId}|${dbName || ""}`;
    if (!force && this.indexedConnections.has(cacheKey)) {
      return null;
    }

    if (force) {
      this.queryCache.clearMatching((key) => key.startsWith(`${connectionId}|`));
    }

    const schema = await this.schemaExtractor.extract({ connectionId, dbName });
    await this.graphBuilder.buildGraph(schema);
    await this.embeddingService.generateForSchema(schema);

    const resolvedKey = `${connectionId}|${schema.database || dbName || ""}`;
    this.indexedConnections.add(resolvedKey);
    return schema;
  }

  async retrieveContext({ connectionId, dbName, query, options = {} } = {}) {
    if (!query) {
      throw new Error("query is required for retrieval");
    }

    const fallbackDatabase = dbName || "default";
    const cacheKey = `${connectionId}|${dbName || ""}`;

    if (options.backgroundIndex && !this.indexedConnections.has(cacheKey)) {
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

    const schema = options.indexTimeoutMs
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

    if (useCache) {
      this.queryCache.set(queryCacheKey, context);
    }

    return {
      database,
      ...context,
    };
  }

  _makeCacheKey({ connectionId, database, query }) {
    return `${connectionId}|${database}|${String(query || "").trim()}`;
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
