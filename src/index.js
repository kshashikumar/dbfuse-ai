const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const compression = require("compression");

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
app.use(compression());

const hasStaticAssets = fs.existsSync(STATIC_ASSET_DIRECTORY);
const indexHtmlPath = path.join(STATIC_ASSET_DIRECTORY, "index.html");

const serveIndexOr503 = (res) => {
  if (!hasStaticAssets) {
    return res.status(503).send({
      errmsg:
        "Web UI is not available because the static client build is missing. " +
        "Build the client and copy it to src/public.",
      name: "StaticClientMissing",
    });
  }

  if (!fs.existsSync(indexHtmlPath)) {
    return res.status(503).send({
      errmsg:
        "Web UI entrypoint (index.html) not found in static client directory. " +
        "Rebuild the client and copy it to src/public.",
      name: "StaticClientIndexMissing",
    });
  }

  return res.sendFile(indexHtmlPath);
};

if (hasStaticAssets) {
  app.use(express.static(STATIC_ASSET_DIRECTORY));
} else {
  logger.warn(
    `Static client directory not found at ${STATIC_ASSET_DIRECTORY}. ` +
      "Run the client build (e.g. `cd client/dbfuse-ai-client && npm run clean-build-compress`) to generate it.",
  );
}
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: resolveBodyLimit() }));

// Serve SPA index for any non-API route so deep links work without hash routing
app.get("*", (req, res, next) => {
  if (req.path.startsWith(ROUTE_PATHS.ROOT)) {
    return next();
  }

  return serveIndexOr503(res);
});

app.use(authMiddleware.authentication);

app.use(ROUTE_PATHS.AUTH, authRouter);
app.use(ROUTE_PATHS.SQL, dbRouter);
app.use(ROUTE_PATHS.CONNECTIONS, connectionRouter);
app.use(ROUTE_PATHS.OPENAI, langchainRouter);
app.use(ROUTE_PATHS.CONFIG, configRouter);
// Respect PORT when provided, including 0 (ephemeral). Fallback only when unset or invalid.
let port = SERVER_CONSTANTS.DEFAULT_PORT;
if (process.env.PORT !== undefined) {
  const parsed = Number(process.env.PORT);
  if (!Number.isNaN(parsed)) {
    port = parsed;
  }
}

// MCP_ONLY=true runs only MCP server (for Claude Desktop only)
// Default: runs both HTTP (Web UI) and MCP servers
const mcpOnly = process.env.MCP_ONLY === "true";
let server;

// Always start MCP server
const mcpManager = require("./mcp/manager");
mcpManager.start().catch((err) => {
  logger.error("Failed to start MCP Manager:", err);
  process.exit(1);
});

// Start HTTP server unless MCP_ONLY mode
if (!mcpOnly) {
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
