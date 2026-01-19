const { getAIModel } = require("../models/model");
const logger = require("../utils/logger");
const { FALLBACK_AI_MODEL, SCHEMA_PROMPT_BUDGET_CHARS } = require("../core/constants");
const { buildTableCatalog, buildSchemaDSL } = require("../utils/schemaCompressor");
const { inferProviderFromModel, PROVIDER_API_ENV_KEYS } = require("../core/env");

const argv = require("minimist")(process.argv.slice(2));
const DEFAULT_LLM_REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 30000;
const DEFAULT_TABLE_SELECT_TIMEOUT_MS =
  Number(process.env.LLM_TABLE_SELECT_TIMEOUT_MS) ||
  Math.min(DEFAULT_LLM_REQUEST_TIMEOUT_MS, 15000);

/**
 * LLMService - Singleton service for Language Model operations
 *
 * Manages LLM initialization, prompt templates, and SQL query generation
 * with intelligent table selection and schema compression
 */
class LLMService {
  constructor() {
    if (LLMService.instance) {
      return LLMService.instance;
    }

    this.llm = null;
    this.config = {
      model: null,
      modelKey: null,
      apiKey: null,
    };
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      tableSelectorCalls: 0,
      sqlGenerationCalls: 0,
    };
    this.lastResponseTimes = [];
    this.BUDGET_CHARS = SCHEMA_PROMPT_BUDGET_CHARS;
    this.requestTimeoutMs = DEFAULT_LLM_REQUEST_TIMEOUT_MS;
    this.tableSelectTimeoutMs = DEFAULT_TABLE_SELECT_TIMEOUT_MS;

