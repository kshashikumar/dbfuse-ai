/**
 * @fileoverview Type definitions for DBFuse AI
 * Common types used across controllers, services, and utilities
 * Provides IntelliSense support and documentation for developers
 */

/**
 * @typedef {Object} ConfigData
 * @property {string} AI_MODEL - AI model name (e.g., 'gpt-4', 'claude-3')
 * @property {string} AI_API_KEY - AI API key for authentication
 * @property {string} AI_PROVIDER - AI provider name (openai, anthropic, etc.)
 * @property {number} PORT - Server port (default: 3001)
 * @property {string} DBFUSE_USERNAME - Username for basic authentication
 * @property {string} DBFUSE_PASSWORD - Password for basic authentication
 * @property {string} DBFUSE_CONNECTIONS_KEY - Encryption key for connection storage
 */

/**
 * @typedef {Object} ConnectionConfig
 * @property {string} id - Unique connection identifier
 * @property {string} dbType - Database type (mysql2, pg, mssql, oracledb, sqlite3, mongodb, redis)
 * @property {string} [name] - Human-readable connection name
 * @property {string} [host] - Database host address
 * @property {number} [port] - Database port number
 * @property {string} [username] - Database username
 * @property {string} [password] - Database password
 * @property {string} [database] - Default database name
 * @property {string} [socketPath] - Unix socket path (MySQL)
 * @property {boolean|Object} [ssl] - Enable SSL connection or SSL options
 * @property {number} [connectionTimeout] - Connection timeout in milliseconds
 * @property {number} [poolSize] - Connection pool size
 * @property {string} [lastUsed] - ISO timestamp of last use
 * @property {string} [status] - Connection status (Available, In Use, etc.)
 * @property {Object} [metadata] - Additional connection metadata
 */

/**
 * @typedef {Object} PoolConfig
 * @property {number} [connectionLimit] - Maximum number of connections in pool
 * @property {number} [waitForConnections] - Whether to wait for available connections
 * @property {number} [queueLimit] - Maximum number of queued connection requests
 * @property {number} [idleTimeout] - Idle connection timeout in milliseconds
 * @property {number} [maxConnections] - Maximum total connections
 * @property {string} [charset] - Character set for connections
 * @property {string} [timezone] - Timezone for connections
 */

/**
 * @typedef {Object} StrategyOptions
 * @property {number} [page] - Page number for pagination (default: 1)
 * @property {number} [pageSize] - Number of results per page (default: 10)
 * @property {number} [timeout] - Query timeout in milliseconds
 * @property {boolean} [transaction] - Execute in transaction
 * @property {boolean} [retry] - Enable retry on failure
 * @property {Object} [params] - Query parameters for prepared statements
 */

/**
 * @typedef {Object} EncryptionConfig
 * @property {string} algorithm - Encryption algorithm (aes-256-gcm)
 * @property {Buffer} key - Encryption key (32 bytes for AES-256)
 * @property {number} ivLength - Initialization vector length
 * @property {number} tagLength - Authentication tag length
 */

/**
 * @typedef {Object} EncryptedDocument
 * @property {boolean} __encrypted - Flag indicating encrypted document
 * @property {number} version - Encryption version
 * @property {string} algorithm - Encryption algorithm used
 * @property {string} iv - Initialization vector (base64)
 * @property {string} authTag - Authentication tag (base64)
 * @property {string} payload - Encrypted payload (base64)
 * @property {string} createdAt - ISO timestamp of encryption
 * @property {string} [rotatedAt] - ISO timestamp of key rotation
 */

/**
 * @typedef {Object} ConnectionMetrics
 * @property {number} totalConnections - Total connections managed
 * @property {number} activeConnections - Currently active connections
 * @property {number} failedConnections - Failed connection attempts
 * @property {number} switchOperations - Database switch operations
 * @property {number} avgConnectionTime - Average connection time in milliseconds
 * @property {Array<Object>} recentErrors - Recent connection errors
 * @property {Object} circuitBreaker - Circuit breaker state
 */

/**
 * @typedef {Object} StrategyMetrics
 * @property {number} queries - Total queries executed
 * @property {number} errors - Total query errors
 * @property {number} avgQueryTime - Average query time in milliseconds
 * @property {number} errorRate - Error rate percentage
 * @property {Object} queryTypes - Query types breakdown
 * @property {Object} circuitBreaker - Circuit breaker state
 */

/**
 * @typedef {Object} QueryMetrics
 * @property {number} totalQueries - Total queries executed
 * @property {number} successfulQueries - Successful queries count
 * @property {number} failedQueries - Failed queries count
 * @property {number} cachedQueries - Queries served from cache
 * @property {number} totalExecutionTime - Total execution time in milliseconds
 * @property {number} averageExecutionTime - Average execution time in milliseconds
 * @property {CacheStats} cacheStats - Query cache statistics
 */

/**
 * @typedef {Object} CacheStats
 * @property {number} size - Current cache size
 * @property {number} maxSize - Maximum cache capacity
 * @property {number} hits - Cache hit count
 * @property {number} misses - Cache miss count
 * @property {number} hitRate - Cache hit rate percentage
 */

