const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");

const logger = require("../utils/logger");

const loginTool = require("./tools/login");
const { listConnectionsTool, connectDatabaseTool } = require("./tools/connection");
const { executeQueryTool, getTablesTool } = require("./tools/query");
const {
  getDatabasesTool,
  getTableInfoTool,
  switchDatabaseTool,
  analyzeQueryTool,
  getViewsTool,
  getProceduresTool,
} = require("./tools/database");
const { generateSqlTool } = require("./tools/ai");

class McpManager {
  constructor() {
    this.server = new McpServer(
      {
        name: "dbfuse-ai-mcp",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
    this.isAuthenticated = false;
    this.authEnabled = !!process.env.DBFUSE_USERNAME;
    this.transport = null;
    this.isRunning = false;
    this.toolsRegistered = false;

    this.server.onclose = () => {
      this.transport = null;
      this.isRunning = false;
      logger.info("MCP Server stopped");
    };

    this.server.onerror = (error) => {
      logger.error("MCP Server error:", error);
    };
  }

  setAuthenticated(value) {
    this.isAuthenticated = value;
  }

  registerTools() {
    if (this.toolsRegistered) {
      return;
    }

    const tools = [
      loginTool,
      listConnectionsTool,
      connectDatabaseTool,
      executeQueryTool,
      getTablesTool,
      getDatabasesTool,
      getTableInfoTool,
      switchDatabaseTool,
      analyzeQueryTool,
      getViewsTool,
      getProceduresTool,
      generateSqlTool,
    ];

    tools.forEach((tool) => {
      this.server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (args) => {
          // Auth check
          if (this.authEnabled && !this.isAuthenticated && tool.name !== "login") {
            throw new Error("Authentication required. Please use the 'login' tool first.");
          }

          // Pass context to handler
          const context = {
            isAuthenticated: this.isAuthenticated,
            setAuthenticated: this.setAuthenticated.bind(this),
          };

          return await tool.handler(args, context);
        },
      );
    });

    this.toolsRegistered = true;
  }

  async start() {
    try {
      if (this.isRunning) {
        logger.info("MCP Server already running");
        return;
      }

      this.registerTools();
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);
      this.isRunning = true;
      logger.info("MCP Server running on stdio");
    } catch (error) {
      logger.error("Failed to start MCP Server:", error);
      this.transport = null;
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      logger.info("MCP Server stop requested but server is not running");
      return;
    }

    try {
      await this.server.close();
    } catch (error) {
      logger.error("Failed to stop MCP Server:", error);
      throw error;
    } finally {
      this.transport = null;
      this.isRunning = false;
    }
  }
}

module.exports = new McpManager();
