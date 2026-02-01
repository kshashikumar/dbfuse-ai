// Thin entrypoint for standalone MCP usage (e.g., Claude Desktop)
require("dotenv").config({ override: true });

const { MCP_ENV_VARS } = require("../core/constants");
const logger = require("../utils/logger");

const mcpManager = require("./manager");

if (process.env[MCP_ENV_VARS.ENABLED] !== "true") {
  console.error(
    "[DBFuse MCP] MCP server is disabled via configuration. Enable MCP to expose tools to clients.",
  );
  process.exit(1);
}

mcpManager.start().catch((error) => {
  logger.error("Failed to start MCP Server:", error);
  process.exit(1);
});