/**
 * @typedef {Object} LLMMetrics
 * @property {number} totalRequests - Total LLM requests
 * @property {number} successfulRequests - Successful LLM requests
 * @property {number} failedRequests - Failed LLM requests
 * @property {number} avgResponseTime - Average response time in milliseconds
 * @property {number} tableSelectorCalls - Table selector invocation count
 * @property {number} sqlGenerationCalls - SQL generation invocation count
 * @property {string} currentModel - Current AI model
 * @property {boolean} hasApiKey - Whether API key is configured
 */

/**
 * @typedef {Object} DatabaseMetadata
 * @property {string} name - Database name
 * @property {TableMetadata[]} tables - List of tables in database
 */

/**
 * @typedef {Object} TableMetadata
 * @property {string} name - Table name
 * @property {ColumnMetadata[]} columns - List of columns in table
 * @property {number} [row_count] - Approximate row count
 * @property {string} [table_type] - Table type (BASE TABLE, VIEW, etc.)
 */

/**
 * @typedef {Object} ColumnMetadata
 * @property {string} column_name - Column name
 * @property {string} data_type - Data type (VARCHAR, INT, etc.)
 * @property {boolean} is_nullable - Whether column allows NULL
 * @property {string|null} default_value - Default value
 * @property {string} [extra] - Extra information (auto_increment, etc.)
 * @property {boolean} [is_primary_key] - Whether column is primary key
 * @property {number|null} [length] - Column length for string types
 * @property {number|null} [precision] - Precision for numeric types
 * @property {number|null} [scale] - Scale for decimal types
 * @property {string} [character_set] - Character set name
 * @property {string} [collation] - Collation name
 */

/**
 * @typedef {Object} QueryResult
 * @property {Array<Object>} rows - Query result rows
 * @property {number} rowCount - Number of rows returned
 * @property {Object} [fields] - Field metadata
 * @property {number} executionTime - Execution time in milliseconds
 * @property {boolean} [fromCache] - Whether result was served from cache
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error - Error message
 * @property {string} timestamp - ISO timestamp
 * @property {string} [code] - Error code
 * @property {Object} [details] - Additional error details
 */

/**
 * @typedef {Object} SuccessResponse
 * @property {string} message - Success message
 * @property {string} timestamp - ISO timestamp
 * @property {*} [data] - Response data
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {string|null} error - Error message if validation failed
 * @property {string[]} [missingFields] - List of missing required fields
 */

/**
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - Overall health status
 * @property {string} [error] - Error message if unhealthy
 * @property {Object} [metrics] - Service metrics
 * @property {number} [activeConnections] - Active connection count
 * @property {boolean} [cacheEnabled] - Whether caching is enabled
 * @property {string} [version] - Service/config version
 */

/**
 * @typedef {Object} PaginationParams
 * @property {number} page - Page number (1-indexed)
 * @property {number} pageSize - Items per page
 * @property {number} offset - Calculated offset for database query
 * @property {number} limit - Limit for database query
 */

/**
 * @typedef {Object} AuthCredentials
 * @property {string} username - Username
 * @property {string} password - Password
 * @property {string} [token] - Encoded authentication token
 */

/**
 * @typedef {Object} AgentHook
 * @property {string} name - Hook name
 * @property {Function} callback - Hook callback function
 * @property {number} priority - Execution priority (higher = earlier)
 * @property {boolean} enabled - Whether hook is enabled
 */

/**
 * @typedef {Object} RateLimitContext
 * @property {string} connectionId - Connection identifier
 * @property {string} query - SQL query
 * @property {number} timestamp - Request timestamp
 * @property {Object} metadata - Additional context metadata
 */

/**
 * @typedef {Object} TransactionContext
 * @property {string} connectionId - Connection identifier
 * @property {string[]} queries - Queries in transaction
 * @property {string} phase - Transaction phase (start, commit, rollback)
 * @property {number} timestamp - Transaction timestamp
 */

/**
 * @typedef {Object} SQLPromptContext
 * @property {string} dbType - Database type
 * @property {string} databaseName - Target database name
 * @property {string} prompt - Natural language prompt
 * @property {string[]} [selectedTables] - Pre-selected relevant tables
 * @property {string} [schemaDSL] - Compressed schema DSL
 */

/**
 * Database type constants
 * @readonly
 * @enum {string}
 */
const DB_TYPES = {
  MYSQL: "mysql",
  POSTGRESQL: "postgresql",
  MSSQL: "mssql",
  ORACLE: "oracle",
  SQLITE: "sqlite",
  MONGODB: "mongodb",
  REDIS: "redis",
};

/**
 * Query type constants
 * @readonly
 * @enum {string}
 */
const QUERY_TYPES = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  CREATE: "CREATE",
  DROP: "DROP",
  ALTER: "ALTER",
  TRUNCATE: "TRUNCATE",
};

/**
 * HTTP status code constants
 * @readonly
 * @enum {number}
 */
const HTTP_STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
};

module.exports = {
  // Type exports (for JSDoc references)
  DB_TYPES,
  QUERY_TYPES,
  HTTP_STATUS_CODES,
};
