const MySQLStrategy = require("./strategies/mysql-strategy");
const PostgreSQLStrategy = require("./strategies/postgresql-strategy");
const SQLiteStrategy = require("./strategies/sqlite-strategy");
const MSSQLStrategy = require("./strategies/mssql-strategy");
const OracleStrategy = require("./strategies/oracle-strategy");
const MongoDBStrategy = require("./strategies/mongodb-strategy");
const RedisStrategy = require("./strategies/redis-strategy");

const strategyMap = Object.freeze({
  mysql2: MySQLStrategy,
  pg: PostgreSQLStrategy,
  sqlite3: SQLiteStrategy,
  mssql: MSSQLStrategy,
  oracledb: OracleStrategy,
  mongodb: MongoDBStrategy,
  redis: RedisStrategy,
});

// Strategy metadata for agent introspection
const strategyMetadata = Object.freeze({
  mysql2: {
    name: "MySQL",
    version: "2.x",
    type: "sql",
    capabilities: ["transactions", "prepared-statements", "batch", "pooling"],
    supportedFeatures: ["multi-database", "views", "procedures", "functions"],
  },
  pg: {
    name: "PostgreSQL",
    version: "14+",
    type: "sql",
    capabilities: ["transactions", "prepared-statements", "batch", "pooling", "schemas"],
    supportedFeatures: ["multi-database", "views", "procedures", "functions", "custom-types"],
  },
  sqlite3: {
    name: "SQLite",
    version: "3.x",
    type: "sql",
    capabilities: ["transactions", "prepared-statements", "batch"],
    supportedFeatures: ["views", "triggers"],
  },
  mssql: {
    name: "Microsoft SQL Server",
    version: "2012+",
    type: "sql",
    capabilities: ["transactions", "prepared-statements", "batch", "pooling"],
    supportedFeatures: ["multi-database", "views", "procedures", "functions"],
  },
  oracledb: {
    name: "Oracle Database",
    version: "11g+",
    type: "sql",
    capabilities: ["transactions", "prepared-statements", "batch", "pooling"],
    supportedFeatures: ["multi-database", "views", "procedures", "functions", "packages"],
  },
  mongodb: {
    name: "MongoDB",
    version: "4.x+",
    type: "nosql",
    capabilities: ["transactions", "batch", "aggregation"],
    supportedFeatures: ["collections", "indexes", "aggregation-pipelines"],
  },
  redis: {
    name: "Redis",
    version: "6.x+",
    type: "cache",
    capabilities: ["pipelining", "pub-sub", "transactions"],
    supportedFeatures: ["key-value", "data-structures", "persistence"],
  },
});

// Strategy hooks for agent framework
const hooks = {
  "strategy.created": [],
  "strategy.validated": [],
  "strategy.error": [],
};

/**
 * Register a hook for strategy events
 * @param {string} event - Event name
 * @param {Function} handler - Handler function
 * @returns {Function} Unsubscribe function
 */
function registerStrategyHook(event, handler) {
  if (!hooks[event]) {
    throw new Error(`Unknown strategy hook event: ${event}`);
  }
  if (typeof handler !== "function") {
    throw new Error("Hook handler must be a function");
  }
  hooks[event].push(handler);
  return () => {
    const index = hooks[event].indexOf(handler);
    if (index > -1) hooks[event].splice(index, 1);
  };
}

async function executeHooks(event, context) {
  const handlers = hooks[event] || [];
  for (const handler of handlers) {
    try {
      await handler(context);
    } catch (error) {
      console.warn(`Strategy hook handler failed for ${event}: ${error.message}`);
    }
  }
}

/**
 * Validate strategy implementation
 * @param {Function} StrategyClass - Strategy class to validate
 * @returns {Object} Validation result { valid, missing }
 */
function validateStrategyImplementation(StrategyClass) {
  const requiredMethods = [
    "connect",
    "disconnect",
    "executeQuery",
    "validateConnection",
    "getDatabases",
  ];

  const missing = [];
  const instance = new StrategyClass();

  for (const method of requiredMethods) {
    if (typeof instance[method] !== "function") {
      missing.push(method);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

function getStrategyClass(dbType) {
  const Strategy = strategyMap[dbType];
  if (!Strategy) {
    const supported = Object.keys(strategyMap).join(", ");
    throw new Error(`Unsupported database type: ${dbType}. Supported types: ${supported}`);
  }
  return Strategy;
}

/**
 * Get strategy metadata
 * @param {string} dbType - Database type
 * @returns {Object} Strategy metadata
 */
function getStrategyMetadata(dbType) {
  return strategyMetadata[dbType] || null;
}

/**
 * Get all strategy capabilities
 * @returns {Object} Map of dbType to metadata
 */
function getAllStrategyMetadata() {
  return { ...strategyMetadata };
}

async function createStrategy(dbType) {
  try {
    const Strategy = getStrategyClass(dbType);

    // Validate strategy implementation
    const validation = validateStrategyImplementation(Strategy);
    if (!validation.valid) {
      const error = new Error(
        `Strategy ${dbType} is missing required methods: ${validation.missing.join(", ")}`,
      );
      await executeHooks("strategy.error", { dbType, error });
      throw error;
    }

    const strategy = new Strategy();
    await executeHooks("strategy.created", { dbType, strategy });
    await executeHooks("strategy.validated", { dbType, validation });

    return strategy;
  } catch (error) {
    await executeHooks("strategy.error", { dbType, error });
    throw error;
  }
}

module.exports = {
  createStrategy,
  getStrategyClass,
  getStrategyMetadata,
  getAllStrategyMetadata,
  validateStrategyImplementation,
  registerStrategyHook,
  supportedDbTypes: Object.freeze(Object.keys(strategyMap)),
};
