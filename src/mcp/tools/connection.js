const { connectionStore, connectionManager, createStrategy } = require("../../config");
const { CONNECTION_STATES, MCP_CONSTANTS, MCP_MESSAGES } = require("../../core/constants");
const logger = require("../../utils/logger");

// Helper functions (moved from server.js)
const storedConnectionRuntimeIds = new Map();

const buildRuntimeConnectionId = (storedKey) =>
  `${MCP_CONSTANTS.STORED_CONNECTION_PREFIX}${storedKey}`;

const rememberRuntimeMapping = (storedKey, runtimeId) => {
  if (storedKey === undefined || storedKey === null) return;
  storedConnectionRuntimeIds.set(String(storedKey), runtimeId);
};

const getRememberedRuntimeId = (storedKey) => storedConnectionRuntimeIds.get(String(storedKey));

const sanitizeConfigForDisplay = (connection, runtimeId = null) => ({
  id: connection.id,
  label: connectionStore.buildConnectionSignature(connection),
  dbType: connection.dbType,
  host: connection.host,
  port: connection.port,
  database: connection.database,
  status: connection.status,
  socketPath: connection.socketPath,
  active: runtimeId ? connectionManager.isConnectionActive(runtimeId) : false,
  runtimeConnectionId:
    runtimeId && connectionManager.isConnectionActive(runtimeId) ? runtimeId : null,
  lastUsed: connection.lastUsed,
  createdAt: connection.createdAt,
});

const resolveStoredConnection = async (reference) => {
  const connections = await connectionStore.readConnections();
  const match = connectionStore.findConnection(connections, reference);
  if (match) {
    return { match, connections };
  }

  const raw = typeof reference === "string" ? reference.trim() : String(reference);
  const duplicates = connections.filter((conn) => conn.dbType === raw);
  if (duplicates.length > 1) {
    throw new Error(MCP_MESSAGES.AMBIGUOUS_REFERENCE(reference));
  }

  throw new Error(MCP_MESSAGES.CONNECTION_NOT_FOUND(reference));
};

const updateStoredConnectionStatus = async (storedConnection, state) => {
  try {
    const connections = await connectionStore.readConnections();
    const index = connections.findIndex((conn) => String(conn.id) === String(storedConnection.id));
    if (index === -1) return;
    connections[index] = {
      ...connections[index],
      status: state,
      lastUsed: new Date().toISOString(),
    };
    await connectionStore.writeConnections(connections);
  } catch (error) {
    logger.warn("Unable to update stored connection status: %o", error);
  }
};

const normalizeStrategyConfig = (connection) => {
  // ... (logic from server.js)
  // For brevity, assuming standard properties are enough or copying logic
  // Copying logic from server.js for completeness
  if (connection.dbType === "sqlite3") {
    // Hardcoded string or import DB_TYPES
    return {
      dbType: connection.dbType,
      database: connection.database,
      journalMode: connection.journalMode,
      synchronous: connection.synchronous,
      foreignKeys: connection.foreignKeys,
      socketPath: connection.socketPath,
    };
  }

  return {
    username: connection.username,
    password: connection.password,
    host: connection.host,
    port: connection.port,
    dbType: connection.dbType,
    database: connection.database,
    socketPath: connection.socketPath,
    ssl: connection.ssl,
    connectionTimeout: connection.connectionTimeout,
    poolSize: connection.poolSize,
  };
};

const activateStoredConnection = async (storedConnection) => {
  const storedKey =
    storedConnection.id ?? connectionStore.buildConnectionSignature(storedConnection);
  const storedKeyString = String(storedKey);
  const rememberedRuntimeId = getRememberedRuntimeId(storedKeyString);
  if (rememberedRuntimeId && connectionManager.isConnectionActive(rememberedRuntimeId)) {
    return rememberedRuntimeId;
  }

  const preferredRuntimeId = buildRuntimeConnectionId(storedKeyString);
  if (connectionManager.isConnectionActive(preferredRuntimeId)) {
    rememberRuntimeMapping(storedKeyString, preferredRuntimeId);
    return preferredRuntimeId;
  }

  const strategy = createStrategy(storedConnection.dbType);
  const config = normalizeStrategyConfig(storedConnection);

  try {
    await strategy.connect(config);
    connectionManager.registerExistingConnection(preferredRuntimeId, strategy, config);
    rememberRuntimeMapping(storedKeyString, preferredRuntimeId);
    await updateStoredConnectionStatus(storedConnection, CONNECTION_STATES.CONNECTED);
    return preferredRuntimeId;
  } catch (error) {
    if (strategy && typeof strategy.disconnect === "function") {
      try {
        await strategy.disconnect();
      } catch (disconnectError) {
        logger.warn("Failed to disconnect strategy after connection error: %o", disconnectError);
      }
    }
    throw error;
  }
};

const listConnectionsTool = {
  name: "list_connections",
  description: "List all configured database connections",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    const storedConnections = await connectionStore.readConnections({ hideSecrets: true });
    const responsePayload = storedConnections.map((connection) => {
      const storedKey = connection.id ?? connectionStore.buildConnectionSignature(connection);
      const runtimeId = getRememberedRuntimeId(storedKey);
      return sanitizeConfigForDisplay(connection, runtimeId);
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
    };
  },
};

const connectDatabaseTool = {
  name: "connect_database",
  description: "Connect to a specific database using a connection ID",
  inputSchema: {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "The stored connection identifier (numeric id, dbType, or mcp:stored:<id>)",
      },
    },
    required: ["connectionId"],
  },
  handler: async (args) => {
    const { connectionId } = args;
    if (!connectionId) {
      throw new Error("connectionId is required. Use list_connections to discover ids.");
    }

    if (connectionManager.isConnectionActive(connectionId)) {
      return {
        content: [
          {
            type: "text",
            text: MCP_MESSAGES.CONNECT_ALREADY_ACTIVE(connectionId),
          },
        ],
      };
    }

    const { match } = await resolveStoredConnection(connectionId);
    const runtimeId = await activateStoredConnection(match);

    const payload = {
      message: MCP_MESSAGES.CONNECT_SUCCESS(match),
      connectionId: runtimeId,
      storedId: match.id,
      label: connectionStore.buildConnectionSignature(match),
      dbType: match.dbType,
      host: match.host,
      port: match.port,
      database: match.database,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
};

module.exports = {
  listConnectionsTool,
  connectDatabaseTool,
  // Export helpers if needed elsewhere, but mostly internal
  ensureRuntimeConnectionId: async (reference) => {
    if (!reference) {
      throw new Error("connectionId is required");
    }

    if (connectionManager.isConnectionActive(reference)) {
      return reference;
    }

    const { match } = await resolveStoredConnection(reference);
    return activateStoredConnection(match);
  },
};
