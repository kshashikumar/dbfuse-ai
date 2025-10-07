// dbController.js (Updated to support connectionId-based routing while keeping legacy handlers)
const dbContext = require("../config/database-context"); // Legacy singleton instance (kept for backwards compatibility)
// Use shared ConnectionManager singleton so all controllers share connections
const connectionManager = require("../config/connection-manager-singleton");
const chalk = require("chalk");

// Enhanced response helper
const sendResponse = (res, status, data, error = null) => {
  if (!res.headersSent) {
    res.status(status).json(error ? { error } : data);
  }
};

// Enhanced error handler
const handleError = (res, error, operation) => {
  console.error(`Error in ${operation}:`, error);

  if (
    error.message.includes("syntax error") ||
    error.code === "ER_PARSE_ERROR" ||
    error.sqlState === "42000" ||
    error.code === "42601" ||
    error.code === "ORA-00900" ||
    error.message.includes("SQLITE_ERROR")
  ) {
    return sendResponse(res, 400, null, "SQL syntax error. Please check your query.");
  }

  if (error.code || error.sqlState || error.number) {
    return sendResponse(res, 400, null, `Database error: ${error.message}`);
  }

  sendResponse(res, 500, null, `Error ${operation}`);
};

// Get database type from headers
const getDbType = (req) => {
  return req.headers["x-db-type"] || req.headers["X-DB-Type"] || req.headers["X-Db-Type"];
};

const getDatabases = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    const databaseStats = await strategy.getDatabases();
    sendResponse(res, 200, { databases: databaseStats, retrievedAt: new Date().toISOString() });
  } catch (err) {
    handleError(res, err, "fetching database stats");
  }
};

const getTables = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const dbName = req.query.dbName || req.body?.dbName;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    const tables = await strategy.getTables(currentDb);
    sendResponse(res, 200, {
      tables,
      count: Array.isArray(tables) ? tables.length : 0,
      database: currentDb,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "fetching tables");
  }
};

const getTableInfo = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const dbName = req.query.dbName || req.body?.dbName;
  const table = req.query.table || req.body?.table;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  if (!table) return sendResponse(res, 400, null, "table is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    const tableInfo = await strategy.getTableInfo(currentDb, table);
    sendResponse(res, 200, { ...tableInfo, retrievedAt: new Date().toISOString() });
  } catch (err) {
    handleError(res, err, "fetching table stats");
  }
};

const getMultipleTablesInfo = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const { tables, dbName } = req.body;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return sendResponse(res, 400, null, "Tables array is required.");
  }
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    const tableDetails = await strategy.getMultipleTablesInfo(currentDb, tables);
    sendResponse(res, 200, {
      tables: tableDetails,
      count: tableDetails.length,
      database: currentDb,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "fetching multiple table information");
  }
};

const executeQuery = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  let { query, page = 1, pageSize = 10, dbName } = req.body;

  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  if (!query || typeof query !== "string") {
    return sendResponse(res, 400, null, "Query is required and must be a string");
  }

  page = Math.max(1, parseInt(page) || 1);
  pageSize = Math.min(Math.max(1, parseInt(pageSize) || 10), 1000);

  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const result = await strategy.executeQuery(query, {
      page,
      pageSize,
      dbName,
    });

    if (result && Array.isArray(result.queries)) {
      return sendResponse(res, 200, {
        queries: result.queries,
        totalQueries: result.totalQueries,
        executedAt: result.executedAt,
      });
    }

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
    };
    sendResponse(res, 200, response);
  } catch (err) {
    handleError(res, err, "executing query");
  }
};

