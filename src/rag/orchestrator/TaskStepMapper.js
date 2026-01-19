const MCP_TOOL_MAP = Object.freeze({
  generate_sql: "generate_sql",
  query: "execute_query",
  execute_query: "execute_query",
  get_tables: "get_tables",
  get_databases: "get_databases",
  get_table_info: "get_table_info",
  switch_database: "switch_database",
  analyze_query: "analyze_query",
});

const resolveMcpTool = (operation) => {
  if (!operation || typeof operation !== "string") {
    return null;
  }
  const key = operation.toLowerCase();
  return MCP_TOOL_MAP[key] || null;
};

const buildMcpInvocation = (operation, args = {}) => {
  const tool = resolveMcpTool(operation);
  if (!tool) return null;
  return {
    tool,
    args,
  };
};

module.exports = {
  resolveMcpTool,
  buildMcpInvocation,
};
