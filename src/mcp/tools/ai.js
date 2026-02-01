const { z } = require("zod");

const { connectionManager } = require("../../config");
const llmService = require("../../services/LLMService");

const { ensureRuntimeConnectionId } = require("./connection");

/**
 * AI-powered SQL generation tool
 * Uses LLM to convert natural language to SQL queries
 */

const generateSqlTool = {
  name: "generate_sql",
  description:
    "Generate SQL query from natural language prompt using AI. Analyzes database schema and creates optimized SQL queries. Example: 'get all customers who ordered in the last month'",
  inputSchema: z.object({
    prompt: z
      .string()
      .describe(
        "Natural language description of what you want to query. Be specific about tables, columns, and conditions.",
      ),
    dbName: z
      .string()
      .optional()
      .describe("Optional database name (uses current database if not specified)"),
    model: z
      .string()
      .optional()
      .describe("Optional AI model to use (e.g., 'gpt-4', 'gpt-3.5-turbo')"),
    connectionId: z
      .string()
      .optional()
      .describe("Optional connection ID to use (defaults to active)"),
  }),
  handler: async (args) => {
    const { prompt, dbName, model, connectionId } = args;

    if (!prompt || !prompt.trim()) {
      throw new Error("Prompt is required. Describe what SQL query you want to generate.");
    }

    const allConnections = connectionManager.getAllConnectionsInfo();
    const activeConnection = allConnections.find((conn) => conn.isActive);
    const defaultConnectionId = connectionId || activeConnection?.id || allConnections[0]?.id;

    if (!defaultConnectionId) {
      throw new Error("No database connections available. Please connect to a database first.");
    }

    const runtimeId = await ensureRuntimeConnectionId(defaultConnectionId);
    const strategy = connectionManager.getConnection(runtimeId);
    const connectionInfo = connectionManager.getConnectionInfo(runtimeId);

    const targetDatabase =
      dbName || connectionInfo?.currentDatabase || connectionInfo?.config?.database;

    if (!targetDatabase) {
      throw new Error(
        "No database specified. Please provide dbName or switch to a database first.",
      );
    }

    // Initialize LLM with optional custom model
    llmService.initialize(model);

    // Get database catalog (table names)
    let catalog = [];
    try {
      catalog = await strategy.getTables(targetDatabase);
    } catch (error) {
      throw new Error(`Failed to fetch tables for ${targetDatabase}: ${error.message}`);
    }

    if (!catalog || catalog.length === 0) {
      throw new Error(`No tables found in database ${targetDatabase}`);
    }

    // Detect if prompt mentions specific table
    const promptMatch = prompt.match(/for (\w+) table/i);
    const requestedTable = promptMatch ? promptMatch[1] : null;
    const dbType = connectionInfo?.config?.dbType || "mysql";

    let dbMeta;
    let safeSelection = [];

    if (requestedTable && catalog.includes(requestedTable)) {
      // Single table: fetch detailed schema
      const tableInfo = await strategy.getTableInfo(targetDatabase, requestedTable);
      dbMeta = [
        {
          name: targetDatabase,
          tables: [
            {
              name: requestedTable,
              columns: (tableInfo.columns || []).map((c) => ({
                column_name: c.column_name,
                data_type: c.data_type,
                is_nullable: c.is_nullable,
                default_value: c.default_value,
                extra: c.extra,
                is_primary_key: c.is_primary_key,
                length: c.length ?? c.data_length ?? null,
                precision: c.precision ?? null,
                scale: c.scale ?? null,
              })),
              indexes: tableInfo.indexes || [],
              foreign_keys: tableInfo.foreign_keys || [],
            },
          ],
        },
      ];
    } else {
      // Multiple tables: use LLM intelligent selection
      const relevantTableNames = await llmService.selectRelevantTables(dbType, catalog, prompt);
      safeSelection =
        relevantTableNames && relevantTableNames.length
          ? relevantTableNames.slice(0, Math.min(5, relevantTableNames.length))
          : catalog.slice(0, Math.min(5, catalog.length));

      // Fetch schema for selected tables
      const tableSchemas = [];
      for (const tableName of safeSelection) {
        try {
          const tableInfo = await strategy.getTableInfo(targetDatabase, tableName);
          tableSchemas.push({
            name: tableName,
            columns: (tableInfo.columns || []).map((c) => ({
              column_name: c.column_name,
              data_type: c.data_type,
              is_nullable: c.is_nullable,
              default_value: c.default_value,
              extra: c.extra,
              is_primary_key: c.is_primary_key,
              length: c.length ?? c.data_length ?? null,
              precision: c.precision ?? null,
              scale: c.scale ?? null,
            })),
            indexes: tableInfo.indexes || [],
            foreign_keys: tableInfo.foreign_keys || [],
          });
        } catch (error) {
          // Skip tables that fail to load
          console.warn(`Could not load schema for table ${tableName}: ${error.message}`);
        }
      }

      dbMeta = [
        {
          name: targetDatabase,
          tables: tableSchemas,
        },
      ];
    }

    // Generate SQL using LLM
    const query = await llmService.generateSQLQuery(
      dbMeta,
      targetDatabase,
      prompt,
      dbType,
      requestedTable ? [requestedTable] : safeSelection,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connectionId: runtimeId,
              database: targetDatabase,
              prompt,
              generatedSQL: query,
              tablesAnalyzed: dbMeta[0].tables.map((t) => t.name),
              confidence: "N/A",
            },
            null,
            2,
          ),
        },
      ],
    };
  },
};

module.exports = {
  generateSqlTool,
};