const connect = async (req, res) => {
  const dbType = getDbType(req);
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
    return sendResponse(res, 400, null, "Database type (x-db-type) must be specified in headers");
  }

  let requiredFields = ["dbType"];
  if (dbType !== "sqlite3") {
    requiredFields = ["username", "password", "host", "port", "dbType"];
  } else {
    requiredFields.push("database");
  }

  const missingFields = requiredFields.filter(
    (field) => !req.body[field] && req.body[field] !== "",
  );
  if (missingFields.length > 0) {
    return sendResponse(res, 400, null, `Missing required fields: ${missingFields.join(", ")}`);
  }
  if (dbType !== bodyDbType) {
    return sendResponse(res, 400, null, "dbType in body must match x-db-type in headers");
  }

  chalk.italic.cyan(
    `> Attempting to connect to ${dbType} ${
      dbType === "sqlite3"
        ? `database: ${database}`
        : `server @ ${host}:${port} with user ${username}`
    }`,
  );

  try {
    const config =
      dbType === "sqlite3"
        ? { dbType, database, ...sqliteConfig }
        : { username, password, host, port, dbType, database, socketPath };

    // Establish connection via dbContext to leverage existing setup
    await dbContext.connect(config);
    const strategy = dbContext.getStrategy();
    const connectionId = connectionManager.generateConnectionId(config);
    // Register the live connection without reconnecting
    connectionManager.registerExistingConnection(connectionId, strategy, config);

    sendResponse(res, 200, {
      message: `Connected to ${dbType} ${
        dbType === "sqlite3" ? `database: ${database}` : `server @ ${host}:${port}`
      }`,
      timestamp: new Date().toISOString(),
      database: database || "default",
      connectionId,
    });
  } catch (err) {
    handleError(res, err, "connecting to database");
  }
};

const switchDatabase = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const { dbName } = req.body;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  if (!dbName) return sendResponse(res, 400, null, "Database name is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    if (info) info.currentDatabase = dbName;
    sendResponse(res, 200, {
      message: `Switched to database ${dbName}`,
      database: dbName,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "switching database");
  }
};

const executeBatch = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const { queries, dbName } = req.body;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return sendResponse(res, 400, null, "Queries array is required and must not be empty");
  }
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const results = [];
    for (const q of queries) {
      const result = await strategy.executeQuery(q, { dbName });
      results.push(result);
    }
    sendResponse(res, 200, {
      results,
      totalQueries: queries.length,
      executedAt: new Date().toISOString(),
      mode: "batch",
    });
  } catch (err) {
    handleError(res, err, "executing batch");
  }
};

const getConnectionHealth = async (req, res) => {
  try {
    const isHealthy = await dbContext.validateConnection();
    sendResponse(res, 200, {
      status: isHealthy ? "healthy" : "unhealthy",
      connected: dbContext.isConnectionActive(),
      dbType: dbContext.getCurrentDbType(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    sendResponse(res, 200, {
      status: "unhealthy",
      connected: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const analyzeQuery = async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return sendResponse(res, 400, null, "Query is required");
  }

  try {
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

    sendResponse(res, 200, {
      query: query.substring(0, 100) + (query.length > 100 ? "..." : ""),
      analysis,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "analyzing query");
  }
};

const getViews = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const dbName = req.query.dbName || req.body?.dbName;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    if (!strategy.getViews)
      return sendResponse(res, 501, null, "Views not supported for this database type");
    const views = await strategy.getViews(currentDb);
    sendResponse(res, 200, {
      views,
      count: Array.isArray(views) ? views.length : 0,
      database: currentDb,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "fetching views");
  }
};

const getProcedures = async (req, res) => {
  const connectionId = req.headers["x-connection-id"] || req.headers["X-Connection-Id"];
  const dbName = req.query.dbName || req.body?.dbName;
  if (!connectionId) return sendResponse(res, 400, null, "x-connection-id header is required");
  try {
    const strategy = connectionManager.getConnection(connectionId);
    if (dbName && strategy.switchDatabase) await strategy.switchDatabase(dbName);
    const info = connectionManager.getConnectionInfo(connectionId);
    const currentDb = dbName || info?.currentDatabase || info?.config?.database;
    if (!strategy.getProcedures)
      return sendResponse(res, 501, null, "Procedures not supported for this database type");
    const procedures = await strategy.getProcedures(currentDb);
    sendResponse(res, 200, {
      procedures,
      count: Array.isArray(procedures) ? procedures.length : 0,
      database: currentDb,
      retrievedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleError(res, err, "fetching procedures");
  }
};

module.exports = {
  getDatabases,
  getTables,
  getTableInfo,
  executeQuery,
  getMultipleTablesInfo,
  connect,
  switchDatabase,
  executeBatch,
  getConnectionHealth,
  analyzeQuery,
  getViews,
  getProcedures,
};
