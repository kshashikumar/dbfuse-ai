/**
 * @fileoverview Database service
 * Handles query execution, caching, and transaction management
 * Provides hooks for rate limiting and agent orchestration
 */

const { connectionManager } = require("../config");
const logger = require("../utils/logger");
const { DEFAULT_CONFIG } = require("../core/constants");

/**
 * Simple in-memory cache for query results
 */
class QueryCache {
  constructor(maxSize = 100, ttlMs = 300000) {
    // 5 minutes default TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  _generateKey(connectionId, query, params) {
    return `${connectionId}:${query}:${JSON.stringify(params)}`;
  }

  get(connectionId, query, params = {}) {
    const key = this._generateKey(connectionId, query, params);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    logger.debug("Cache hit for query");
    return entry.data;
  }

  set(connectionId, query, params = {}, data) {
    const key = this._generateKey(connectionId, query, params);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clear() {
    this.cache.clear();
    logger.debug("Query cache cleared");
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

/**
 * @typedef {Object} QueryMetrics
 * @property {number} totalQueries - Total queries executed
 * @property {number} successfulQueries - Successful queries count
 * @property {number} failedQueries - Failed queries count
 * @property {number} cachedQueries - Queries served from cache
 * @property {number} averageExecutionTime - Average query execution time (ms)
 */

class DatabaseService {
  constructor() {
    this.queryCache = new QueryCache();
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      cachedQueries: 0,
      totalExecutionTime: 0,
      byDbType: {},
    };
    this.rateLimitHooks = [];
    this.transactionHooks = [];
  }

  _inferOperationType(query) {
    if (typeof query === "string") return "query";
    if (!query || typeof query !== "object") return "query";

    const mode = String(query.mode || query.payload?.mode || "").toLowerCase();
    if (mode === "command") return "command";
    if (mode === "crud") return "crud";
    if (mode === "query") return "query";

    const op =
      query.operation ||
      query.action ||
      query.command ||
      query.payload?.operation ||
      query.payload?.action ||
      query.payload?.command;
    const normalized = op ? String(op).toLowerCase() : "";

    if (!normalized) return "query";
    if (normalized.includes("index")) return "indexes";
    if (normalized === "explain") return "explain";
    if (normalized === "command") return "command";

    const crudPrefixes = [
      "insert",
      "update",
      "delete",
      "replace",
      "upsert",
      "create",
      "set",
      "add",
      "put",
      "patch",
      "batch",
    ];
    if (normalized === "del" || normalized === "remove") return "crud";
    if (crudPrefixes.some((prefix) => normalized.startsWith(prefix))) return "crud";

    return "query";
  }

  _applySafePaging(options = {}) {
    const page = Math.max(1, parseInt(options.page) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(options.pageSize) || DEFAULT_CONFIG.PAGE_SIZE),
      DEFAULT_CONFIG.MAX_PAGE_SIZE,
    );
    return { ...options, page, pageSize };
  }

  _resolveDbType(connectionId) {
    const info = connectionManager.getConnectionInfo(connectionId);
    const dbType = info?.config?.dbType;
    return dbType ? String(dbType).toLowerCase() : "unknown";
  }

  _resolveDbName(dbName, connectionInfo) {
    const base =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database || null;
    const dbType = String(connectionInfo?.config?.dbType || "").toLowerCase();
    if (dbType !== "oracledb") {
      return base;
    }
    const serviceName = connectionInfo?.config?.database || null;
    const username = connectionInfo?.config?.username || null;
    if (!base || (serviceName && base === serviceName)) {
      return username || base;
    }
    return base;
  }

  /**
   * Update metrics after query execution
   * @private
   * @param {boolean} success - Query success status
   * @param {number} executionTime - Execution time in ms
   * @param {boolean} cached - Whether result was from cache
   */
  _updateMetrics(success, executionTime = 0, cached = false) {
    const dbType = arguments.length > 3 ? arguments[3] : "unknown";
    this.metrics.totalQueries++;
    if (success) {
      this.metrics.successfulQueries++;
    } else {
      this.metrics.failedQueries++;
    }
    if (cached) {
      this.metrics.cachedQueries++;
    }
    this.metrics.totalExecutionTime += executionTime;

    if (!this.metrics.byDbType[dbType]) {
      this.metrics.byDbType[dbType] = {
        totalQueries: 0,
        successfulQueries: 0,
        failedQueries: 0,
        cachedQueries: 0,
        totalExecutionTime: 0,
      };
    }

    const dbMetrics = this.metrics.byDbType[dbType];
    dbMetrics.totalQueries++;
    if (success) {
      dbMetrics.successfulQueries++;
    } else {
      dbMetrics.failedQueries++;
    }
    if (cached) {
      dbMetrics.cachedQueries++;
    }
    dbMetrics.totalExecutionTime += executionTime;
  }

  /**
   * Register rate limiting hook (for agent orchestration)
   * @param {Function} hook - Async function(connectionId, query) => boolean (allow/deny)
   */
  registerRateLimitHook(hook) {
    if (typeof hook === "function") {
      this.rateLimitHooks.push(hook);
      logger.debug("Rate limit hook registered");
    }
  }

  /**
   * Register transaction hook (for monitoring/rollback)
   * @param {Function} hook - Async function(event, context)
   */
  registerTransactionHook(hook) {
    if (typeof hook === "function") {
      this.transactionHooks.push(hook);
      logger.debug("Transaction hook registered");
    }
  }

  /**
   * Check rate limits before query execution
   * @private
   * @param {string} connectionId - Connection ID
   * @param {string} query - SQL query
   * @returns {Promise<boolean>} True if allowed
   */
  async _checkRateLimits(connectionId, query) {
    for (const hook of this.rateLimitHooks) {
      try {
        const allowed = await hook(connectionId, query);
        if (!allowed) {
          logger.warn("Query blocked by rate limit hook");
          return false;
        }
      } catch (error) {
        logger.error("Rate limit hook error:", error);
      }
    }
    return true;
  }

  /**
   * Notify transaction hooks
   * @private
   * @param {string} event - Event name (start, commit, rollback, error)
   * @param {Object} context - Event context
   */
  async _notifyTransactionHooks(event, context) {
    for (const hook of this.transactionHooks) {
      try {
        await hook(event, context);
      } catch (error) {
        logger.error("Transaction hook error:", error);
      }
    }
  }

  /**
   * Get databases for connection
   * @param {string} connectionId - Connection ID
   * @returns {Promise<Object>} Database list with stats
   */
  async getDatabases(connectionId) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);
      const databases = await strategy.getDatabases();

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        databases,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get tables for connection/database
   * @param {string} connectionId - Connection ID
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Tables list
   */
  async getTables(connectionId, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }
      const tables = await strategy.getTables(currentDb);

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        tables,
        count: Array.isArray(tables) ? tables.length : 0,
        database: currentDb,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get collections for NoSQL connections
   * @param {string} connectionId - Connection ID
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Collections list
   */
  async getCollections(connectionId, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }
      const collections = await strategy.getCollections(currentDb);

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        collections,
        count: Array.isArray(collections) ? collections.length : 0,
        database: currentDb,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get collection information for NoSQL connections
   * @param {string} connectionId - Connection ID
   * @param {string} collection - Collection name
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Collection information
   */
  async getCollectionInfo(connectionId, collection, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }
      const collectionInfo = await strategy.getCollectionInfo(currentDb, collection);
      const normalized =
        typeof strategy.normalizeMetadata === "function"
          ? strategy.normalizeMetadata(collectionInfo)
          : collectionInfo;

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        ...normalized,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get key patterns for cache/key-value stores
   * @param {string} connectionId - Connection ID
   * @param {string} pattern - Pattern (optional)
   * @returns {Promise<Object>} Key pattern results
   */
  async getKeyPatterns(connectionId, pattern = "*") {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);
      const keys = await strategy.getKeys(pattern || "*");

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        keys,
        count: Array.isArray(keys) ? keys.length : 0,
        pattern: pattern || "*",
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get table information
   * @param {string} connectionId - Connection ID
   * @param {string} table - Table name
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Table information
   */
  async getTableInfo(connectionId, table, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      // Check cache first
      const cacheKey = { table, dbName };
      const cached = this.queryCache.get(connectionId, "getTableInfo", cacheKey);
      if (cached) {
        this._updateMetrics(true, 0, true, dbType);
        return cached;
      }

      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }
      const tableInfo = await strategy.getTableInfo(currentDb, table);
      const normalized =
        typeof strategy.normalizeMetadata === "function"
          ? strategy.normalizeMetadata(tableInfo)
          : tableInfo;

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      const result = {
        ...normalized,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };

