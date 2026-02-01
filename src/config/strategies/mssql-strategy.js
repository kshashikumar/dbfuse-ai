// mssql-strategy.js
const mssql = require("mssql");
const chalk = require("chalk");

const logger = require("../../utils/logger");
const { ERROR_MESSAGES } = require("../../core/constants/database.constants");

const SQLStrategy = require("./base/sql-strategy");

class MSSQLStrategy extends SQLStrategy {
  constructor() {
    super();
    this.pool = null;
  }

  buildConnectionConfig(config) {
    const {
      host,
      port,
      username,
      password,
      database,
      ssl,
      connectionTimeout,
      poolSize,
      encrypt,
      trustServerCertificate,
      instanceName,
      domain,
      requestTimeout,
      cancelTimeout,
      packetSize,
      appName,
    } = config;

    const normalizedHost = this.normalizeHost(host);

    const connectionConfig = {
      server: normalizedHost || "localhost",
      port: parseInt(port) || 1433,
      user: username,
      password,
      database: database || "master",
      pool: {
        max: parseInt(poolSize) || 10,
        min: 2,
        idleTimeoutMillis: 30000,
      },
      options: {
        encrypt: encrypt !== undefined ? encrypt : ssl || true,
        trustServerCertificate:
          trustServerCertificate !== undefined ? trustServerCertificate : true,
        enableArithAbort: true,
        instanceName: instanceName || undefined,
        packetSize: parseInt(packetSize) || undefined,
        appName: appName || "dbfuse-ai",
      },
      connectionTimeout: parseInt(connectionTimeout) || 60000,
      requestTimeout: parseInt(requestTimeout) || 30000,
      cancelTimeout: parseInt(cancelTimeout) || 5000,
      domain: domain || undefined,
      parseJSON: true,
      arrayRowMode: false,
      useUTC: true,
    };

    Object.keys(connectionConfig.options).forEach((key) => {
      if (connectionConfig.options[key] === undefined) {
        delete connectionConfig.options[key];
      }
    });

    if (!connectionConfig.domain) delete connectionConfig.domain;

    return connectionConfig;
  }

  async connect(config) {
    const connectionConfig = this.buildConnectionConfig(config);

    chalk.green(
      `> Connecting to MSSQL server @ ${connectionConfig.server}:${connectionConfig.port} with user ${connectionConfig.user}${
        connectionConfig.database ? ` and database ${connectionConfig.database}` : ""
      }${connectionConfig.options.instanceName ? ` instance ${connectionConfig.options.instanceName}` : ""}${connectionConfig.options.encrypt ? " with encryption" : ""}`,
    );

    this.pool = new mssql.ConnectionPool(connectionConfig);

    try {
      await this.pool.connect();
      await this.pool.request().query("SELECT 1");
      logger.info("> Successfully connected to MSSQL server");
    } catch (err) {
      logger.error(
        `> MSSQL connection failed to ${connectionConfig.server}:${connectionConfig.port} as ${connectionConfig.user} (${err.code || err.name || "Error"})`,
      );
      throw err;
    }
  }

  getPoolMetrics() {
    if (!this.pool || !this.pool.pool) {
      return { available: 0, total: 0, waiting: 0 };
    }

    return {
      total: this.pool.size || 0,
      available: this.pool.available || 0,
      waiting: this.pool.pending || 0,
    };
  }

