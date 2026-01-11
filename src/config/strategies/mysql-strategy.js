const chalk = require("chalk");
const mysql = require("mysql2/promise");

const { ERROR_MESSAGES, DB_DEFAULTS } = require("../../core/constants/database.constants");
const logger = require("../../utils/logger");

const SQLStrategy = require("./base/sql-strategy");

class MySQLStrategy extends SQLStrategy {
  constructor() {
    super();
    this.pool = null;
  }

  // Build normalized connection config
  buildConnectionConfig(config) {
    const {
      host,
      port,
      username,
      password,
      database,
      socketPath,
      ssl,
      connectionTimeout,
      poolSize,
      charset,
      timezone,
      waitForConnections,
      queueLimit,
    } = config;

    const normalizedHost = this.normalizeHost(host || DB_DEFAULTS.HOST);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(normalizedHost);

    const connectionConfig = {
      host: normalizedHost,
      port: parseInt(port) || DB_DEFAULTS.PORT.MYSQL,
      user: username,
      password,
      database: database || undefined,
      socketPath: isLocal && socketPath ? socketPath : undefined,
      ssl: ssl
        ? typeof ssl === "object"
          ? ssl
          : { rejectUnauthorized: false }
        : !isLocal
          ? { rejectUnauthorized: false }
          : undefined,
      connectionLimit: parseInt(poolSize) || 10,
      waitForConnections: waitForConnections !== undefined ? waitForConnections : true,
      queueLimit: parseInt(queueLimit) || 0,
      charset: charset || DB_DEFAULTS.CHARSET,
      timezone: timezone || DB_DEFAULTS.TIMEZONE,
      connectTimeout: parseInt(connectionTimeout) || 60000,
      multipleStatements: true,
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      typeCast: true,
    };

    // Remove undefined values
    Object.keys(connectionConfig).forEach((key) => {
      if (connectionConfig[key] === undefined) {
        delete connectionConfig[key];
      }
    });

    return connectionConfig;
  }

  async connect(config) {
    const connectionConfig = this.buildConnectionConfig(config);

    chalk.green(
      `> Connecting to MySQL server @ ${connectionConfig.host}:${connectionConfig.port} with user ${connectionConfig.user}${
        connectionConfig.database ? ` and database ${connectionConfig.database}` : ""
      }${connectionConfig.socketPath ? ` using socket ${connectionConfig.socketPath}` : ""}${connectionConfig.ssl ? " with SSL" : ""}`,
    );

    try {
      this.pool = await mysql.createPool(connectionConfig);
      await this.pool.query("SELECT 1");
      logger.info("> Successfully connected to MySQL server");
    } catch (err) {
      logger.error(
        `> MySQL connection failed to ${connectionConfig.host}:${connectionConfig.port} as ${connectionConfig.user} (${err.code || err.name || "Error"})`,
      );
      throw err;
    }
  }

  // Get pool metrics
  getPoolMetrics() {
    if (!this.pool || !this.pool.pool) {
      return { available: 0, total: 0, waiting: 0 };
    }

    const pool = this.pool.pool;
    return {
      total: pool._allConnections?.length || 0,
      available: pool._freeConnections?.length || 0,
      waiting: pool._connectionQueue?.length || 0,
    };
  }