    LLMService.instance = this;
  }

  /**
   * Initialize or reinitialize the LLM with given configuration
   */
  initialize(model, apiKey) {
    const aiModel = String(
      model || argv.model || process.env.AI_MODEL || FALLBACK_AI_MODEL || "",
    ).trim();
    const modelKey = aiModel.toLowerCase();

    let key = apiKey || argv.apikey || null;
    if (!key) {
      const provider = inferProviderFromModel(aiModel);
      const providerEnvKey = PROVIDER_API_ENV_KEYS[provider];
      key = providerEnvKey ? process.env[providerEnvKey] : null;
      // Fallback to generic AI_API_KEY if provider-specific key not found
      if (!key) {
        key = process.env.AI_API_KEY || null;
      }
    }

    // Only reinitialize if config changed
    if (this.config.modelKey !== modelKey || this.config.apiKey !== key) {
      this.config.model = aiModel;
      this.config.modelKey = modelKey;
      this.config.apiKey = key;

      try {
        this.llm = getAIModel(aiModel, key);
        const provider = inferProviderFromModel(aiModel);
        logger.info(`LLM initialized with model: ${aiModel}, provider: ${provider}`);
      } catch (error) {
        logger.error("Failed to initialize LLM:", {
          model: aiModel,
          provider: inferProviderFromModel(aiModel),
          hasApiKey: !!key,
          error: error.message,
        });
        throw new Error(`Failed to initialize AI model ${aiModel}: ${error.message}`);
      }
    }

    return this.llm;
  }

  /**
   * Get current LLM instance (initialize with defaults if needed)
   */
  getLLM() {
    if (!this.llm) {
      this.initialize();
    }
    return this.llm;
  }

  /**
   * Select relevant tables for a query using LLM intelligence
   *
   * @param {string} dbType - Database type (mysql, postgresql, etc.)
   * @param {Array<string>} catalog - Full list of available table names
   * @param {string} userPrompt - User's natural language query
   * @returns {Promise<Array<string>>} - List of relevant table names
   */
  async selectRelevantTables(dbType, catalog, userPrompt) {
    this.metrics.tableSelectorCalls++;
    const startTime = Date.now();

    const selectorSystem = `You are a planner for SQL generation on ${dbType}. Your job is ONLY to choose which tables are relevant for the user's request.
Return STRICT JSON with the schema: {"tables":["table1","table2",...]} and nothing else. Do not include explanations.`;

    const selectorUser = `Tables catalog (names only): ${catalog.join(", ")}
User request: ${userPrompt}
Respond with only JSON: {"tables":[...]} (names must come from the catalog).`;

    try {
      const sel = await this.callWithTimeout(
        [
          { role: "system", content: selectorSystem },
          { role: "user", content: selectorUser },
        ],
        this.tableSelectTimeoutMs,
        "Table selection timed out.",
      );

      const text = this._extractResponseText(sel).trim();

      // Parse strict JSON with fallback
      let jsonText = text;
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        jsonText = text.substring(start, end + 1);
      }

      const parsed = JSON.parse(jsonText);
      const arr = Array.isArray(parsed?.tables) ? parsed.tables : [];
      const filtered = arr.filter((t) => catalog.includes(t));

      this._recordResponseTime(Date.now() - startTime);
      logger.debug(`Selected tables: ${filtered.join(", ")}`);

      return filtered;
    } catch (error) {
      logger.warn(`Table selection fallback: ${error.message}`, {
        model: this.config.model,
        provider: require("../core/env").inferProviderFromModel(this.config.model || ""),
        catalogSize: catalog.length,
        errorDetails: error.stack,
      });

      // Fallback: heuristic matching from user prompt
      const p = String(userPrompt || "").toLowerCase();
      const guessed = catalog.filter((t) => p.includes(String(t).toLowerCase()));

      this._recordResponseTime(Date.now() - startTime);
      return guessed.length ? guessed : catalog.slice(0, Math.min(12, catalog.length));
    }
  }

  /**
   * Build system prompt for single table SQL generation
   */
  _buildSingleTablePrompt(dbType, databaseName, tableName, tableColumns, userPrompt) {
    return `
You are an AI expert in generating ${dbType} SQL queries. You must generate a single-line SQL query based on the user's request, using the provided schema. Follow these rules strictly:
- Output only the SQL query as plain text, with no explanations, comments, quotes, or additional text.
- Ensure the query is valid for ${dbType}, using correct syntax (e.g., no double quotes for identifiers unless required by ${dbType}).
- Use table aliases for joins and subqueries to avoid ambiguity.
- Avoid duplicate column names by using unique aliases with AS.
- Handle joins, subqueries, conditional logic, nulls, and aggregation as needed.
- Ensure the query can be used as a subquery for paginated results, with uniquely named columns.
- Do not include line breaks or formatting; the query must be a single line.

Database Schema:
Database Type: ${dbType}
Database: ${databaseName}
Table: ${tableName}
Columns: ${tableColumns}

Example:
Database: test
Table: employees
Columns: id, name, age, position
Prompt: Select all employees whose age is greater than 30
Output: SELECT id AS emp_id, name AS emp_name, age, position FROM employees WHERE age > 30

User Request: ${userPrompt}
Output only the SQL query.
`;
  }

  /**
   * Build system prompt for multi-table SQL generation
   */
  _buildMultiTablePrompt(dbType, databaseName, catalog, schemaDSL, userPrompt) {
    const catalogLine = `Tables: ${catalog.join(", ")}`;

    return `
You are an AI expert in generating ${dbType} SQL queries. You must generate a single-line SQL query based on the user's request, using the provided schema. Follow these rules strictly:
- Output only the SQL query as plain text, with no explanations, comments, quotes, or additional text.
- Ensure the query is valid for ${dbType}, using correct syntax (e.g., no double quotes for identifiers unless required by ${dbType}).
- Use table aliases for joins and subqueries to avoid ambiguity.
- Avoid duplicate column names by using unique aliases with AS.
- Handle joins, subqueries, conditional logic, nulls, and aggregation as needed.
- Ensure the query can be used as a subquery for paginated results, with uniquely named columns.
- Do not include line breaks or formatting; the query must be a single line.
- Only use tables and columns from the provided catalog and schema DSL. Do not invent tables or columns. If something seems missing, prefer simpler queries using available columns.

Database Schema:
Database Type: ${dbType}
Database: ${databaseName}
${catalogLine}
Schema DSL:
${schemaDSL}

Example DSL and usage:
Tables: employees, departments
T employees: id INT [PK], name VARCHAR(100) [NN], dept_id INT
T departments: dept_id INT [PK], dept_name VARCHAR(100) [NN]
Example user request: Join employees and departments to get employee names and department names
Example output: SELECT e.id AS emp_id, e.name AS emp_name, d.dept_name AS dept_name FROM employees e JOIN departments d ON e.dept_id = d.dept_id

User Request: ${userPrompt}
Output only the SQL query.
`;
  }

  /**
   * Format table columns into compact display string
   */
  _formatTableColumns(columns) {
    return columns
      .map((col) => {
        const name = col.column_name;
        const type = col.data_type ? String(col.data_type).toUpperCase() : undefined;
        const len = col.length ?? col.data_length ?? null;
        const prec = col.precision ?? null;
        const scale = col.scale ?? null;

        let typeStr = type || "";
        if (prec != null && scale != null) typeStr += `(${prec},${scale})`;
        else if (len != null) typeStr += `(${len})`;

        const flags = [];
        if (col.is_primary_key) flags.push("PK");
        if (col.is_nullable === false) flags.push("NN");
        const flagStr = flags.length ? ` [${flags.join(",")}]` : "";

        return typeStr ? `${name} ${typeStr}${flagStr}` : `${name}${flagStr}`;
      })
      .join(", ");
  }

  /**
   * Extract text content from LLM response across providers
   */
  _extractResponseText(response) {
    if (!response) return "";
    if (typeof response.text === "string") return response.text;
    if (typeof response.content === "string") return response.content;
    if (Array.isArray(response.content)) {
      return response.content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("");
    }
    return String(response.content ?? "");
  }

  extractResponseText(response) {
    return this._extractResponseText(response);
  }

  async callWithTimeout(messages, timeoutMs = this.requestTimeoutMs, errorMessage) {
    const llm = this.getLLM();
    return this._withTimeout(
      llm.call(messages),
      timeoutMs,
      errorMessage || "LLM request timed out.",
    );
  }

  /**
   * Clean and validate generated SQL query
   */
  _cleanQuery(rawQuery) {
    let cleaned = String(rawQuery || "").trim();
    if (
      (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
      (cleaned.startsWith('"') && cleaned.endsWith('"'))
    ) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned
      .replace(/\s+/g, " ") // Replace multiple spaces/newlines with single space
      .replace(/;{2,}/g, ";") // Ensure only one semicolon
      .replace(/[\r\n]+/g, ""); // Remove line breaks

    if (!cleaned) {
      throw new Error("Generated query is empty or invalid.");
    }

    return cleaned;
  }

  _withTimeout(promise, timeoutMs, errorMessage) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return promise;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(errorMessage));
      }, timeoutMs);

      promise
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Generate SQL query from natural language prompt
   *
   * @param {Object} dbMeta - Database metadata with tables and columns
   * @param {string} databaseName - Target database name
   * @param {string} prompt - User's natural language query
   * @param {string} dbType - Database type (mysql, postgresql, etc.)
   * @returns {Promise<string>} - Generated SQL query
   */
  async generateSQLQuery(dbMeta, databaseName, prompt, dbType, selectedTables) {
    this.metrics.totalRequests++;
    this.metrics.sqlGenerationCalls++;
    const startTime = Date.now();

    try {
      const selectedDatabase = dbMeta.find((db) => db.name === databaseName);
      if (!selectedDatabase) {
        throw new Error(`Database "${databaseName}" not found.`);
      }

      // Extract table name from prompt if specified
      const promptMatch = prompt.match(/for (\w+) table/i);
      const requestedTable = promptMatch ? promptMatch[1] : null;

      let systemPrompt;

      if (requestedTable) {
        // Single-table query
        const selectedTable = selectedDatabase.tables.find(
          (table) => table.name === requestedTable,
        );

        if (!selectedTable) {
          throw new Error(
            `Table "${requestedTable}" does not exist in database "${databaseName}".`,
          );
        }

        const tableColumns = this._formatTableColumns(selectedTable.columns);
        systemPrompt = this._buildSingleTablePrompt(
          dbType,
          databaseName,
          requestedTable,
          tableColumns,
          prompt,
        );
      } else {
        // Multi-table query with intelligent table selection
        const catalog = buildTableCatalog([selectedDatabase]);
        const preselected =
          Array.isArray(selectedTables) && selectedTables.length
            ? selectedTables
            : (selectedDatabase.tables || [])
                .filter((table) => Array.isArray(table.columns) && table.columns.length > 0)
                .map((table) => table.name);
        const resolvedSelection =
          preselected.length > 0
            ? preselected
            : await this.selectRelevantTables(dbType, catalog, prompt);
        let filteredSelection = resolvedSelection.filter((t) => catalog.includes(t));
        if (!filteredSelection.length) {
          filteredSelection = catalog.slice(0, Math.min(12, catalog.length));
        }

        // Filter to selected tables
        const filteredDb = {
          name: selectedDatabase.name,
          tables: (selectedDatabase.tables || []).filter((t) => filteredSelection.includes(t.name)),
        };

        // Build schema DSL with tier 2, fallback to tier 1 if too large
        let schemaDSL = buildSchemaDSL([filteredDb], filteredSelection, 2);
        if (schemaDSL.length > this.BUDGET_CHARS) {
          schemaDSL = buildSchemaDSL([filteredDb], filteredSelection, 1);
          logger.debug("Schema DSL exceeded budget, using tier 1");
        }

        systemPrompt = this._buildMultiTablePrompt(
          dbType,
          databaseName,
          catalog,
          schemaDSL,
          prompt,
        );
      }

      const result = await this.callWithTimeout(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        this.requestTimeoutMs,
        "SQL generation timed out.",
      );

      const cleanedQuery = this._cleanQuery(this._extractResponseText(result));

      this.metrics.successfulRequests++;
      this._recordResponseTime(Date.now() - startTime);

      logger.debug(`Generated SQL: ${cleanedQuery.substring(0, 100)}...`);

      return cleanedQuery;
    } catch (error) {
      this.metrics.failedRequests++;
      this._recordResponseTime(Date.now() - startTime);

      // Enhanced error logging
      logger.error("LLM SQL Generation Failed:", {
        model: this.config.model,
        provider: this.config.model
          ? require("../core/env").inferProviderFromModel(this.config.model)
          : "unknown",
        hasApiKey: !!this.config.apiKey,
        errorMessage: error.message,
        errorStack: error.stack,
        dbType: dbType,
        databaseName: databaseName,
        promptLength: prompt?.length || 0,
      });

      throw new Error(`Failed to generate SQL query: ${error.message}`);
    }
  }

  /**
   * Record response time for metrics
   */
  _recordResponseTime(timeMs) {
    this.lastResponseTimes.push(timeMs);
    if (this.lastResponseTimes.length > 100) {
      this.lastResponseTimes.shift();
    }

    const sum = this.lastResponseTimes.reduce((a, b) => a + b, 0);
    this.metrics.avgResponseTime = Math.round(sum / this.lastResponseTimes.length);
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      currentModel: this.config.model,
      hasApiKey: !!this.config.apiKey,
      lastResponseTimes: [...this.lastResponseTimes],
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      tableSelectorCalls: 0,
      sqlGenerationCalls: 0,
    };
    this.lastResponseTimes = [];
    logger.info("LLM metrics reset");
  }

  /**
   * Health check
   */
  isHealthy() {
    return !!this.llm;
  }
}

// Export singleton instance
const llmService = new LLMService();
module.exports = llmService;
