/* eslint-disable import/order */
const fs = require("fs");
const path = require("path");

const bodyParser = require("body-parser");
const compression = require("compression");
const cors = require("cors");
const express = require("express");

const { loadEnv } = require("./utils/loadEnv");
loadEnv({ override: true });
const authMiddleware = require("./middleware/authentication");
const dbRouter = require("./routes/dbRoutes");
const ragRouter = require("./routes/ragRoutes");
const chatRouter = require("./routes/chatRoutes");
const authRouter = require("./routes/authRoutes");
const connectionRouter = require("./routes/connectionRoutes");
const configRouter = require("./routes/configRoutes");
const queryRangeRouter = require("./routes/queryRangeRoutes");
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
/* eslint-enable import/order */
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
app.use(ROUTE_PATHS.DB, dbRouter);
app.use(ROUTE_PATHS.CONNECTIONS, connectionRouter);
app.use(ROUTE_PATHS.RAG, ragRouter);
app.use(ROUTE_PATHS.CHAT, chatRouter);
app.use(ROUTE_PATHS.CONFIG, configRouter);
app.use(`${ROUTE_PATHS.ROOT}/query`, queryRangeRouter);
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
  try {
    const { initializeChatGateway } = require("./chat/ChatGateway");
    initializeChatGateway(server);
  } catch (error) {
    logger.error("Failed to initialize chat gateway:", error);
  }
}

// error handler
app.use((err, req, res, _next) => {
  logger.error("Unhandled error:", err);
  const error = {
    errmsg: err?.errmsg || err?.message || GENERAL_ERRORS.INTERNAL_SERVER_ERROR,
    name: err?.name || "Error",
  };
  return res.status(500).send(error);
});

module.exports = { app, server };
