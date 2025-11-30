const { ENV_KEYS, PORT_RANGE, PROVIDER_API_ENV_KEYS } = require("./env");

const buildHeaderVariants = (headerName) => {
  const lower = headerName.toLowerCase();
  const upper = headerName.toUpperCase();
  const title = headerName
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join("-");
  return Array.from(new Set([lower, upper, title]));
};

const DB_TYPES = {
  MYSQL: "mysql2",
  POSTGRESQL: "pg",
  SQLITE: "sqlite3",
  MSSQL: "mssql",
  ORACLE: "oracledb",
  MONGODB: "mongodb",
  REDIS: "redis",
};

const QUERY_TYPES = {
  SELECT: [/^SELECT\s/i],
  INSERT: [/^INSERT\s/i],
  UPDATE: [/^UPDATE\s/i],
  DELETE: [/^DELETE\s/i],
  CREATE: [/^CREATE\s/i],
  DROP: [/^DROP\s/i],
  ALTER: [/^ALTER\s/i],
  TRUNCATE: [/^TRUNCATE\s/i],
  SHOW: [/^SHOW\s/i],
  DESCRIBE: [/^DESCRIBE\s/i, /^DESC\s/i],
  EXPLAIN: [/^EXPLAIN\s/i],
  GRANT: [/^GRANT\s/i],
  REVOKE: [/^REVOKE\s/i],
  TRANSACTION: [/^BEGIN\s/i, /^START\s/i, /^COMMIT\s/i, /^ROLLBACK\s/i],
  USE: [/^USE\s/i],
  SET: [/^SET\s/i],
  CALL: [/^CALL\s/i],
  EXECUTE: [/^EXEC\s/i, /^EXECUTE\s/i],
  WITH: [/^WITH\s/i],
  MERGE: [/^MERGE\s/i],
  UPSERT: [/^UPSERT\s/i],
  COPY: [/^COPY\s/i],
  BULK: [/^BULK\s/i],
  LOAD: [/^LOAD\s/i],
  IMPORT: [/^IMPORT\s/i],
  EXPORT: [/^EXPORT\s/i],
};

const ERROR_MESSAGES = {
  CONNECTION_NOT_INITIALIZED: "Database connection not initialized",
  INVALID_DB_TYPE: (type, supported) =>
    `Unsupported database type: ${type}. Supported types: ${supported.join(", ")}`,
  STRATEGY_NOT_SET: "Strategy not set. Call setStrategy first.",
  NO_ACTIVE_CONNECTION: "No active database connection. Call connect first.",
  NOT_IMPLEMENTED: (method) => `${method}() must be implemented`,
  INVALID_QUERY: "Invalid or malformed query",
  PERMISSION_DENIED: "Insufficient permissions for this operation",
  CONNECTION_TIMEOUT: "Database connection timeout",
  QUERY_TIMEOUT: "Query execution timeout",
  INVALID_PAGINATION: "Invalid pagination parameters",
  DATABASE_SWITCH_FAILED: (dbName) => `Failed to switch to database: ${dbName}`,
  TABLE_NOT_FOUND: (tableName) => `Table not found: ${tableName}`,
  SQLITE_NO_SWITCH: "SQLite does not support switching databases",
};

const DEFAULT_CONFIG = {
  PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 1000,
  CONNECTION_TIMEOUT: 60000,
  QUERY_TIMEOUT: 30000,
  POOL_SIZE: 10,
  POOL_MIN: 2,
  IDLE_TIMEOUT: 30000,
};

const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

const HEADERS = {
  DB_TYPE: "x-db-type",
  CONNECTION_ID: "x-connection-id",
  CONTENT_TYPE: "application/json",
  AUTHORIZATION: "authorization",
  WWW_AUTHENTICATE: "www-authenticate",
};

const HEADER_VARIANTS = {
  DB_TYPE: buildHeaderVariants("x-db-type"),
  CONNECTION_ID: buildHeaderVariants("x-connection-id"),
};

const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
  SWITCHING: "switching",
};

const DB_DEFAULTS = {
  HOST: "localhost",
  PORT: {
    MYSQL: 3306,
    POSTGRESQL: 5432,
    SQLITE: null,
    MSSQL: 1433,
    ORACLE: 1521,
    MONGODB: 27017,
    REDIS: 6379,
  },
  USER: "root",
  CHARSET: "UTF8_GENERAL_CI",
  TIMEZONE: "local",
};

