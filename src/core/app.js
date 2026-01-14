const path = require("path");

const { HEADERS, HEADER_VARIANTS } = require("./constants");
const { SERVER_DEFAULT_PORT, PORT_RANGE, ENV_KEYS, ENV_SYNC_EXIT_DELAY_MS } = require("./env");

const STATIC_ASSET_DIRECTORY = path.resolve(__dirname, "..", "public");
const STATIC_INDEX_GZIP_PATH = path.join(STATIC_ASSET_DIRECTORY, "index.html.gz");

const DEFAULT_BODY_LIMIT = "50mb";
const DEFAULT_CORS_ORIGIN = "*";
const CORS_METHODS = Object.freeze(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
const LOCALHOST_HOSTNAME = "localhost";

const buildLocalhostBaseUrl = (port = SERVER_DEFAULT_PORT) =>
  `http://${LOCALHOST_HOSTNAME}:${port}`;

const buildAllowedHeaders = () => {
  const baseHeaders = ["Content-Type", "Authorization"];
  const dbTypeVariants = HEADER_VARIANTS.DB_TYPE;
  const connectionIdVariants = HEADER_VARIANTS.CONNECTION_ID;
  return Array.from(new Set([...baseHeaders, ...dbTypeVariants, ...connectionIdVariants]));
};

const CORS_ALLOWED_HEADERS = buildAllowedHeaders();

const SERVER_LOG_MESSAGES = Object.freeze({
  STARTUP_URL: (port) => `Access DBFuse AI at ${buildLocalhostBaseUrl(port)}`,
  PORT_CHANGE_RESTART: (current, next) =>
    `Port changed from ${current} to ${next}. Restarting server...`,
  ENV_PORT_CHANGE_DETECTED: "Detected PORT change in .env. Restarting to apply new port...",
});

const resolveBodyLimit = () => process.env[ENV_KEYS.BODY_SIZE] || DEFAULT_BODY_LIMIT;

const CORS_OPTIONS = Object.freeze({
  origin: process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN,
  methods: CORS_METHODS,
  allowedHeaders: CORS_ALLOWED_HEADERS,
  credentials: true,
});

const SERVER_CONSTANTS = Object.freeze({
  DEFAULT_PORT: SERVER_DEFAULT_PORT,
  PORT_RANGE,
  BODY_LIMIT_DEFAULT: DEFAULT_BODY_LIMIT,
  ENV_EXIT_DELAY_MS: ENV_SYNC_EXIT_DELAY_MS,
});

const API_BASE = "/api";

const ROUTE_PATHS = Object.freeze({
  ROOT: API_BASE,
  AUTH: `${API_BASE}/auth`,
  AUTH_LOGIN: `${API_BASE}/auth/login`,
  AUTH_LOGOUT: `${API_BASE}/auth/logout`,
  AUTH_STATUS: `${API_BASE}/auth/isAuthenticated`,
  SQL: `${API_BASE}/sql`,
  SQL_HEALTH: `${API_BASE}/sql/health`,
  CONNECTIONS: `${API_BASE}/connections`,
  OPENAI: `${API_BASE}/openai`,
  CONFIG: `${API_BASE}/config`,
});

const ROUTES_WITH_AUTH_BYPASS = Object.freeze([
  ROUTE_PATHS.AUTH_LOGIN,
  ROUTE_PATHS.AUTH_LOGOUT,
  ROUTE_PATHS.AUTH_STATUS,
]);

module.exports = {
  STATIC_ASSET_DIRECTORY,
  STATIC_INDEX_GZIP_PATH,
  DEFAULT_BODY_LIMIT,
  DEFAULT_CORS_ORIGIN,
  CORS_METHODS,
  CORS_ALLOWED_HEADERS,
  CORS_OPTIONS,
  SERVER_LOG_MESSAGES,
  SERVER_CONSTANTS,
  resolveBodyLimit,
  LOCALHOST_HOSTNAME,
  buildLocalhostBaseUrl,
  API_BASE,
  ROUTE_PATHS,
  ROUTES_WITH_AUTH_BYPASS,
};
