// database-strategy.js
const fs = require("fs");

const { QUERY_TYPES, ERROR_MESSAGES } = require("../../../core/constants/database.constants");
const logger = require("../../../utils/logger");

/**
 * Base DatabaseStrategy with agent hooks, metrics, and resilience patterns
 */
class DatabaseStrategy {
  constructor() {
    this.connectionPool = null;
    this.currentDatabase = null;

    // Metrics tracking
    this.metrics = {
      queries: 0,
      errors: 0,
      totalQueryTime: 0,
      lastQuery: null,
      queryTypes: {},
    };

    // Agent hooks
    this.hooks = {
      "query.pre": [],
      "query.post": [],
      "query.error": [],
      "connection.health": [],
    };

    // Circuit breaker for resilience
    this.circuitBreaker = {
      state: "closed", // closed, open, half-open
      failures: 0,
      threshold: 10,
      timeout: 30000, // 30 seconds
      lastFailure: null,
    };

    // Retry configuration
    this.retryConfig = {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    };
  }

  // Agent hook registration
  registerQueryHook(phase, handler) {
    const eventKey = `query.${phase}`;
    if (!this.hooks[eventKey]) {
      throw new Error(`Unknown query hook phase: ${phase}`);
    }
    if (typeof handler !== "function") {
      throw new Error("Hook handler must be a function");
    }
    this.hooks[eventKey].push(handler);
    return () => {
      const index = this.hooks[eventKey].indexOf(handler);
      if (index > -1) this.hooks[eventKey].splice(index, 1);
    };
  }

