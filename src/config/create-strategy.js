const { DEFAULT_CONFIG } = require("../core/constants");

const CassandraStrategy = require("./strategies/cassandra-strategy");
const CouchDBStrategy = require("./strategies/couchdb-strategy");
const CosmosDBStrategy = require("./strategies/cosmosdb-strategy");
const DynamoDBStrategy = require("./strategies/dynamodb-strategy");
const FirestoreStrategy = require("./strategies/firestore-strategy");
const HBaseStrategy = require("./strategies/hbase-strategy");
const MemcachedStrategy = require("./strategies/memcached-strategy");
const MongoDBStrategy = require("./strategies/mongodb-strategy");
const MSSQLStrategy = require("./strategies/mssql-strategy");
const MySQLStrategy = require("./strategies/mysql-strategy");
const OracleStrategy = require("./strategies/oracle-strategy");
const PostgreSQLStrategy = require("./strategies/postgresql-strategy");
const RedisStrategy = require("./strategies/redis-strategy");
const SQLiteStrategy = require("./strategies/sqlite-strategy");

const strategyMap = Object.freeze({
  mysql2: MySQLStrategy,
  pg: PostgreSQLStrategy,
  sqlite3: SQLiteStrategy,
  mssql: MSSQLStrategy,
  oracledb: OracleStrategy,
  mongodb: MongoDBStrategy,
  redis: RedisStrategy,
  couchdb: CouchDBStrategy,
  cosmosdb: CosmosDBStrategy,
  firestore: FirestoreStrategy,
  dynamodb: DynamoDBStrategy,
  cassandra: CassandraStrategy,
  hbase: HBaseStrategy,
  memcached: MemcachedStrategy,
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
    capabilities: [
      "transactions",
      "batch",
      "aggregation",
      "crud",
      "indexes",
      "commands",
      "explain",
    ],
    supportedFeatures: ["collections", "indexes", "aggregation-pipelines", "documents", "explain"],
  },
  redis: {
    name: "Redis",
    version: "6.x+",
    type: "cache",
    capabilities: ["pipelining", "pub-sub", "transactions", "crud", "ttl", "commands"],
    supportedFeatures: ["key-value", "data-structures", "persistence", "keys"],
  },
  couchdb: {
    name: "CouchDB",
    version: "3.x+",
    type: "nosql",
    capabilities: ["crud", "query", "mango", "indexes", "documents", "changes", "attachments"],
    supportedFeatures: [
      "databases",
      "mango",
      "documents",
      "indexes",
      "views",
      "changes",
      "attachments",
    ],
  },
  cosmosdb: {
    name: "Azure Cosmos DB",
    version: "SQL API",
    type: "nosql",
    capabilities: ["crud", "query", "indexes", "documents", "batch", "stored-procedures", "admin"],
    supportedFeatures: [
      "databases",
      "containers",
      "sql-api",
      "partition-keys",
      "stored-procedures",
      "admin",
    ],
  },
  firestore: {
    name: "Firestore",
    version: "1.x",
    type: "nosql",
    capabilities: ["crud", "query", "documents", "transactions", "batch"],
    supportedFeatures: ["collections", "documents", "collection-group", "transactions", "batch"],
  },
  dynamodb: {
    name: "DynamoDB",
    version: "2012+",
    type: "nosql",
    capabilities: ["crud", "query", "batch", "indexes", "transactions", "admin"],
    supportedFeatures: ["tables", "gsi", "lsi", "items", "transactions", "admin"],
  },
  cassandra: {
    name: "Cassandra",
    version: "4.x+",
    type: "nosql",
    capabilities: ["crud", "query", "cql", "batch", "transactions"],
    supportedFeatures: ["keyspaces", "tables", "indexes", "columns", "batch", "lwt"],
  },
  hbase: {
    name: "HBase",
    version: "2.x+",
    type: "nosql",
    capabilities: ["crud", "scan", "filters"],
    supportedFeatures: ["tables", "column-families", "rows", "increment", "append", "filters"],
  },
  memcached: {
    name: "Memcached",
    version: "1.x",
    type: "cache",
    capabilities: ["crud", "ttl", "commands"],
    supportedFeatures: ["key-value", "stats"],
  },
});

function buildCapabilityModel(dbType) {
  const meta = strategyMetadata[dbType] || {};
  const type = meta.type || "sql";
  const caps = Array.isArray(meta.capabilities) ? meta.capabilities : [];

  const operations = new Set();
  const features = new Set();

  if (type === "sql") {
    operations.add("query");
    operations.add("crud");
    operations.add("indexes");
    operations.add("explain");
    features.add("pagination");
    if (caps.includes("transactions")) {
      features.add("transactions");
    }
  } else {
    operations.add("query");
    if (caps.includes("crud") || caps.includes("documents")) {
      operations.add("crud");
    }
    if (caps.includes("commands") || caps.includes("command")) {
      operations.add("command");
    }
    if (caps.includes("indexes")) {
      operations.add("indexes");
    }
    if (caps.includes("explain")) {
      operations.add("explain");
    }
    if (caps.includes("aggregation")) {
      features.add("aggregation");
    }
    if (caps.includes("ttl")) {
      features.add("ttl");
    }
    if (caps.includes("transactions")) {
      features.add("transactions");
    }
    if (caps.includes("batch")) {
      features.add("batch");
    }
  }

  return {
    type,
    operations: Array.from(operations),
    features: Array.from(features),
    limits: {
      maxPageSize: DEFAULT_CONFIG.MAX_PAGE_SIZE,
      maxScan: DEFAULT_CONFIG.MAX_PAGE_SIZE,
      supportsWrite: true,
    },
  };
}

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
 * Get capability model for a dbType
 * @param {string} dbType - Database type
 * @returns {Object} Capability model
 */
function getCapabilityModel(dbType) {
  return buildCapabilityModel(dbType);
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
    strategy.dbType = dbType;
    strategy.capabilityModel = buildCapabilityModel(dbType);
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
  getCapabilityModel,
  getAllStrategyMetadata,
  validateStrategyImplementation,
  registerStrategyHook,
  supportedDbTypes: Object.freeze(Object.keys(strategyMap)),
};
