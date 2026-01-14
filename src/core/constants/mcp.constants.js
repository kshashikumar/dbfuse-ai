/**
 * @fileoverview Model Context Protocol (MCP) constants
 * Contains MCP-specific configuration and message templates
 */

const MCP_CONSTANTS = Object.freeze({
  STORED_CONNECTION_PREFIX: "mcp:stored:",
  DEFAULT_LOG_LEVEL: "error",
});

const MCP_ENV_VARS = Object.freeze({
  ENABLED: "MCP_ENABLED",
  LOG_LEVEL: "LOG_LEVEL",
  USERNAME: "DBFUSE_USERNAME",
  PASSWORD: "DBFUSE_PASSWORD",
  CONFIG_DIR: "DBFUSE_CONFIG_DIR",
});

const MCP_MESSAGES = Object.freeze({
  CONNECT_SUCCESS: ({ dbType, host, port, database }) =>
    `Connected to ${dbType} ${host ? `${host}:${port}` : database}`,
  CONNECT_ALREADY_ACTIVE: (connectionId) =>
    `Connection '${connectionId}' is already active and ready to use.`,
  CONNECTION_NOT_FOUND: (ref) =>
    `No stored connection matched '${ref}'. Use list_connections to see available ids and provide the numeric id or full signature (e.g. dbType:host:port:database).`,
  AMBIGUOUS_REFERENCE: (ref) =>
    `Multiple connections matched '${ref}'. Please use the numeric id shown by list_connections.`,
});

module.exports = {
  MCP_CONSTANTS,
  MCP_ENV_VARS,
  MCP_MESSAGES,
};