  async executeHooks(event, context) {
    const handlers = this.hooks[event] || [];
    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (error) {
        logger.warn(`Hook handler failed for ${event}: ${error.message}`);
      }
    }
  }

  // Circuit breaker management
  recordQueryFailure(_error) {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    this.metrics.errors++;

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = "open";
      logger.warn(
        `Circuit breaker opened for ${this.constructor.name} after ${this.circuitBreaker.failures} failures`,
      );
      setTimeout(() => {
        this.circuitBreaker.state = "half-open";
        logger.info(`Circuit breaker entering half-open state for ${this.constructor.name}`);
      }, this.circuitBreaker.timeout);
    }
  }

  recordQuerySuccess() {
    // Reset failures on success
    this.circuitBreaker.failures = 0;
    if (this.circuitBreaker.state === "half-open") {
      this.circuitBreaker.state = "closed";
      logger.info(`Circuit breaker closed for ${this.constructor.name}`);
    }
  }

  checkCircuitBreaker() {
    if (this.circuitBreaker.state === "open") {
      // Allow recovery if timeout has passed
      if (Date.now() - this.circuitBreaker.lastFailure > this.circuitBreaker.timeout) {
        this.circuitBreaker.state = "half-open";
        this.circuitBreaker.failures = Math.floor(this.circuitBreaker.threshold / 2);
        logger.info(
          `Circuit breaker timeout expired, entering half-open state for ${this.constructor.name}`,
        );
      } else {
        throw new Error(
          `Circuit breaker is open for ${this.constructor.name}. Too many consecutive failures. Please wait ${Math.ceil((this.circuitBreaker.timeout - (Date.now() - this.circuitBreaker.lastFailure)) / 1000)} seconds and try again.`,
        );
      }
    }
  }

  // Retry logic with exponential backoff
  async executeWithRetry(fn, _context = {}) {
    let lastError;
    let delay = this.retryConfig.initialDelay;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error;
        logger.warn(
          `Query attempt ${attempt + 1} failed for ${this.constructor.name}: ${error.message}`,
        );

        if (attempt < this.retryConfig.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay);
        }
      }
    }

    throw lastError;
  }

  // Get strategy metrics
  getMetrics() {
    return {
      ...this.metrics,
      avgQueryTime:
        this.metrics.queries > 0
          ? Math.round(this.metrics.totalQueryTime / this.metrics.queries)
          : 0,
      errorRate:
        this.metrics.queries > 0
          ? ((this.metrics.errors / this.metrics.queries) * 100).toFixed(2)
          : 0,
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
      },
    };
  }

  getPoolMetrics() {
    // Override in subclasses with actual pool metrics
    return {
      available: 0,
      total: 0,
      waiting: 0,
    };
  }

  resetMetrics() {
    this.metrics = {
      queries: 0,
      errors: 0,
      totalQueryTime: 0,
      lastQuery: null,
      queryTypes: {},
    };
  }

  getCapabilities() {
    return (
      this.capabilityModel || this.capabilities || { operations: [], features: [], limits: {} }
    );
  }

  validateOperation(operation, _payload) {
    if (!operation) return true;
    const caps = this.getCapabilities();
    const operations = Array.isArray(caps?.operations)
      ? caps.operations.map((op) => String(op).toLowerCase())
      : [];
    const op = String(operation).toLowerCase();
    if (operations.length === 0 || operations.includes(op)) {
      return true;
    }
    const label = this.dbType || "this database";
    throw new Error(`Operation '${operation}' is not supported for ${label}.`);
  }

  normalizeResult(result) {
    if (result && typeof result === "object") {
      return result;
    }
    return { raw: result };
  }

  normalizeMetadata(metadata) {
    if (metadata && typeof metadata === "object") {
      return metadata;
    }
    return { raw: metadata };
  }

  // Core connection methods
  async connect(_config) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("connect"));
  }

  async disconnect() {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("disconnect"));
  }

  async validateConnection() {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("validateConnection"));
  }

  // Database navigation methods
  async switchDatabase(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("switchDatabase"));
  }

  async getDatabases() {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getDatabases"));
  }

  // Structure methods (Tables/Collections/Keys)
  async getStructure() {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getStructure"));
  }

  // SQL specific (kept for backward compatibility and SQL implementations)
  async getTables(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getTables"));
  }

  async getTableInfo(_dbName, _tableName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getTableInfo"));
  }

  async getMultipleTablesInfo(_dbName, _tableNames) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getMultipleTablesInfo"));
  }

  async getViews(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getViews"));
  }

  async getProcedures(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getProcedures"));
  }

  async getFunctions(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getFunctions"));
  }

  // NoSQL specific stubs
  async getCollections(_dbName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollections"));
  }

  async getCollectionInfo(_dbName, _collectionName) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getCollectionInfo"));
  }

  // Cache specific stubs
  async getKeys(_pattern) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getKeys"));
  }

  // Enhanced query execution with hooks and metrics
  async executeQuery(query, options = {}) {
    this.checkCircuitBreaker();
    const startTime = Date.now();
    const queryAnalysis = this.analyzeQuery(query);

    try {
      await this.executeHooks("query.pre", { query, options, analysis: queryAnalysis });

      const hasOptions =
        options &&
        typeof options === "object" &&
        !Array.isArray(options) &&
        Object.keys(options).length > 0;
      const result = await this._executeQueryImpl(query, hasOptions ? options : undefined);

      const queryTime = Date.now() - startTime;
      this.metrics.queries++;
      this.metrics.totalQueryTime += queryTime;
      this.metrics.lastQuery = {
        query,
        time: queryTime,
        type: queryAnalysis.type,
        timestamp: new Date().toISOString(),
      };

      // Track query types
      this.metrics.queryTypes[queryAnalysis.type] =
        (this.metrics.queryTypes[queryAnalysis.type] || 0) + 1;

      this.recordQuerySuccess();
      await this.executeHooks("query.post", { query, result, queryTime, analysis: queryAnalysis });

      return result;
    } catch (error) {
      this.recordQueryFailure(error);
      await this.executeHooks("query.error", { query, error, options });
      throw error;
    }
  }

  // Override this in subclasses
  async _executeQueryImpl(_query, _options = {}) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("executeQuery"));
  }

  async executeBatch(_queries, _options = {}) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("executeBatch"));
  }

  async executeTransaction(_queries, _options = {}) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("executeTransaction"));
  }

  // Query analysis and validation
  analyzeQuery(query) {
    if (typeof query !== "string") {
      return {
        type: "COMMAND",
        isReadOnly: false,
        requiresTransaction: false,
        supportsPagination: false,
      };
    }

    const trimmedQuery = query.trim().toUpperCase();

    for (const [type, patterns] of Object.entries(QUERY_TYPES)) {
      if (patterns.some((pattern) => pattern.test(trimmedQuery))) {
        return {
          type,
          isReadOnly: this.isReadOnlyQuery(type),
          requiresTransaction: this.requiresTransaction(type),
          supportsPagination: this.supportsPagination(type),
        };
      }
    }

    return {
      type: "UNKNOWN",
      isReadOnly: false,
      requiresTransaction: false,
      supportsPagination: false,
    };
  }

  isReadOnlyQuery(queryType) {
    const readOnlyTypes = ["SELECT", "SHOW", "DESCRIBE", "EXPLAIN"];
    return readOnlyTypes.includes(queryType);
  }

  requiresTransaction(queryType) {
    const transactionTypes = ["INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER"];
    return transactionTypes.includes(queryType);
  }

  supportsPagination(queryType) {
    return queryType === "SELECT";
  }

  // Utility methods for all database types
  sanitizeIdentifier(identifier) {
    return identifier.replace(/[^\w_]/g, "");
  }

  // Allow dotted identifiers for ORDER BY (e.g., schema.table.column)
  sanitizeOrderBy(identifier) {
    if (!identifier || typeof identifier !== "string") return "";
    return identifier
      .split(".")
      .map((part) => this.sanitizeIdentifier(part))
      .filter(Boolean)
      .join(".");
  }

  // Detect if running inside a container
  isRunningInContainer() {
    try {
      if (process.env.DOCKER === "true") return true;
      // /.dockerenv exists in most Docker images
      if (fs.existsSync("/.dockerenv")) return true;
      return false;
    } catch {
      return false;
    }
  }

  // Normalize host when running inside Docker so "localhost" points to the host machine
  normalizeHost(host) {
    if (!host) return host;
    const h = String(host).toLowerCase();
    const isLocal = h === "localhost" || h === "127.0.0.1" || h === "::1";
    if (isLocal && this.isRunningInContainer()) {
      return "host.docker.internal";
    }
    return host;
  }

  buildPaginationQuery(_baseQuery, _page, _pageSize) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("buildPaginationQuery"));
  }

  buildCountQuery(baseQuery) {
    return `SELECT COUNT(*) as count FROM (${baseQuery}) as subquery`;
  }

  /**
   * Fetch rows in a specific range for virtual scrolling
   * @param {string} query - Base query without LIMIT/OFFSET
   * @param {number} offset - Starting row index (0-based)
   * @param {number} limit - Number of rows to fetch
   * @returns {Promise<{rows: any[], hasMore: boolean, columns?: any[]}>}
   */
  async fetchRowRange(_query, _offset, _limit) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("fetchRowRange"));
  }

  // Connection health and monitoring
  async getConnectionHealth() {
    try {
      await this.validateConnection();
      const health = {
        status: "healthy",
        lastCheck: new Date().toISOString(),
        metrics: this.getMetrics(),
        poolMetrics: this.getPoolMetrics(),
      };

      await this.executeHooks("connection.health", health);
      return health;
    } catch (error) {
      const health = {
        status: "unhealthy",
        error: error.message,
        lastCheck: new Date().toISOString(),
      };

      await this.executeHooks("connection.health", health);
      return health;
    }
  }

  // Performance monitoring
  async getQueryStats() {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("getQueryStats"));
  }

  // Security and permissions
  async checkPermissions(_operation, _resource) {
    throw new Error(ERROR_MESSAGES.NOT_IMPLEMENTED("checkPermissions"));
  }
}

module.exports = DatabaseStrategy;
