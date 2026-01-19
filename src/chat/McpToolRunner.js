const logger = require("../utils/logger");
const { executeQueryTool, getTablesTool } = require("../mcp/tools/query");
const {
  getDatabasesTool,
  getTableInfoTool,
  switchDatabaseTool,
  analyzeQueryTool,
  getViewsTool,
  getProceduresTool,
} = require("../mcp/tools/database");
const { listConnectionsTool, connectDatabaseTool } = require("../mcp/tools/connection");

class McpToolRunner {
  constructor(options = {}) {
    this.context = options.context || {
      isAuthenticated: true,
      setAuthenticated: () => {},
    };
    this.tools = {
      list_connections: listConnectionsTool,
      connect_database: connectDatabaseTool,
      execute_query: executeQueryTool,
      get_tables: getTablesTool,
      get_databases: getDatabasesTool,
      get_table_info: getTableInfoTool,
      switch_database: switchDatabaseTool,
      analyze_query: analyzeQueryTool,
      get_views: getViewsTool,
      get_procedures: getProceduresTool,
    };
  }

  async run(toolName, args = {}) {
    const tool = this.tools[toolName];
    if (!tool || typeof tool.handler !== "function") {
      throw new Error(`MCP tool not available: ${toolName}`);
    }

    const result = await tool.handler(args, this.context);
    const parsed = this._parseResult(result);
    logger.debug("MCP tool run", { toolName });
    return parsed;
  }

  _parseResult(result) {
    const text = result?.content?.[0]?.text;
    if (!text) {
      return result;
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}

module.exports = McpToolRunner;
