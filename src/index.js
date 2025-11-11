const express = require("express");
const cors = require("cors");
const argv = require("minimist")(process.argv.slice(2));
const gZipper = require("connect-gzip-static");
const bodyParser = require("body-parser");
const path = require("path");

const authMiddleware = require("./middleware/authentication");
const dbRouter = require("./routes/dbRoutes");
const langchainRouter = require("./routes/langchainRoutes");
const authRouter = require("./routes/authRoutes");
const connectionRouter = require("./routes/connectionRoutes");
const configRouter = require("./routes/configRoutes");

const logger = require("./utils/logger");
// Start live .env sync so manual edits take effect without a restart (except port changes)
try {
  const { startEnvSync } = require("./utils/envWatcher");
  startEnvSync({
    onPortChange: () => {
      logger.info("Detected PORT change in .env. Restarting to apply new port...");
      setTimeout(() => process.exit(0), 200);
    },
  });
} catch (e) {
  logger.warn("envWatcher not initialized:", e?.message || e);
}
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-DB-Type",
      "X-Db-Type",
      "x-db-type",
      "x-connection-id",
      "X-Connection-Id",
    ],
    credentials: true,
  }),
);

// Serve pre-compressed assets first (gz), then fall back to normal static if needed
const staticDir = path.join(__dirname, "public", "dbfuse-ai-client");
app.use(gZipper(staticDir));
app.use(express.static(staticDir));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: process.env.BODY_SIZE || "50mb" }));
// Serve SPA index (gzipped) at root
app.get("/", (req, res) => {
  const gzIndex = path.join(staticDir, "index.html.gz");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Encoding", "gzip");
  return res.sendFile(gzIndex);
});

app.use(authMiddleware.authentication);

app.use("/api/auth", authRouter);
app.use("/api/sql", dbRouter);
app.use("/api/connections", connectionRouter);
app.use("/api/openai", langchainRouter);
app.use("/api/config", configRouter);

// Respect PORT when provided, including 0 (ephemeral). Fallback to 5000 only when unset or invalid.
let port = 5000;
if (process.env.PORT !== undefined) {
  const parsed = Number(process.env.PORT);
  if (!Number.isNaN(parsed)) {
    port = parsed;
  }
}
const server = app.listen(port, () => {
  const actualPort = server.address().port;
  logger.info(`Access DBFuse AI at http://localhost:${actualPort}`);
});

// error handler
app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  const error = {
    errmsg: err?.errmsg || err?.message || "Internal Server Error",
    name: err?.name || "Error",
  };
  return res.status(500).send(error);
});

module.exports = { app, server };