const ENCODING = Object.freeze({
  UTF8: "utf8",
  ASCII: "ascii",
  BASE64: "base64",
});

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const FALLBACK_AI_MODEL = "gpt-4";
const PERPLEXITY_API_BASE_URL = "https://api.perplexity.ai";

const AI_MODELS = Object.freeze({
  OPENAI: {
    models: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4o"],
    provider: "OpenAI",
  },
  GEMINI: {
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    provider: "Gemini",
  },
  ANTHROPIC: {
    models: [
      "claude-opus-4-1",
      "claude-opus-4",
      "claude-sonnet-4",
      "claude-3-7-sonnet",
      "claude-3-5-haiku",
    ],
    provider: "Anthropic",
  },
  MISTRAL: {
    models: ["mistral-medium-2508", "mistral-large-2411", "mistral-small-2407", "codestral-2508"],
    provider: "Mistral",
  },
  COHERE: {
    models: [
      "command-a-03-2025",
      "command-a-reasoning-08-2025",
      "command-a-vision-07-2025",
      "command-r7b-12-2024",
    ],
    provider: "Cohere",
  },
  HUGGINGFACE: {
    models: [
      "microsoft/DialoGPT-medium",
      "facebook/blenderbot-400M-distill",
      "microsoft/DialoGPT-large",
    ],
    provider: "HuggingFace",
  },
  PERPLEXITY: {
    models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
    provider: "Perplexity",
  },
});

const PROVIDER_API_KEYS = Object.freeze({ ...PROVIDER_API_ENV_KEYS });

const BASIC_AUTH_SCHEME = "Basic ";
const AUTH_REALM = "user_pages";
const BASIC_TOKEN_RESPONSE_KEY = "basicToken";
const AUTH_STATE_KEY = "authenticated";

const AUTH_MESSAGES = Object.freeze({
  MISSING_CREDENTIALS: "Username and password are required",
  INVALID_CREDENTIALS: "Invalid username or password",
  LOGOUT_SUCCESS: "Logged out successfully",
  AUTH_REQUIRED: "Authentication required!",
});

const CONFIG_MESSAGES = Object.freeze({
  LOAD_ERROR: "Failed to load configuration",
  SAVE_ERROR: "Failed to save configuration",
  SAVE_SUCCESS: "Configuration saved successfully",
  SAVE_SUCCESS_PORT_CHANGE:
    "Configuration saved successfully. Server will restart to apply port changes...",
  USERNAME_REQUIRED: "Database username is required",
  PORT_RANGE_INVALID: `Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}`,
});

const GENERAL_ERRORS = Object.freeze({
  INTERNAL_SERVER_ERROR: "Internal Server Error",
});

const MCP_CONSTANTS = Object.freeze({
  STORED_CONNECTION_PREFIX: "mcp:stored:",
  DEFAULT_LOG_LEVEL: "error",
});

const MCP_ENV_VARS = Object.freeze({
  LOG_LEVEL: "LOG_LEVEL",
  USERNAME: ENV_KEYS.USERNAME,
  PASSWORD: ENV_KEYS.PASSWORD,
  ENABLED: ENV_KEYS.MCP_ENABLED,
  CONFIG_DIR: ENV_KEYS.CONFIG_DIR,
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

const SCHEMA_PROMPT_BUDGET_CHARS = 4000;

module.exports = {
  DB_TYPES,
  QUERY_TYPES,
  ERROR_MESSAGES,
  DEFAULT_CONFIG,
  HTTP_STATUS,
  HEADERS,
  HEADER_VARIANTS,
  CONNECTION_STATES,
  DB_DEFAULTS,
  DEFAULT_MODEL_TEMPERATURE,
  FALLBACK_AI_MODEL,
  PERPLEXITY_API_BASE_URL,
  AI_MODELS,
  PROVIDER_API_KEYS,
  BASIC_AUTH_SCHEME,
  AUTH_REALM,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  AUTH_MESSAGES,
  CONFIG_MESSAGES,
  GENERAL_ERRORS,
  MCP_CONSTANTS,
  MCP_ENV_VARS,
  MCP_MESSAGES,
  SCHEMA_PROMPT_BUDGET_CHARS,
  ENCODING,
};
