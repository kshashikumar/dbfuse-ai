class StrategySelector {
  constructor() {
    // Dynamically discover available strategies
    this.availableStrategies = this._discoverStrategies();
  }

  _discoverStrategies() {
    const fs = require("fs");
    const path = require("path");
    const strategiesDir = path.join(__dirname, "../strategies");

    try {
      const files = fs.readdirSync(strategiesDir);
      const strategies = files
        .filter((f) => f.endsWith("Strategy.js"))
        .map((f) => f.replace(".js", ""));

      return new Set(strategies);
    } catch {
      // Fallback to known strategies if directory read fails
      return new Set([
        "DirectSQLStrategy",
        "RAGEnhancedStrategy",
        "DecompositionStrategy",
        "ExplanationStrategy",
        "SuggestionStrategy",
      ]);
    }
  }

  select({ analysis, context, queryIntent, capabilities, dbType } = {}) {
    const tables = Array.isArray(context?.tables) ? context.tables : [];
    const complexity = analysis?.complexity || "simple";
    const confidence = analysis?.confidence || 0.5;
    const intent = queryIntent?.type || null;
    const caps = capabilities || {};
    const ops = Array.isArray(caps.operations)
      ? caps.operations.map((op) => String(op).toLowerCase())
      : [];
    const type = String(caps.type || "").toLowerCase();
    const normalizedDbType = String(dbType || "").toLowerCase();
    const isSql =
      type === "sql" ||
      ["mysql", "mysql2", "pg", "postgresql", "sqlite", "sqlite3", "mssql", "oracledb"].includes(
        normalizedDbType,
      );
    const canQuery = ops.length === 0 || ops.includes("query");

    // 1. Intent-based routing (if available)
    if (intent === "explain_query") {
      return this._validateStrategy("ExplanationStrategy");
    }

    if (intent === "suggest_alternatives") {
      return this._validateStrategy("SuggestionStrategy");
    }

    if (!canQuery) {
      return this._validateStrategy("DirectSQLStrategy");
    }

    if (!isSql) {
      return this._validateStrategy("DirectSQLStrategy");
    }

    // 2. Complex queries always use decomposition
    if (complexity === "complex") {
      return this._validateStrategy("DecompositionStrategy");
    }

    // 3. Simple queries with minimal context use direct strategy
    if (complexity === "simple" && tables.length <= 1 && confidence >= 0.7) {
      return this._validateStrategy("DirectSQLStrategy");
    }

    // 4. Medium complexity or multiple tables use RAG enhancement
    if (complexity === "medium" || tables.length > 1) {
      return this._validateStrategy("RAGEnhancedStrategy");
    }

    // 5. Default to direct SQL for simple cases
    return this._validateStrategy("DirectSQLStrategy");
  }

  _validateStrategy(strategyName) {
    if (this.availableStrategies.has(strategyName)) {
      return strategyName;
    }
    // Fallback to DirectSQLStrategy if requested strategy doesn't exist
    return "DirectSQLStrategy";
  }

  getAvailableStrategies() {
    return Array.from(this.availableStrategies);
  }

  isStrategyAvailable(strategyName) {
    return this.availableStrategies.has(strategyName);
  }
}

module.exports = StrategySelector;
