const express = require("express");
const cors = require("cors");
const gZipper = require("connect-gzip-static");
const bodyParser = require("body-parser");

// Load .env with override to ensure we pick up changes even if parent process set env vars
require("dotenv").config({ override: true });

const authMiddleware = require("./middleware/authentication");
const dbRouter = require("./routes/dbRoutes");
const langchainRouter = require("./routes/langchainRoutes");
const authRouter = require("./routes/authRoutes");
const connectionRouter = require("./routes/connectionRoutes");
const configRouter = require("./routes/configRoutes");
const logger = require("./utils/logger");
const {
  CORS_OPTIONS,
  STATIC_ASSET_DIRECTORY,
  STATIC_INDEX_GZIP_PATH,
  resolveBodyLimit,
  SERVER_LOG_MESSAGES,
  SERVER_CONSTANTS,
  ROUTE_PATHS,
} = require("./core/app");
const { GENERAL_ERRORS } = require("./core/constants");
// Start live .env sync so manual edits take effect without a restart (except port changes)
try {
  const { startEnvSync } = require("./utils/envWatcher");
  startEnvSync({
    onPortChange: () => {
      logger.info(SERVER_LOG_MESSAGES.ENV_PORT_CHANGE_DETECTED);
      setTimeout(() => process.exit(0), SERVER_CONSTANTS.ENV_EXIT_DELAY_MS);
    },
  });
} catch (e) {
  logger.warn("envWatcher not initialized:", e?.message || e);
}
const app = express();

app.use(cors(CORS_OPTIONS));

// Serve pre-compressed assets first (gz), then fall back to normal static if needed
app.use(gZipper(STATIC_ASSET_DIRECTORY));
app.use(express.static(STATIC_ASSET_DIRECTORY));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: resolveBodyLimit() }));
// Serve SPA index (gzipped) at root
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Encoding", "gzip");
  return res.sendFile(STATIC_INDEX_GZIP_PATH);
});

app.use(authMiddleware.authentication);

app.use(ROUTE_PATHS.AUTH, authRouter);
app.use(ROUTE_PATHS.SQL, dbRouter);
app.use(ROUTE_PATHS.CONNECTIONS, connectionRouter);
app.use(ROUTE_PATHS.OPENAI, langchainRouter);
app.use(ROUTE_PATHS.CONFIG, configRouter);

// Respect PORT when provided, including 0 (ephemeral). Fallback only when unset or invalid.
// Respect PORT when provided, including 0 (ephemeral). Fallback only when unset or invalid.
let port = SERVER_CONSTANTS.DEFAULT_PORT;
if (process.env.PORT !== undefined) {
  const parsed = Number(process.env.PORT);
  if (!Number.isNaN(parsed)) {
    port = parsed;
  }
}

// Check for MCP Mode
const isMcpEnabled = process.env.MCP_ENABLED === "true";
let server;

if (isMcpEnabled) {
  const mcpManager = require("./mcp/manager");
  mcpManager.start().catch((err) => {
    logger.error("Failed to start MCP Manager:", err);
    process.exit(1);
  });
} else {
  server = app.listen(port, () => {
    const actualPort = server.address().port;
    logger.info(SERVER_LOG_MESSAGES.STARTUP_URL(actualPort));
  });
}

// error handler
app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  const error = {
    errmsg: err?.errmsg || err?.message || GENERAL_ERRORS.INTERNAL_SERVER_ERROR,
    name: err?.name || "Error",
  };
  return res.status(500).send(error);
});

module.exports = { app, server };
