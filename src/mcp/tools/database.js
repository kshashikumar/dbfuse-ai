const { connectionManager } = require("../../config");
const { z } = require("zod");
const { ensureRuntimeConnectionId } = require("./connection");

/**
 * Database schema and metadata tools
 * Provides detailed information about database structure
 */

const getDatabasesTool = {
  name: "get_databases",
  description: "Get list of all databases available in the connected server",
  inputSchema: z.object({
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { connectionId } = args;

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);

    const databases = await strategy.getDatabases();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              databases,
              totalDatabases: databases.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const getTableInfoTool = {
  name: "get_table_info",
  description:
    "Get detailed information about a specific table including columns, data types, indexes, foreign keys, and constraints",
  inputSchema: z.object({
    tableName: z.string().describe("Name of the table to get information about"),
    dbName: z
      .string()
      .optional()
      .describe("Optional database name (uses current database if not specified)"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { tableName, dbName, connectionId } = args;

    if (!tableName || !tableName.trim()) {
      throw new Error("Table name is required.");
    }

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);
    const connectionInfo = connectionManager.getConnectionInfo(runtimeId);

    const targetDatabase =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;

    if (!targetDatabase) {
      throw new Error(
        "No database specified. Please provide dbName or switch to a database first.",
      );
    }

    const tableInfo = await strategy.getTableInfo(targetDatabase, tableName);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              database: targetDatabase,
              tableInfo,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const switchDatabaseTool = {
  name: "switch_database",
  description: "Switch the active database context for subsequent operations",
  inputSchema: z.object({
    dbName: z.string().describe("Name of the database to switch to"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { dbName, connectionId } = args;

    if (!dbName || !dbName.trim()) {
      throw new Error("Database name is required.");
    }

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);

    await strategy.switchDatabase(dbName);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              message: `Successfully switched to database: ${dbName}`,
              currentDatabase: dbName,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const analyzeQueryTool = {
  name: "analyze_query",
  description:
    "Analyze a SQL query to get its execution plan and performance insights. Helps optimize query performance.",
  inputSchema: z.object({
    query: z.string().describe("The SQL query to analyze"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { query, connectionId } = args;

    if (!query || !query.trim()) {
      throw new Error("Query is required.");
    }

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);

    const analysis = await strategy.analyzeQuery(query);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              query,
              analysis,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const getViewsTool = {
  name: "get_views",
  description: "Get list of all views in the specified or current database",
  inputSchema: z.object({
    dbName: z
      .string()
      .optional()
      .describe("Optional database name (uses current database if not specified)"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { dbName, connectionId } = args;

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);
    const connectionInfo = connectionManager.getConnectionInfo(runtimeId);

    const targetDatabase =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;

    if (!targetDatabase) {
      throw new Error(
        "No database specified. Please provide dbName or switch to a database first.",
      );
    }

    const views = await strategy.getViews(targetDatabase);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              database: targetDatabase,
              views,
              totalViews: views.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const getProceduresTool = {
  name: "get_procedures",
  description: "Get list of all stored procedures in the specified or current database",
  inputSchema: z.object({
    dbName: z
      .string()
      .optional()
      .describe("Optional database name (uses current database if not specified)"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { dbName, connectionId } = args;

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);
    const connectionInfo = connectionManager.getConnectionInfo(runtimeId);

    const targetDatabase =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;

    if (!targetDatabase) {
      throw new Error(
        "No database specified. Please provide dbName or switch to a database first.",
      );
    }

    const procedures = await strategy.getProcedures(targetDatabase);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              database: targetDatabase,
              procedures,
              totalProcedures: procedures.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

module.exports = {
  getDatabasesTool,
  getTableInfoTool,
  switchDatabaseTool,
  analyzeQueryTool,
  getViewsTool,
  getProceduresTool,
};