  async switchDatabase(dbName) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    await this.pool.query(`USE \`${dbName}\``);
    this.currentDatabase = dbName;
    logger.info(`> Switched to MySQL database: ${dbName}`);
  }

  // Override base class method
  async _executeQueryImpl(query, options = { page: 1, pageSize: 10 }) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    const { page, pageSize } = options;

    const queries = [];
    const statements = query
      .split(";")
      .map((q) => q.trim())
      .filter((q) => q);

    for (const singleQuery of statements) {
      const isSelectQuery = /^SELECT\s/i.test(singleQuery);
      const isShowCommand = /^SHOW\s/i.test(singleQuery);
      const isDescribeCommand = /^DESCRIBE\s/i.test(singleQuery);
      const isExplainCommand = /^EXPLAIN\s/i.test(singleQuery);
      const isUseCommand = /^USE\s/i.test(singleQuery);
      const isInsertCommand = /^INSERT\s/i.test(singleQuery);
      const isUpdateCommand = /^UPDATE\s/i.test(singleQuery);
      const isDeleteCommand = /^DELETE\s/i.test(singleQuery);
      const isCreateCommand = /^CREATE\s/i.test(singleQuery);
      const isDropCommand = /^DROP\s/i.test(singleQuery);
      const isAlterCommand = /^ALTER\s/i.test(singleQuery);
      const isGrantCommand = /^GRANT\s/i.test(singleQuery);
      const isRevokeCommand = /^REVOKE\s/i.test(singleQuery);
      const isTransactionCommand = /^(BEGIN|START|COMMIT|ROLLBACK)\b/i.test(singleQuery);

      if (isSelectQuery) {
        const hasLimitOrOffset =
          /LIMIT\s+\d+/i.test(singleQuery) || /OFFSET\s+\d+/i.test(singleQuery);

        // Detect if query contains aggregate functions or GROUP BY
        const hasAggregates =
          /\b(COUNT|SUM|AVG|MAX|MIN)\s*\(/i.test(singleQuery) ||
          /\bGROUP\s+BY\b/i.test(singleQuery);

        // Detect information_schema queries - these should not be paginated
        const isInformationSchema = /\bINFORMATION_SCHEMA\./i.test(singleQuery);

        // These should not be paginated as they don't query tables
        const hasFromClause = /\bFROM\b/i.test(singleQuery);

        let paginatedQuery = singleQuery;
        const shouldPaginate =
          !hasLimitOrOffset && !hasAggregates && !isInformationSchema && hasFromClause;
        if (shouldPaginate) {
          const offset = (page - 1) * pageSize;
          paginatedQuery = `${singleQuery} LIMIT ${pageSize} OFFSET ${offset}`;
        }

        const [rows] = await this.pool.query(paginatedQuery);

        let totalRows = rows.length;

        if (shouldPaginate) {
          try {
            const totalRowsQuery = `SELECT COUNT(*) as count FROM (${singleQuery}) as subquery`;
            const [countRows] = await this.pool.query(totalRowsQuery);
            totalRows = countRows?.[0]?.count ?? rows.length;
          } catch (countError) {
            // If count query fails, fall back to returned rows length
            logger.warn(`Failed to count total rows: ${countError.message}`);
            totalRows = rows.length;
          }
        }

        const totalPages = shouldPaginate ? Math.ceil(totalRows / pageSize) || 1 : 1;
        const skipPagination = hasAggregates || isInformationSchema || !hasFromClause;

        queries.push({
          type: "SELECT",
          query: singleQuery,
          rows,
          totalRows,
          messages: [],
          pagination: {
            page: skipPagination ? 1 : page,
            pageSize: skipPagination ? rows.length : pageSize,
            totalPages,
            hasMore: shouldPaginate && page * pageSize < totalRows,
          },
        });
      } else if (isShowCommand || isDescribeCommand || isExplainCommand) {
        const [rows] = await this.pool.query(singleQuery);
        const commandType = isShowCommand ? "SHOW" : isDescribeCommand ? "DESCRIBE" : "EXPLAIN";
        queries.push({
          type: commandType,
          query: singleQuery,
          rows,
          totalRows: rows.length,
          messages: [
            {
              query: singleQuery,
              message: "Database command executed successfully",
              type: commandType,
            },
          ],
          pagination: { page: 1, pageSize: rows.length || 1, totalPages: 1, hasMore: false },
        });
      } else if (
        isInsertCommand ||
        isUpdateCommand ||
        isDeleteCommand ||
        isCreateCommand ||
        isDropCommand ||
        isAlterCommand
      ) {
        const [response] = await this.pool.query(singleQuery);
        const type = isInsertCommand
          ? "INSERT"
          : isUpdateCommand
            ? "UPDATE"
            : isDeleteCommand
              ? "DELETE"
              : isCreateCommand
                ? "CREATE"
                : isDropCommand
                  ? "DROP"
                  : "ALTER";

        queries.push({
          type,
          query: singleQuery,
          rows: [],
          totalRows: 0,
          messages: [
            {
              query: singleQuery,
              message: "Command executed successfully",
              type,
              affectedRows: response.affectedRows || 0,
              insertId: response.insertId || null,
              warningCount: response.warningCount || 0,
            },
          ],
          pagination: { page: 1, pageSize: 0, totalPages: 1, hasMore: false },
        });
      } else if (isGrantCommand || isRevokeCommand || isTransactionCommand) {
        await this.pool.query(singleQuery);
        const type = isGrantCommand ? "GRANT" : isRevokeCommand ? "REVOKE" : "TRANSACTION";
        queries.push({
          type,
          query: singleQuery,
          rows: [],
          totalRows: 0,
          messages: [
            { query: singleQuery, message: `${type} command executed successfully`, type },
          ],
          pagination: { page: 1, pageSize: 0, totalPages: 1, hasMore: false },
        });
      } else if (isUseCommand) {
        // Extract database name from USE statement
        const dbMatch = singleQuery.match(/^USE\s+`?([^`\s;]+)`?/i);
        const dbName = dbMatch ? dbMatch[1] : null;

        if (dbName) {
          await this.switchDatabase(dbName);
          queries.push({
            type: "USE",
            query: singleQuery,
            rows: [],
            totalRows: 0,
            messages: [
              {
                query: singleQuery,
                message: `Database changed to ${dbName}`,
                type: "USE",
                database: dbName,
              },
            ],
            pagination: { page: 1, pageSize: 0, totalPages: 1, hasMore: false },
          });
        } else {
          throw new Error("Invalid USE statement: database name not found");
        }
      } else {
        queries.push({
          type: "UNKNOWN",
          query: singleQuery,
          rows: [],
          totalRows: 0,
          messages: [
            {
              query: singleQuery,
              message: "Command not recognized or unsupported",
              type: "UNKNOWN",
            },
          ],
          pagination: { page: 1, pageSize: 0, totalPages: 1, hasMore: false },
        });
      }
    }

    return {
      queries,
      totalQueries: queries.length,
      executedAt: new Date().toISOString(),
    };
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      logger.info("> Disconnected from MySQL database");
      this.pool = null;
      this.currentDatabase = null;
    }
  }

  async validateConnection() {
    if (!this.pool) return false;
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch (err) {
      logger.error("MySQL connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.pool) throw new Error("MySQL connection not initialized");
    const [databases] = await this.pool.query(
      "SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA",
    );
    const databaseStats = [];

    for (const db of databases) {
      const dbName = db.name;
      const [sizeData] = await this.pool.query(
        `SELECT SUM(DATA_LENGTH + INDEX_LENGTH) AS sizeOnDisk 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = ?`,
        [dbName],
      );
      const sizeOnDisk = sizeData[0].sizeOnDisk || 0;

      const [tables] = await this.pool.query(
        `SELECT TABLE_NAME AS table_name 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_SCHEMA = ?`,
        [dbName],
      );

      const [views] = await this.pool.query(
        `SELECT TABLE_NAME AS view_name 
         FROM INFORMATION_SCHEMA.VIEWS 
         WHERE TABLE_SCHEMA = ?`,
        [dbName],
      );

      const tablesData = tables.map((table) => ({ name: table.table_name }));
      const viewsData = views.map((view) => ({ name: view.view_name }));

      databaseStats.push({
        name: dbName,
        sizeOnDisk,
        tables: tablesData,
        views: viewsData,
      });
    }

    return databaseStats;
  }

  async getTables(dbName) {
    if (!this.pool) throw new Error("MySQL connection not initialized");

    // Use provided dbName or fall back to current database
    const targetDb = dbName || this.currentDatabase;

    if (!targetDb) {
      throw new Error(
        "No database selected. Please specify a database name or switch to a database first.",
      );
    }

    // Only switch if different from current
    if (targetDb !== this.currentDatabase) {
      await this.switchDatabase(targetDb);
    }

    const [tables] = await this.pool.query(
      `SELECT TABLE_NAME AS table_name 
       FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = ?`,
      [targetDb],
    );
    return tables.map((table) => table.table_name);
  }

  async getTableInfo(dbName, tableName) {
    if (!this.pool) throw new Error("MySQL connection not initialized");

    // Switch to database first
    await this.pool.query(`USE \`${dbName}\``);

    // Get columns (include size/precision/scale when available)
    const [columns] = await this.pool.query(
      `SELECT COLUMN_NAME as column_name, 
            DATA_TYPE as data_type, 
            IS_NULLABLE as is_nullable, 
            COLUMN_DEFAULT as column_default,
            EXTRA as extra,
            COLUMN_KEY as column_key,
            CHARACTER_MAXIMUM_LENGTH as char_max_length,
            NUMERIC_PRECISION as numeric_precision,
            NUMERIC_SCALE as numeric_scale,
            DATETIME_PRECISION as datetime_precision,
            COLUMN_TYPE as column_type
     FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
     ORDER BY ORDINAL_POSITION`,
      [dbName, tableName],
    );

    // Get indexes
    const [indexes] = await this.pool.query(
      `SELECT INDEX_NAME as index_name, 
            NON_UNIQUE as non_unique, 
            COLUMN_NAME as column_name,
            INDEX_TYPE as index_type
     FROM INFORMATION_SCHEMA.STATISTICS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [dbName, tableName],
    );

    // Get foreign keys
    const [foreignKeys] = await this.pool.query(
      `SELECT CONSTRAINT_NAME as fk_name,
            COLUMN_NAME as column_name,
            REFERENCED_TABLE_SCHEMA as referenced_schema,
            REFERENCED_TABLE_NAME as referenced_table,
            REFERENCED_COLUMN_NAME as referenced_column
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
     AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [dbName, tableName],
    );

    // Get triggers - Use version-compatible query
    let triggers = [];
    try {
      // Try the new format first (MySQL 5.7+)
      const [triggersResult] = await this.pool.query(
        `SELECT TRIGGER_NAME AS trigger_name, 
              EVENT_MANIPULATION as event_manipulation, 
              ACTION_TIMING as action_timing,
              ACTION_STATEMENT as action_statement
       FROM INFORMATION_SCHEMA.TRIGGERS 
       WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?`,
        [dbName, tableName],
      );
      triggers = triggersResult;
    } catch (err) {
      if (err.code === "ER_BAD_FIELD_ERROR") {
        // Fallback for older MySQL versions - try without TIMING/ACTION_TIMING
        try {
          const [triggersResult] = await this.pool.query(
            `SELECT TRIGGER_NAME AS trigger_name, 
                  EVENT_MANIPULATION as event_manipulation,
                  ACTION_STATEMENT as action_statement
           FROM INFORMATION_SCHEMA.TRIGGERS 
           WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ?`,
            [dbName, tableName],
          );
          triggers = triggersResult.map((trigger) => ({
            ...trigger,
            action_timing: "UNKNOWN", // Default value for missing column
          }));
        } catch (fallbackErr) {
          // If triggers table doesn't exist or has other issues, return empty array
          console.warn(`Could not fetch triggers for ${dbName}.${tableName}:`, fallbackErr.message);
          triggers = [];
        }
      } else {
        throw err; // Re-throw if it's a different error
      }
    }

    return {
      db_name: dbName,
      table_name: tableName,
      columns: columns.map((col) => {
        // Derive length/precision/scale with sensible fallbacks
        let length = col.char_max_length != null ? Number(col.char_max_length) : null;
        let precision = col.numeric_precision != null ? Number(col.numeric_precision) : null;
        let scale = col.numeric_scale != null ? Number(col.numeric_scale) : null;

        // Fallback: parse from COLUMN_TYPE e.g., varchar(255), decimal(10,2), bit(1)
        if (length == null && precision == null && col.column_type) {
          const sizeMatch = /\((\d+)(?:,(\d+))?\)/.exec(col.column_type);
          if (sizeMatch) {
            const first = parseInt(sizeMatch[1], 10);
            const second = sizeMatch[2] ? parseInt(sizeMatch[2], 10) : null;
            if (second != null) {
              precision = first;
              scale = second;
            } else {
              length = first;
            }
          }
        }

        return {
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable === "YES",
          default_value: col.column_default,
          extra: col.extra,
          is_primary_key: col.column_key === "PRI",
          length: length,
          precision: precision,
          scale: scale,
        };
      }),
      indexes: indexes.map((idx) => ({
        index_name: idx.index_name,
        is_unique: idx.non_unique === 0,
        column_name: idx.column_name,
        index_type: idx.index_type,
      })),
      foreign_keys: foreignKeys.map((fk) => ({
        fk_name: fk.fk_name,
        column_name: fk.column_name,
        referenced_schema: fk.referenced_schema,
        referenced_table: fk.referenced_table,
        referenced_column: fk.referenced_column,
      })),
      triggers: triggers.map((trig) => ({
        trigger_name: trig.trigger_name,
        event_manipulation: trig.event_manipulation,
        action_timing: trig.action_timing || "UNKNOWN",
        action_statement: trig.action_statement,
      })),
    };
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    if (!this.pool) throw new Error("MySQL connection not initialized");
    await this.switchDatabase(dbName);
    const tableDetails = [];

    for (const table of tableNames) {
      const tableInfo = await this.getTableInfo(dbName, table);
      tableDetails.push(tableInfo);
    }

    return tableDetails;
  }

  async getViews(dbName) {
    if (!this.pool) throw new Error("MySQL connection not initialized");
    await this.switchDatabase(dbName);
    const [views] = await this.pool.query(
      `SELECT TABLE_NAME AS view_name 
       FROM INFORMATION_SCHEMA.VIEWS 
       WHERE TABLE_SCHEMA = ?`,
      [dbName],
    );
    return views.map((v) => ({ name: v.view_name }));
  }

  async getProcedures(dbName) {
    if (!this.pool) throw new Error("MySQL connection not initialized");
    await this.switchDatabase(dbName);
    const [procs] = await this.pool.query(
      `SELECT ROUTINE_NAME AS procedure_name, ROUTINE_SCHEMA AS routine_schema 
       FROM INFORMATION_SCHEMA.ROUTINES 
       WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = ?`,
      [dbName],
    );
    return procs.map((p) => ({ name: p.procedure_name, schema: p.routine_schema }));
  }
}

module.exports = MySQLStrategy;
