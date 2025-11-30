const { connectionManager } = require("../../config");

const { ensureRuntimeConnectionId } = require("./connection");

const executeQueryTool = {
  name: "execute_query",
  description: "Execute a SQL query on the active connection",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The SQL query to execute",
      },
      connectionId: {
        type: "string",
        description: "Optional connection ID to use (defaults to active)",
      },
    },
    required: ["query"],
  },
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
  inputSchema: {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Optional connection ID to use",
      },
      dbName: {
        type: "string",
        description: "Optional database name",
      },
    },
  },
  handler: async (args) => {
    const { connectionId, dbName } = args;
    const runtimeId = await ensureRuntimeConnectionId(connectionId);
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
