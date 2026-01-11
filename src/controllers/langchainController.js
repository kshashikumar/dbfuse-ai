const BaseController = require("./base/BaseController");
const llmService = require("../services/LLMService");
const { connectionManager } = require("../config");
const { HEADERS, HTTP_STATUS, HEADER_VARIANTS } = require("../core/constants");
const { getHeaderValue } = require("../utils/http");
const logger = require("../utils/logger");

/**
 * LangChainController - Handles AI-powered SQL query generation
 *
 * Uses LLM service to generate SQL queries from natural language prompts
 * with intelligent table selection and schema analysis
 */
class LangChainController extends BaseController {
  /**
   * Execute natural language prompt to generate SQL query
   */
  async executePrompt(req, res) {
    try {
      const { databaseName: bodyDbName, prompt, model, apiKey } = req.body;
      const dbType = this._getDbType(req);
      const connectionId = this._getConnectionId(req);

      // Validate required fields
      const validation = this.validateRequired(req.body, ["prompt"]);
      if (!validation.valid) {
        return this.sendError(res, validation.error, HTTP_STATUS.BAD_REQUEST);
      }

      if (!dbType) {
        return this.sendError(
          res,
          `Database type (${HEADERS.DB_TYPE}) must be specified in headers`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      this.logOperation("executePrompt", {
        connectionId,
        promptLength: prompt.length,
        model,
      });

      // Initialize LLM with optional custom model/apiKey
      llmService.initialize(model, apiKey);

      // Resolve strategy and current database
      const strategy = connectionManager.getConnection(connectionId);
      const info = connectionManager.getConnectionInfo(connectionId);
      const currentDb = bodyDbName || info?.currentDatabase || info?.config?.database;

      if (!currentDb) {
        return this.sendError(res, "Unable to determine target database", HTTP_STATUS.BAD_REQUEST);
      }

      // Build full catalog (names only) server-side
      let catalog = [];
      try {
        catalog = await strategy.getTables(currentDb);
      } catch (error) {
        return this.sendError(
          res,
          `Failed to fetch tables for ${currentDb}: ${error.message}`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
        );
      }

      // Detect specific table request
      const promptMatch = prompt.match(/for (\w+) table/i);
      const requestedTable = promptMatch ? promptMatch[1] : null;

      let dbMeta;

      if (requestedTable && catalog.includes(requestedTable)) {
        // Single-table: fetch its columns only
        const tableInfo = await strategy.getTableInfo(currentDb, requestedTable);
        dbMeta = [
          {
            name: currentDb,
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
              },
            ],
          },
        ];
      } else {
        // Multi-table: phase A selection, then fetch selected table schemas
        const selectedTables = await llmService.selectRelevantTables(dbType, catalog, prompt);
        const safeSelection =
          selectedTables && selectedTables.length
            ? selectedTables
            : catalog.slice(0, Math.min(12, catalog.length));

        // Fetch columns for selected tables
        const multiInfo = await strategy.getMultipleTablesInfo(currentDb, safeSelection);
        const infoByName = new Map(multiInfo.map((ti) => [ti.table_name, ti]));

        // Build dbMeta with global catalog, but only selected tables carry columns
        const tables = catalog.map((name) => {
          if (infoByName.has(name)) {
            const ti = infoByName.get(name);
            return {
              name,
              columns: (ti.columns || []).map((c) => ({
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
            };
          }
          return { name, columns: [] };
        });

        dbMeta = [
          {
            name: currentDb,
            tables,
          },
        ];
      }

      // Generate the SQL query using LLMService
      const query = await llmService.generateSQLQuery(dbMeta, currentDb, prompt, dbType);

      return this.sendSuccess(res, { query });
    } catch (error) {
      logger.error("Error in executePrompt:", {
        message: error.message,
        stack: error.stack,
        model: req.body.model,
        hasApiKey: !!req.body.apiKey,
      });
      this.handleError(res, error, "executing prompt");
    }
  }

  /**
   * Get LLM service metrics
   */
  async getMetrics(req, res) {
    try {
      const metrics = llmService.getMetrics();
      return this.sendSuccess(res, { metrics });
    } catch (error) {
      this.handleError(res, error, "fetching LLM metrics");
    }
  }

  /**
   * Reset LLM service metrics
   */
  async resetMetrics(req, res) {
    try {
      llmService.resetMetrics();
      return this.sendSuccess(res, {
        message: "LLM metrics reset successfully",
      });
    } catch (error) {
      this.handleError(res, error, "resetting metrics");
    }
  }

  /**
   * Health check for LLM service
   */
  async healthCheck(req, res) {
    try {
      const isHealthy = llmService.isHealthy();
      return this.sendSuccess(res, {
        status: isHealthy ? "healthy" : "unhealthy",
        service: "LLM",
        ...llmService.getMetrics(),
      });
    } catch (error) {
      this.handleError(res, error, "health check");
    }
  }

  /**
   * Helper to get DB type from headers
   */
  _getDbType(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.DB_TYPE);
  }

  /**
   * Helper to get connection ID from headers
   */
  _getConnectionId(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.CONNECTION_ID);
  }
}

// Export controller instance with bound methods
const controller = new LangChainController();

module.exports = {
  executePrompt: controller.executePrompt.bind(controller),
  getMetrics: controller.getMetrics.bind(controller),
  resetMetrics: controller.resetMetrics.bind(controller),
  healthCheck: controller.healthCheck.bind(controller),
};
