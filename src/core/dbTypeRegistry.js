const DEFAULT_ENTRY = Object.freeze({
  category: "unknown",
  promptHints: [],
  planHints: [],
});

const DB_TYPE_REGISTRY = Object.freeze({
  mysql2: {
    category: "sql",
    promptHints: [
      "Use backticks for identifiers if needed.",
      "Use LIMIT for pagination.",
      "Avoid double quotes for identifiers unless required.",
    ],
    planHints: ["SQL operations: SELECT, JOIN, GROUP BY, aggregate functions, views, procedures."],
  },
  pg: {
    category: "sql",
    promptHints: [
      "Use double quotes for identifiers if needed.",
      "Use LIMIT/OFFSET for pagination.",
      "Prefer ILIKE for case-insensitive matching.",
    ],
    planHints: ["SQL operations: SELECT, JOIN, GROUP BY, aggregate functions, views, procedures."],
  },
  sqlite3: {
    category: "sql",
    promptHints: [
      "Use double quotes or backticks for identifiers.",
      "Use LIMIT/OFFSET for pagination.",
    ],
    planHints: ["SQL operations: SELECT, JOIN, GROUP BY, aggregate functions, views."],
  },
  mssql: {
    category: "sql",
    promptHints: [
      "Use [brackets] or quoted identifiers.",
      "Use TOP (n) or OFFSET/FETCH for pagination.",
      "Avoid LIMIT.",
    ],
    planHints: ["SQL operations: SELECT, JOIN, GROUP BY, aggregate functions, views, procedures."],
  },
  oracledb: {
    category: "sql",
    promptHints: [
      "Use double quotes for identifiers if needed.",
      "Use FETCH FIRST n ROWS ONLY for pagination.",
      "Avoid LIMIT.",
    ],
    planHints: ["SQL operations: SELECT, JOIN, GROUP BY, aggregate functions, views, procedures."],
  },
  mongodb: {
    category: "nosql",
    promptHints: ["Use find() and aggregate() with $match, $group, and $lookup pipelines."],
    planHints: ["MongoDB operations: find(), aggregate(), $match, $group, $lookup pipelines."],
  },
  redis: {
    category: "cache",
    promptHints: ["Use GET, SET, SCAN, key patterns, and TTL commands."],
    planHints: ["Redis operations: GET, SET, SCAN, key patterns, TTL."],
  },
  cassandra: {
    category: "nosql",
    promptHints: ["Use CQL. Partition key is required for efficient queries."],
    planHints: ["Cassandra operations: partition-key queries, range queries."],
  },
  dynamodb: {
    category: "nosql",
    promptHints: [
      "Use key condition expressions. Partition key required; use GSI/LSI for secondary access.",
    ],
    planHints: ["DynamoDB operations: key condition queries, GSI/LSI access patterns."],
  },
  firestore: {
    category: "nosql",
    promptHints: ["Use collection/document queries with filters and limits. No joins."],
    planHints: ["Firestore operations: collection queries, document filters, subcollections."],
  },
  cosmosdb: {
    category: "nosql",
    promptHints: ["Use SQL-like API with c.id fields. Avoid unsupported joins."],
    planHints: ["CosmosDB operations: collection queries, document filters, subcollections."],
  },
  couchdb: {
    category: "nosql",
    promptHints: ["Use Mango queries via _find or views for indexing."],
    planHints: ["CouchDB operations: Mango queries, views, document fetch."],
  },
  hbase: {
    category: "nosql",
    promptHints: ["Use get/scan/put operations with row keys."],
    planHints: ["HBase operations: get, scan, put with row keys."],
  },
  memcached: {
    category: "cache",
    promptHints: ["Use get, set, delete, incr/decr for key-based access."],
    planHints: ["Memcached operations: get, set, delete, incr/decr."],
  },
});

const normalizeDbType = (dbType) => String(dbType || "").toLowerCase();

const getDbTypeEntry = (dbType) => {
  const key = normalizeDbType(dbType);
  return DB_TYPE_REGISTRY[key] || DEFAULT_ENTRY;
};

const getDbTypeCategory = (dbType) => getDbTypeEntry(dbType).category || "unknown";

module.exports = {
  DB_TYPE_REGISTRY,
  getDbTypeEntry,
  getDbTypeCategory,
};
