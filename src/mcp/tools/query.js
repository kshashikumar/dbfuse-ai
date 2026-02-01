const { z } = require("zod");

const { connectionManager } = require("../../config");

const { ensureRuntimeConnectionId } = require("./connection");

const buildNormalizedResult = (rawResult, dbType) => {
  const normalized = {
    rows: [],
    documents: [],
    keys: [],
    values: [],
    columns: [],
    stats: {},
    raw: rawResult ?? null,
    dbType: dbType || null,
  };

  if (!rawResult || typeof rawResult !== "object") {
    return normalized;
  }

  const mergeStats = (stats) => {
    if (stats && typeof stats === "object") {
      normalized.stats = { ...normalized.stats, ...stats };
    }
  };

  const applyRows = (rows, meta = {}) => {
    if (!Array.isArray(rows)) return;
    normalized.rows = rows;
    if (Array.isArray(meta.columns)) {
      normalized.columns = meta.columns;
    } else if (rows.length && typeof rows[0] === "object") {
      normalized.columns = Object.keys(rows[0]);
    }
    mergeStats({
      rowCount: rows.length,
      totalRows: meta.totalRows ?? meta.stats?.totalRows ?? null,
      hasMore: meta.hasMore ?? meta.stats?.hasMore ?? null,
      page: meta.page ?? meta.pagination?.page ?? null,
      pageSize: meta.pageSize ?? meta.pagination?.pageSize ?? null,
      totalPages: meta.totalPages ?? meta.pagination?.totalPages ?? null,
    });
  };

  const applyDocuments = (documents, meta = {}) => {
    if (!Array.isArray(documents)) return;
    normalized.documents = documents;
    mergeStats({
      rowCount: documents.length,
      totalRows: meta.totalRows ?? null,
      hasMore: meta.hasMore ?? null,
    });
  };

  const applyKeys = (keys, values) => {
    if (!Array.isArray(keys)) return;
    normalized.keys = keys;
    normalized.values = Array.isArray(values) ? values : [];
    mergeStats({ rowCount: keys.length });
  };

  if (typeof rawResult.affectedRows === "number") {
    normalized.affectedRows = rawResult.affectedRows;
    mergeStats({ affectedRows: rawResult.affectedRows });
  }

  if (Array.isArray(rawResult.rows)) {
    applyRows(rawResult.rows, rawResult);
    return normalized;
  }

  if (Array.isArray(rawResult.documents)) {
    applyDocuments(rawResult.documents, rawResult);
    return normalized;
  }

  if (Array.isArray(rawResult.keys)) {
    applyKeys(rawResult.keys, rawResult.values);
    return normalized;
  }

  if (rawResult.key !== undefined || rawResult.value !== undefined) {
    applyKeys([rawResult.key], [rawResult.value]);
    return normalized;
  }

  if (Array.isArray(rawResult.queries)) {
    const queries = rawResult.queries;
    const withRows =
      queries.find((entry) => Array.isArray(entry?.rows)) ||
      queries.find((entry) => Array.isArray(entry?.results?.rows)) ||
      queries[0];

    if (Array.isArray(withRows?.rows)) {
      applyRows(withRows.rows, {
        totalRows: withRows.totalRows,
        pagination: withRows.pagination,
        columns: withRows.columns,
      });
      return normalized;
    }

    if (Array.isArray(withRows?.results?.rows)) {
      applyRows(withRows.results.rows, withRows.results);
      return normalized;
    }

    const message = Array.isArray(withRows?.messages) ? withRows.messages[0] : null;
    if (message) {
      if (typeof message.affectedRows === "number") {
        normalized.affectedRows = message.affectedRows;
      }
      mergeStats({
        affectedRows: message.affectedRows ?? null,
        warningCount: message.warningCount ?? null,
      });
    }

    mergeStats({
      totalQueries: Array.isArray(queries) ? queries.length : null,
    });
    return normalized;
  }

  if (Array.isArray(rawResult.result?.rows)) {
    applyRows(rawResult.result.rows, rawResult.result);
    return normalized;
  }

  if (Array.isArray(rawResult.result?.documents)) {
    applyDocuments(rawResult.result.documents, rawResult.result);
    return normalized;
  }

  if (Array.isArray(rawResult.result?.keys)) {
    applyKeys(rawResult.result.keys, rawResult.result.values);
    return normalized;
  }

  return normalized;
};

const executeQueryTool = {
  name: "execute_query",
  description: "Execute a query or command on the active connection",
  inputSchema: z.object({
    query: z.any().describe("The query/command to execute (SQL string or JSON payload)"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { query, connectionId } = args;
    if (typeof query === "string") {
      if (!query.trim()) {
        throw new Error("A non-empty SQL query is required.");
      }
    } else if (!query || typeof query !== "object") {
      throw new Error("A query payload object is required.");
    }

    const runtimeId = await ensureRuntimeConnectionId(
      connectionId || connectionManager.getAllConnectionsInfo()[0]?.id,
    );
    const strategy = connectionManager.getConnection(runtimeId);
    const connectionInfo = connectionManager.getConnectionInfo(runtimeId);
    const dbType =
      connectionInfo?.dbType || connectionInfo?.config?.dbType || strategy?.dbType || null;
    if (typeof strategy.validateOperation === "function") {
      strategy.validateOperation("query", { query });
    }
    const result = await strategy.executeQuery(query);
    const normalizedResult = buildNormalizedResult(result, dbType);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              dbType,
              result: normalizedResult,
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