      // Cache result
      this.queryCache.set(connectionId, "getTableInfo", cacheKey, result);

      return result;
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Get multiple tables information
   * @param {string} connectionId - Connection ID
   * @param {Array<string>} tables - Table names
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Multiple tables information
   */
  async getMultipleTablesInfo(connectionId, tables, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }
      const tableDetails = await strategy.getMultipleTablesInfo(currentDb, tables);
      const normalized = Array.isArray(tableDetails)
        ? tableDetails.map((info) =>
            typeof strategy.normalizeMetadata === "function"
              ? strategy.normalizeMetadata(info)
              : info,
          )
        : tableDetails;

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      return {
        tables: normalized,
        count: Array.isArray(normalized) ? normalized.length : 0,
        database: currentDb,
        retrievedAt: new Date().toISOString(),
        executionTime,
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      throw error;
    }
  }

  /**
   * Execute SQL query with caching and rate limiting
   * @param {string} connectionId - Connection ID
   * @param {string} query - SQL query
   * @param {Object} options - Query options (page, pageSize, dbName, useCache)
   * @returns {Promise<Object>} Query results
   */
  async executeQuery(connectionId, query, options = {}) {
    const { dbName = null, useCache = true } = options;
    const safeOptions = this._applySafePaging(options);
    const { page, pageSize } = safeOptions;

    const startTime = Date.now();
    const isStringQuery = typeof query === "string";
    const dbType = this._resolveDbType(connectionId);

    try {
      // Check rate limits
      let rateLimitPayload = query;
      if (!isStringQuery) {
        try {
          rateLimitPayload = JSON.stringify(query);
        } catch {
          rateLimitPayload = "[object]";
        }
      }

      const allowed = await this._checkRateLimits(connectionId, rateLimitPayload);
      if (!allowed) {
        throw new Error("Query rate limit exceeded");
      }

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      // Check cache for SELECT queries
      const isSelect = isStringQuery && query.trim().toUpperCase().startsWith("SELECT");
      if (useCache && isSelect) {
        const cacheKey = { query, page, pageSize, dbName: currentDb };
        const cached = this.queryCache.get(connectionId, "query", cacheKey);
        if (cached) {
          this._updateMetrics(true, 0, true, dbType);
          return cached;
        }
      }

      // Notify transaction hooks
      await this._notifyTransactionHooks("query_start", { connectionId, query });

      const strategy = connectionManager.getConnection(connectionId);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }

      const opType = this._inferOperationType(query);
      if (strategy.validateOperation) {
        strategy.validateOperation(opType, query);
      }

      const result = await strategy.executeQuery(query, { page, pageSize, dbName: currentDb });
      const normalized =
        typeof strategy.normalizeResult === "function" ? strategy.normalizeResult(result) : result;

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      // Notify success
      await this._notifyTransactionHooks("query_success", {
        connectionId,
        query,
        executionTime,
      });

      // Cache SELECT results
      if (useCache && isSelect && normalized.rows) {
        const cacheKey = { query, page, pageSize, dbName: currentDb };
        this.queryCache.set(connectionId, "query", cacheKey, normalized);
      }

      return normalized;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this._updateMetrics(false, executionTime, false, dbType);

      // Notify error
      await this._notifyTransactionHooks("query_error", {
        connectionId,
        query,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Execute batch queries
   * @param {string} connectionId - Connection ID
   * @param {Array<string>} queries - Array of SQL queries
   * @param {string} dbName - Database name (optional)
   * @returns {Promise<Object>} Batch execution results
   */
  async executeBatch(connectionId, queries, dbName = null) {
    const startTime = Date.now();
    const dbType = this._resolveDbType(connectionId);
    try {
      const strategy = connectionManager.getConnection(connectionId);

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = this._resolveDbName(dbName, info);

      if (currentDb && strategy.switchDatabase) {
        await strategy.switchDatabase(currentDb);
      }

      await this._notifyTransactionHooks("batch_start", { connectionId, count: queries.length });

      const results = [];
      for (const query of queries) {
        const result = await strategy.executeQuery(query, { dbName: currentDb });
        results.push(result);
      }

      const executionTime = Date.now() - startTime;
      this._updateMetrics(true, executionTime, false, dbType);

      await this._notifyTransactionHooks("batch_success", { connectionId, count: queries.length });

      return {
        results,
        totalQueries: queries.length,
        executedAt: new Date().toISOString(),
        executionTime,
        mode: "batch",
      };
    } catch (error) {
      this._updateMetrics(false, Date.now() - startTime, false, dbType);
      await this._notifyTransactionHooks("batch_error", { connectionId, error: error.message });
      throw error;
    }
  }

  /**
   * Switch database for connection
   * @param {string} connectionId - Connection ID
   * @param {string} dbName - Database name
   * @returns {Promise<Object>} Switch result
   */
  async switchDatabase(connectionId, dbName) {
    const strategy = connectionManager.getConnection(connectionId);
    await strategy.switchDatabase(dbName);

    const info = connectionManager.getConnectionInfo(connectionId);
    if (info) {
      info.currentDatabase = dbName;
    }

    // Clear cache for this connection
    this.queryCache.clear();

    return {
      message: `Switched to database ${dbName}`,
      database: dbName,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get database service metrics
   * @returns {QueryMetrics} Current metrics
   */
  getMetrics() {
    const avgExecutionTime =
      this.metrics.totalQueries > 0
        ? this.metrics.totalExecutionTime / this.metrics.totalQueries
        : 0;

    const byDbType = {};
    Object.entries(this.metrics.byDbType).forEach(([dbType, stats]) => {
      const averageExecutionTime =
        stats.totalQueries > 0 ? stats.totalExecutionTime / stats.totalQueries : 0;
      byDbType[dbType] = {
        ...stats,
        averageExecutionTime: Math.round(averageExecutionTime),
      };
    });

    return {
      ...this.metrics,
      averageExecutionTime: Math.round(avgExecutionTime),
      byDbType,
      cacheStats: this.queryCache.getStats(),
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalQueries: 0,
      successfulQueries: 0,
      failedQueries: 0,
      cachedQueries: 0,
      totalExecutionTime: 0,
      byDbType: {},
    };
    logger.debug("Database service metrics reset");
  }

  /**
   * Clear query cache
   */
  clearCache() {
    this.queryCache.clear();
  }

  /**
   * Health check for database service
   * @returns {Object} Health status
   */
  isHealthy() {
    try {
      const metrics = this.getMetrics();
      return {
        healthy: true,
        cacheEnabled: true,
        cacheSize: this.queryCache.cache.size,
        maxCacheSize: this.queryCache.maxSize,
        cacheTTL: this.queryCache.ttlMs,
        activeConnections: connectionManager.getAllConnectionIds().length,
        hasRateLimitHooks: this.rateLimitHooks.length > 0,
        hasTransactionHooks: this.transactionHooks.length > 0,
        metrics,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  /**
   * Fetch query results in a specific range for virtual scrolling
   * @param {string} connectionId - Connection identifier
   * @param {string} query - Base query without LIMIT/OFFSET (for SQL)
   * @param {number} offset - Starting row index (0-based)
   * @param {number} limit - Number of rows to fetch
   * @param {string} collectionName - Collection name (for NoSQL)
   * @param {object} filter - Query filter (for NoSQL)
   * @param {object} options - Additional options
   * @returns {Promise<{rows: any[], hasMore: boolean, columns?: any[]}>}
   */
  async fetchQueryRange(
    connectionId,
    query,
    offset,
    limit,
    collectionName = null,
    filter = {},
    options = {},
  ) {
    try {
      const strategy = connectionManager.getConnection(connectionId);

      if (!strategy) {
        throw new Error(`No strategy found for connection: ${connectionId}`);
      }

      // Determine if this is a SQL or NoSQL database
      const isNoSQL = collectionName !== null;

      if (isNoSQL) {
        // NoSQL path (MongoDB, etc.)
        if (typeof strategy.fetchRowRange === "function") {
          return await strategy.fetchRowRange(collectionName, filter, offset, limit, options);
        } else {
          throw new Error(`fetchRowRange not implemented for this database type`);
        }
      } else {
        // SQL path
        if (!query) {
          throw new Error("Query is required for SQL databases");
        }

        if (typeof strategy.fetchRowRange === "function") {
          return await strategy.fetchRowRange(query, offset, limit, options);
        } else {
          throw new Error(`fetchRowRange not implemented for this database type`);
        }
      }
    } catch (error) {
      logger.error(`fetchQueryRange error: ${error.message}`);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
