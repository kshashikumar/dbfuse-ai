const { connectionManager } = require("../../config");
const { z } = require("zod");

const { ensureRuntimeConnectionId } = require("./connection");

const executeQueryTool = {
  name: "execute_query",
  description: "Execute a SQL query on the active connection",
  inputSchema: z.object({
    query: z.string().describe("The SQL query to execute"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { query, connectionId } = args;
    if (!query || typeof query !== "string" || !query.trim()) {
      throw new Error("A non-empty SQL query is required.");
    }

    const runtimeId = await ensureRuntimeConnectionId(
      connectionId || connectionManager.getAllConnectionsInfo()[0]?.id,
    );
    const strategy = connectionManager.getConnection(runtimeId);
    const result = await strategy.executeQuery(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              result,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

const getTablesTool = {
  name: "get_tables",
  description: "Get list of tables in the current database",
  inputSchema: z.object({
    connectionId: z.string().optional().describe("Optional connection ID to use"),
    dbName: z.string().optional().describe("Optional database name"),
  }),
  handler: async (args) => {
    const { connectionId, dbName } = args;

    // Use provided connectionId, or active connection, or first available
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

    if (targetDatabase && typeof strategy.switchDatabase === "function") {
      await strategy.switchDatabase(targetDatabase);
    }

    const tables = await strategy.getTables(targetDatabase);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              database: targetDatabase,
              tables,
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
  executeQueryTool,
  getTablesTool,
};