  async switchDatabase(dbName) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    await this.pool.request().query(`USE [${dbName}]`);
    this.currentDatabase = dbName;
    logger.info(`> Switched to MSSQL database: ${dbName}`);
  }

  async _executeQueryImpl(query, options = { page: 1, pageSize: 10 }) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    const page = Number(options.page) || 1;
    const pageSize = Number(options.pageSize) || 10;
    const dbName = options.dbName;

    const statements = query
      .split(";")
      .map((q) => q.trim())
      .filter((q) => q);

    const queries = [];

    for (const single of statements) {
      const started = Date.now();
      const startsWithWith = /^WITH\s/i.test(single);
      const isSelect =
        /^SELECT\s/i.test(single) ||
        (startsWithWith && !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(single));
      const isShow = /^SHOW\s/i.test(single);
      const isDescribe = /^DESCRIBE\s/i.test(single);
      const isInsert = /^INSERT\s/i.test(single);
      const isUpdate = /^UPDATE\s/i.test(single);
      const isDelete = /^DELETE\s/i.test(single);
      const isCreate = /^CREATE\s/i.test(single);
      const isDrop = /^DROP\s/i.test(single);
      const isAlter = /^ALTER\s/i.test(single);
      const isGrant = /^GRANT\s/i.test(single);
      const isRevoke = /^REVOKE\s/i.test(single);
      const isTxn = /^(BEGIN|START|COMMIT|ROLLBACK)\b/i.test(single);

      let entry = {
        query: single,
        type: "other",
        rows: [],
        totalRows: null,
        messages: [],
        pagination: undefined,
        stats: undefined,
      };

      try {
        if (isSelect) {
          entry.type = "select";
          let paginated = single;
          const hasOffsetFetch = /OFFSET\s+\d+\s+ROWS/i.test(single);
          if (!hasOffsetFetch && page && pageSize) {
            const offset = (page - 1) * pageSize;
            if (!/ORDER\s+BY/i.test(single)) {
              paginated = `${single} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
            } else {
              paginated = `${single} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
            }
          }
          const { recordset } = await this.pool.request().query(paginated);
          entry.rows = recordset;

          try {
            const cntSql = `SELECT COUNT(*) AS count FROM (${single}) AS subquery`;
            const { recordset: cnt } = await this.pool.request().query(cntSql);
            entry.totalRows = Number(cnt[0].count) || 0;
            entry.pagination = {
              page,
              pageSize,
              totalPages: Math.ceil(entry.totalRows / pageSize),
              hasMore: page * pageSize < entry.totalRows,
            };
          } catch {
            entry.totalRows = recordset.length;
          }
        } else if (isShow || isDescribe) {
          entry.type = "schema";
          let recordset;
          if (isShow && /SHOW\s+TABLES/i.test(single)) {
            const currentDb = dbName || "master";
            recordset = (
              await this.pool
                .request()
                .query(`SELECT name AS table_name FROM ${currentDb}.sys.tables`)
            ).recordset;
          } else if (isDescribe) {
            const table = single.match(/DESCRIBE\s+(\w+)/i)?.[1];
            if (table) {
              const currentDb = dbName || "master";
              recordset = (
                await this.pool
                  .request()
                  .query(
                    `SELECT column_name, data_type FROM ${currentDb}.information_schema.columns WHERE table_name = '${table}'`,
                  )
              ).recordset;
            }
          }
          entry.rows = recordset || [];
          entry.messages.push({ query: single, message: "Schema command executed successfully" });
        } else if (isInsert || isUpdate || isDelete) {
          entry.type = "dml";
          const { rowsAffected } = await this.pool.request().query(single);
          entry.messages.push({
            query: single,
            message: "Command executed successfully",
            affectedRows: rowsAffected?.[0] || 0,
          });
          entry.stats = { affectedRows: rowsAffected?.[0] || 0 };
        } else if (isCreate || isDrop || isAlter) {
          entry.type = "ddl";
          const { rowsAffected } = await this.pool.request().query(single);
          entry.messages.push({
            query: single,
            message: "DDL executed successfully",
            affectedRows: rowsAffected?.[0] || 0,
          });
          entry.stats = { affectedRows: rowsAffected?.[0] || 0 };
        } else if (isGrant || isRevoke || isTxn) {
          entry.type = isTxn ? "transaction" : "permission";
          await this.pool.request().query(single);
          entry.messages.push({
            query: single,
            message: isTxn
              ? "Transaction command executed successfully"
              : "Permission command executed successfully",
          });
        } else {
          const result = await this.pool.request().query(single);
          const recordset = result.recordset || [];
          const affectedRows = Array.isArray(result.rowsAffected)
            ? result.rowsAffected.reduce((sum, count) => sum + (count || 0), 0)
            : 0;
          if (recordset.length > 0) {
            entry.type = "query";
            entry.rows = recordset;
            entry.totalRows = recordset.length;
            entry.pagination = {
              page: 1,
              pageSize: recordset.length,
              totalPages: 1,
              hasMore: false,
            };
          } else {
            entry.type = "command";
            entry.stats = { affectedRows };
          }
          entry.messages.push({
            query: single,
            message: "Command executed successfully",
            affectedRows,
          });
        }
      } catch (err) {
        entry.messages.push({ query: single, error: true, message: err.message });
      } finally {
        entry.stats = { ...(entry.stats || {}), elapsedMs: Date.now() - started };
        queries.push(entry);
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
      await this.pool.close();
      logger.info("> Disconnected from MSSQL database");
      this.pool = null;
    }
  }

  async validateConnection() {
    if (!this.pool) return false;
    try {
      await this.pool.request().query("SELECT 1");
      return true;
    } catch (err) {
      logger.error("MSSQL connection validation failed:", err);
      return false;
    }
  }

  // Get connection pool statistics
  async getConnectionStats() {
    if (!this.pool) return null;

    try {
      const { recordset } = await this.pool.request().query(`
        SELECT 
          COUNT(*) as total_connections,
          SUM(CASE WHEN session_id > 0 THEN 1 ELSE 0 END) as active_connections
        FROM sys.dm_exec_sessions 
        WHERE is_user_process = 1
      `);

      return {
        totalConnections: recordset[0].total_connections,
        activeConnections: recordset[0].active_connections,
        poolConnected: this.pool.connected,
        poolConnecting: this.pool.connecting,
      };
    } catch (err) {
      logger.error("Error getting connection stats:", err);
      return null;
    }
  }

  async getDatabases() {
    if (!this.pool) throw new Error("MSSQL connection not initialized");
    const { recordset: databases } = await this.pool
      .request()
      .query("SELECT name FROM sys.databases");
    const databaseStats = [];

    for (const db of databases) {
      const dbName = db.name;
      try {
        const { recordset: sizeData } = await this.pool.request().query(
          `SELECT SUM(size) * 8.0 * 1024 AS sizeOnDisk 
           FROM ${dbName}.sys.master_files 
           WHERE database_id = DB_ID('${dbName}')`,
        );
        const sizeOnDisk = sizeData[0]?.sizeOnDisk || 0;

        const { recordset: tables } = await this.pool.request().query(
          `SELECT name AS table_name 
           FROM ${dbName}.sys.tables`,
        );

        const { recordset: views } = await this.pool.request().query(
          `SELECT name AS view_name 
           FROM ${dbName}.sys.views`,
        );

        const tablesData = tables.map((table) => ({ name: table.table_name }));
        const viewsData = views.map((view) => ({ name: view.view_name }));

        databaseStats.push({
          name: dbName,
          sizeOnDisk,
          tables: tablesData,
          views: viewsData,
        });
      } catch (err) {
        // Skip databases we can't access
        console.warn(`Cannot access database ${dbName}: ${err.message}`);
        databaseStats.push({
          name: dbName,
          sizeOnDisk: 0,
          tables: [],
          views: [],
          error: "Access denied",
        });
      }
    }

    return databaseStats;
  }

  async getTables(dbName) {
    if (!this.pool) throw new Error("MSSQL connection not initialized");
    await this.switchDatabase(dbName);
    const { recordset } = await this.pool.request().query(
      `SELECT name AS table_name 
       FROM ${dbName}.sys.tables`,
    );
    return recordset.map((row) => row.table_name);
  }

  async getTableInfo(dbName, tableName) {
    if (!this.pool) throw new Error("MSSQL connection not initialized");
    await this.switchDatabase(dbName);

    const request = this.pool.request();
    request.input("tableName", mssql.NVarChar, tableName);

    const { recordset: columns } = await request.query(
      `SELECT 
       column_name, 
       data_type, 
       is_nullable, 
       column_default,
       CHARACTER_MAXIMUM_LENGTH AS char_max_length,
       NUMERIC_PRECISION AS numeric_precision,
       NUMERIC_SCALE AS numeric_scale,
       DATETIME_PRECISION AS datetime_precision
     FROM ${dbName}.information_schema.columns 
     WHERE table_name = @tableName
     ORDER BY ordinal_position`,
    );

    const { recordset: indexes } = await this.pool.request().query(
      `SELECT name AS index_name, is_unique, type_desc
       FROM ${dbName}.sys.indexes 
       WHERE object_id = OBJECT_ID('${dbName}.dbo.${tableName}')`,
    );

    const { recordset: foreignKeys } = await this.pool.request().query(
      `SELECT name AS fk_name, 
              OBJECT_NAME(parent_object_id) as table_name,
              OBJECT_NAME(referenced_object_id) as referenced_table
       FROM ${dbName}.sys.foreign_keys 
       WHERE parent_object_id = OBJECT_ID('${dbName}.dbo.${tableName}')`,
    );

    const { recordset: triggers } = await this.pool.request().query(
      `SELECT name AS trigger_name, is_disabled
       FROM ${dbName}.sys.triggers 
       WHERE parent_id = OBJECT_ID('${dbName}.dbo.${tableName}')`,
    );

    return {
      db_name: dbName,
      table_name: tableName,
      columns: columns.map((col) => {
        // MSSQL returns -1 for MAX types; normalize to null length
        const rawLen = col.char_max_length != null ? Number(col.char_max_length) : null;
        const length = rawLen === -1 ? null : rawLen;
        const precision = col.numeric_precision != null ? Number(col.numeric_precision) : null;
        const scale = col.numeric_scale != null ? Number(col.numeric_scale) : null;

        return {
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable === "YES",
          default_value: col.column_default,
          length: length,
          precision: precision,
          scale: scale,
        };
      }),
      indexes: indexes.map((idx) => ({
        index_name: idx.index_name,
        is_unique: idx.is_unique,
        type: idx.type_desc,
      })),
      foreign_keys: foreignKeys.map((fk) => ({
        fk_name: fk.fk_name,
        table_name: fk.table_name,
        referenced_table: fk.referenced_table,
      })),
      triggers: triggers.map((trig) => ({
        trigger_name: trig.trigger_name,
        is_disabled: trig.is_disabled,
      })),
    };
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    if (!this.pool) throw new Error("MSSQL connection not initialized");
    await this.switchDatabase(dbName);
    const tableDetails = [];

    for (const table of tableNames) {
      const tableInfo = await this.getTableInfo(dbName, table);
      tableDetails.push(tableInfo);
    }

    return tableDetails;
  }

  /**
   * Fetch rows in a specific range for virtual scrolling
   * @param {string} query - Base query without LIMIT/OFFSET
   * @param {number} offset - Starting row index (0-based)
   * @param {number} limit - Number of rows to fetch
   * @returns {Promise<{rows: any[], hasMore: boolean, columns?: any[]}>}
   */
  async fetchRowRange(query, offset, limit, options = {}) {
    if (!this.pool) throw new Error("SQL Server connection not initialized");

    // Validate inputs
    if (offset < 0 || limit < 1 || limit > 1000) {
      throw new Error("Invalid range parameters");
    }

    // Strip trailing semicolon if present
    let workingQuery = query.trim().replace(/;+$/, "");

    const useKeyset =
      options?.paginationMode === "seek" &&
      options?.cursor?.orderBy &&
      options?.cursor?.lastValue !== undefined &&
      options?.cursor?.lastValue !== null;

    const safeOrderBy = useKeyset ? this.sanitizeOrderBy(options.cursor.orderBy) : "";
    const direction = options?.cursor?.direction === "desc" ? "DESC" : "ASC";
    const comparator = direction === "DESC" ? "<" : ">";

    try {
      let result;
      if (useKeyset && safeOrderBy) {
        const paginatedQuery = `
          SELECT TOP (@limit) *
          FROM (${workingQuery}) AS subquery
          WHERE ${safeOrderBy} ${comparator} @lastValue
          ORDER BY ${safeOrderBy} ${direction}
        `;
        const request = this.pool.request();
        request.input("limit", limit + 1);
        request.input("lastValue", options.cursor.lastValue);
        result = await request.query(paginatedQuery);
      } else {
        // SQL Server requires ORDER BY with OFFSET/FETCH
        // If query doesn't have ORDER BY, add a default one
        if (!workingQuery.toLowerCase().includes("order by")) {
          workingQuery += " ORDER BY (SELECT NULL)";
        }

        // Fetch one extra row to determine if there are more results
        const paginatedQuery = `
          ${workingQuery}
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit + 1} ROWS ONLY
        `;
        result = await this.pool.request().query(paginatedQuery);
      }

      const rows = result.recordset;
      const hasMore = rows.length > limit;

      // Remove extra row if present
      const resultRows = hasMore ? rows.slice(0, limit) : rows;

      // Extract column information from first row if available
      let columns = [];
      if (resultRows.length > 0) {
        columns = Object.keys(resultRows[0]).map((key) => ({
          name: key,
          type: typeof resultRows[0][key],
        }));
      }

      return {
        rows: resultRows,
        hasMore,
        columns,
      };
    } catch (error) {
      logger.error(`SQL Server fetchRowRange error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MSSQLStrategy;
