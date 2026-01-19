/**
 * @fileoverview Database controller
 * Handles HTTP endpoints for database operations (queries, schema, connections)
 */

const BaseController = require("./base/BaseController");
const chalk = require("chalk");
const dbContext = require("../config/database-context");
const { connectionManager } = require("../config");
const { getStrategyMetadata } = require("../config/create-strategy");
const databaseService = require("../services/DatabaseService");
const logger = require("../utils/logger");
const {
  HEADERS,
  HEADER_VARIANTS,
  DEFAULT_CONFIG,
  DB_TYPES,
  HTTP_STATUS,
} = require("../core/constants");
const { getHeaderValue } = require("../utils/http");

class DatabaseController extends BaseController {
  /**
   * Get database type from headers
   * @private
   */
  _getDbType(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.DB_TYPE);
  }

  /**
   * Get connection ID from headers
   * @private
   */
  _getConnectionId(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.CONNECTION_ID);
  }

  /**
   * Get databases for connection
   */
  async getDatabases(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("getDatabases", { connectionId });
      const result = await databaseService.getDatabases(connectionId);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching databases");
    }
  }

  /**
   * Get tables for connection/database
   */
  async getTables(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("getTables", { connectionId, dbName });
      const result = await databaseService.getTables(connectionId, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching tables");
    }
  }

  /**
   * Get table information
   */
  async getTableInfo(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;
      const table = req.query.table || req.body?.table;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!table) {
        return this.sendError(res, "table parameter is required", HTTP_STATUS.BAD_REQUEST);
      }

      this.logOperation("getTableInfo", { connectionId, table, dbName });
      const result = await databaseService.getTableInfo(connectionId, table, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching table information");
    }
  }

  /**
   * Get multiple tables information
   */
  async getMultipleTablesInfo(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const { tables, dbName } = req.body;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!tables || !Array.isArray(tables) || tables.length === 0) {
        return this.sendError(
          res,
          "tables array is required and must not be empty",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("getMultipleTablesInfo", { connectionId, count: tables.length });
      const result = await databaseService.getMultipleTablesInfo(connectionId, tables, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching multiple tables information");
    }
  }

  /**
   * Execute SQL query
   */
  async executeQuery(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      let {
        query,
        page = 1,
        pageSize = DEFAULT_CONFIG.PAGE_SIZE,
        dbName,
        useCache = true,
      } = req.body;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const isStringQuery = typeof query === "string";
      const isObjectQuery = query && typeof query === "object";

      if (!query || (!isStringQuery && !isObjectQuery)) {
        return this.sendError(
          res,
          "query is required and must be a string or object",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      // Parse and validate pagination
      page = Math.max(1, parseInt(page) || 1);
      pageSize = Math.min(
        Math.max(1, parseInt(pageSize) || DEFAULT_CONFIG.PAGE_SIZE),
        DEFAULT_CONFIG.MAX_PAGE_SIZE,
      );

      this.logOperation("executeQuery", {
        connectionId,
        queryLength: isStringQuery ? query.length : undefined,
        queryMode: !isStringQuery ? query.mode || query.operation || query.action : undefined,
      });

      const result = await databaseService.executeQuery(connectionId, query, {
        page,
        pageSize,
        dbName,
        useCache,
      });

      // Handle batch query response
      if (result && Array.isArray(result.queries)) {
        return this.sendSuccess(res, {
          queries: result.queries,
          totalQueries: result.totalQueries,
          executedAt: result.executedAt,
        });
      }

      // Handle string query response with pagination
      if (isStringQuery) {
        const response = {
          rows: result.rows || [],
          totalRows: result.totalRows || 0,
          messages: result.messages || [],
          pagination: {
            page,
            pageSize,
            totalPages: result.totalRows ? Math.ceil(result.totalRows / pageSize) : null,
            hasMore: result.totalRows ? page * pageSize < result.totalRows : false,
          },
          executedAt: new Date().toISOString(),
          cached: result.cached || false,
        };

        return this.sendSuccess(res, response);
      }

      return this.sendSuccess(res, {
        ...result,
        executedAt: new Date().toISOString(),
        cached: result.cached || false,
      });
    } catch (error) {
      this.handleError(res, error, "executing query");
    }
  }

  /**
   * Get collections for NoSQL connections
   */
  async getCollections(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("getCollections", { connectionId, dbName });
      const result = await databaseService.getCollections(connectionId, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching collections");
    }
  }

  /**
   * Get collection information
   */
  async getCollectionInfo(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;
      const collection = req.query.collection || req.body?.collection;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!collection) {
        return this.sendError(res, "collection parameter is required", HTTP_STATUS.BAD_REQUEST);
      }

      this.logOperation("getCollectionInfo", { connectionId, collection, dbName });
      const result = await databaseService.getCollectionInfo(connectionId, collection, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching collection information");
    }
  }

  /**
   * Get key patterns for cache/key-value stores
   */
  async getKeyPatterns(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const pattern = req.query.pattern || req.body?.pattern || "*";

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("getKeyPatterns", { connectionId, pattern });
      const result = await databaseService.getKeyPatterns(connectionId, pattern);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "fetching key patterns");
    }
  }

  /**
   * Connect to database (legacy method for backward compatibility)
   */
  async connect(req, res) {
    try {
      const dbType = this._getDbType(req);
      const {
        username,
        password,
        host,
        port,
        dbType: bodyDbType,
        database,
        socketPath,
        ...sqliteConfig
      } = req.body;

      if (!dbType) {
        return this.sendError(
          res,
          `Database type (${HEADERS.DB_TYPE}) must be specified in headers`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      // Validate required fields based on database type
      let requiredFields = ["dbType"];
      const sqlTypes = new Set([
        DB_TYPES.MYSQL,
        DB_TYPES.POSTGRESQL,
        DB_TYPES.SQLITE,
        DB_TYPES.MSSQL,
        DB_TYPES.ORACLE,
      ]);
      const noSqlTypes = new Set([
        DB_TYPES.MONGODB,
        DB_TYPES.REDIS,
        DB_TYPES.COUCHBASE,
        DB_TYPES.COUCHDB,
        DB_TYPES.COSMOSDB,
        DB_TYPES.FIRESTORE,
        DB_TYPES.DYNAMODB,
        DB_TYPES.CASSANDRA,
        DB_TYPES.HBASE,
        DB_TYPES.MEMCACHED,
      ]);
      const optionalHostTypes = new Set([DB_TYPES.FIRESTORE, DB_TYPES.DYNAMODB]);

      if (dbType === DB_TYPES.SQLITE) {
        requiredFields.push("database");
      } else if (sqlTypes.has(dbType)) {
        requiredFields = ["username", "password", "host", "port", "dbType"];
      } else if (noSqlTypes.has(dbType)) {
        requiredFields = optionalHostTypes.has(dbType) ? ["dbType"] : ["host", "port", "dbType"];
      } else {
        requiredFields = ["host", "port", "dbType"];
      }

      const validation = this.validateRequired(req.body, requiredFields);
      if (!validation.valid) {
        return this.sendError(res, validation.error, HTTP_STATUS.BAD_REQUEST);
      }

      if (dbType !== bodyDbType) {
        return this.sendError(
          res,
          `dbType in body must match ${HEADERS.DB_TYPE} in headers`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("connect", { dbType, host, database });

      chalk.italic.cyan(
        `> Attempting to connect to ${dbType} ${
          dbType === DB_TYPES.SQLITE
            ? `database: ${database}`
            : `server @ ${host}:${port} with user ${username}`
        }`,
      );

      const config =
        dbType === DB_TYPES.SQLITE
          ? { dbType, database, ...sqliteConfig }
          : { username, password, host, port, dbType, database, socketPath };

      // Establish connection via dbContext
      await dbContext.connect(config);
      const strategy = dbContext.getStrategy();
      const connectionId = connectionManager.generateConnectionId(config);

      // Register existing connection
      connectionManager.registerExistingConnection(connectionId, strategy, config);

      return this.sendSuccess(res, {
        message: `Connected to ${dbType} ${
          dbType === DB_TYPES.SQLITE ? `database: ${database}` : `server @ ${host}:${port}`
        }`,
        database: database || "default",
        connectionId,
      });
    } catch (error) {
      this.handleError(res, error, "connecting to database");
    }
  }

  /**
   * Switch database
   */
  async switchDatabase(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const { dbName } = req.body;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!dbName) {
        return this.sendError(res, "Database name is required", HTTP_STATUS.BAD_REQUEST);
      }

      this.logOperation("switchDatabase", { connectionId, dbName });
      const result = await databaseService.switchDatabase(connectionId, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "switching database");
    }
  }

  /**
   * Execute batch queries
   */
  async executeBatch(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const { queries, dbName } = req.body;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!queries || !Array.isArray(queries) || queries.length === 0) {
        return this.sendError(
          res,
          "queries array is required and must not be empty",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("executeBatch", { connectionId, count: queries.length });
      const result = await databaseService.executeBatch(connectionId, queries, dbName);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "executing batch queries");
    }
  }

  /**
   * Get connection health (legacy compatibility)
   */
  async getConnectionHealth(req, res) {
    try {
      const isHealthy = await dbContext.validateConnection();
      return this.sendSuccess(res, {
        status: isHealthy ? "healthy" : "unhealthy",
        connected: dbContext.isConnectionActive(),
        dbType: dbContext.getCurrentDbType(),
      });
    } catch (error) {
      return this.sendSuccess(res, {
        status: "unhealthy",
        connected: false,
        error: error.message,
      });
    }
  }

  /**
   * Analyze query
   */
  async analyzeQuery(req, res) {
    try {
      const { query } = req.body;

      if (!query) {
        return this.sendError(res, "query is required", HTTP_STATUS.BAD_REQUEST);
      }

      const trimmedQuery = query.trim().toUpperCase();
      const isSelect = trimmedQuery.startsWith("SELECT");
      const isReadOnly = /^(SELECT|SHOW|DESCRIBE|EXPLAIN)\s/i.test(trimmedQuery);

      const analysis = {
        type: isSelect ? "SELECT" : "OTHER",
        isReadOnly,
        requiresTransaction: !isReadOnly,
        supportsPagination: isSelect,
        queryLength: query.length,
      };

      return this.sendSuccess(res, {
        query: query.substring(0, 100) + (query.length > 100 ? "..." : ""),
        analysis,
        analyzedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.handleError(res, error, "analyzing query");
    }
  }

  /**
   * Get views for database
   */
  async getViews(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const strategy = connectionManager.getConnection(connectionId);

      if (!strategy.getViews) {
        return this.sendError(
          res,
          "Views not supported for this database type",
          HTTP_STATUS.NOT_IMPLEMENTED,
        );
      }

      if (dbName && strategy.switchDatabase) {
        await strategy.switchDatabase(dbName);
      }

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = dbName || info?.currentDatabase || info?.config?.database;
      const views = await strategy.getViews(currentDb);

      return this.sendSuccess(res, {
        views,
        count: Array.isArray(views) ? views.length : 0,
        database: currentDb,
        retrievedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.handleError(res, error, "fetching views");
    }
  }

  /**
   * Get stored procedures for database
   */
  async getProcedures(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbName = req.query.dbName || req.body?.dbName;

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const strategy = connectionManager.getConnection(connectionId);

      if (!strategy.getProcedures) {
        return this.sendError(
          res,
          "Procedures not supported for this database type",
          HTTP_STATUS.NOT_IMPLEMENTED,
        );
      }

      if (dbName && strategy.switchDatabase) {
        await strategy.switchDatabase(dbName);
      }

      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = dbName || info?.currentDatabase || info?.config?.database;
      const procedures = await strategy.getProcedures(currentDb);

      return this.sendSuccess(res, {
        procedures,
        count: Array.isArray(procedures) ? procedures.length : 0,
        database: currentDb,
        retrievedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.handleError(res, error, "fetching procedures");
    }
  }

  /**
   * Get strategy metadata for current database type
   */
  async getStrategyMetadata(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const headerDbType = this._getDbType(req);

      let dbType = headerDbType;
      if (!dbType && connectionId) {
        const info = connectionManager.getConnectionInfo(connectionId);
        dbType = info?.config?.dbType;
      }

      if (!dbType) {
        return this.sendError(
          res,
          `${HEADERS.DB_TYPE} header or connection is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const metadata = getStrategyMetadata(dbType);
      if (!metadata) {
        return this.sendError(
          res,
          "Strategy metadata not available for this database type",
          HTTP_STATUS.NOT_IMPLEMENTED,
        );
      }

      return this.sendSuccess(res, {
        dbType,
        metadata,
        retrievedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.handleError(res, error, "fetching strategy metadata");
    }
  }

  /**
   * Get database service metrics
   */
  async getMetrics(req, res) {
    try {
      const metrics = databaseService.getMetrics();
      return this.sendSuccess(res, { metrics });
    } catch (error) {
      this.handleError(res, error, "fetching database metrics");
    }
  }

  /**
   * Clear query cache
   */
  async clearCache(req, res) {
    try {
      databaseService.clearCache();
      return this.sendSuccess(res, {
        message: "Query cache cleared successfully",
      });
    } catch (error) {
      this.handleError(res, error, "clearing cache");
    }
  }
}

// Export controller instance with bound methods
const controller = new DatabaseController();

module.exports = {
  getDatabases: controller.getDatabases.bind(controller),
  getTables: controller.getTables.bind(controller),
  getTableInfo: controller.getTableInfo.bind(controller),
  getCollections: controller.getCollections.bind(controller),
  getCollectionInfo: controller.getCollectionInfo.bind(controller),
  getKeyPatterns: controller.getKeyPatterns.bind(controller),
  executeQuery: controller.executeQuery.bind(controller),
  getMultipleTablesInfo: controller.getMultipleTablesInfo.bind(controller),
  connect: controller.connect.bind(controller),
  switchDatabase: controller.switchDatabase.bind(controller),
  executeBatch: controller.executeBatch.bind(controller),
  getConnectionHealth: controller.getConnectionHealth.bind(controller),
  analyzeQuery: controller.analyzeQuery.bind(controller),
  getViews: controller.getViews.bind(controller),
  getProcedures: controller.getProcedures.bind(controller),
  getStrategyMetadata: controller.getStrategyMetadata.bind(controller),
  getMetrics: controller.getMetrics.bind(controller),
  clearCache: controller.clearCache.bind(controller),
};
