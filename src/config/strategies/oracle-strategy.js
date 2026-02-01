// oracle-strategy.js
const oracledb = require("oracledb");
const chalk = require("chalk");

const logger = require("../../utils/logger");
const { ERROR_MESSAGES } = require("../../core/constants/database.constants");

const SQLStrategy = require("./base/sql-strategy");

class OracleStrategy extends SQLStrategy {
  constructor() {
    super();
    this.pool = null;
    this.currentSchema = null;
  }

  buildConnectionConfig(config) {
    const {
      host,
      port,
      username,
      password,
      database,
      connectionTimeout,
      poolSize,
      poolMin,
      poolTimeout,
      serviceName,
      sid,
      walletLocation,
      walletPassword,
      edition,
      privilege,
      externalAuth,
    } = config;

    const normalizedHost = this.normalizeHost(host);

    let connectString;
    if (serviceName) {
      connectString = `${normalizedHost || "localhost"}:${port || 1521}/${serviceName}`;
    } else if (sid) {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${normalizedHost || "localhost"})(PORT=${port || 1521}))(CONNECT_DATA=(SID=${sid})))`;
    } else {
      connectString = `${normalizedHost || "localhost"}:${port || 1521}/${database || "XE"}`;
    }

    const poolConfig = {
      user: username,
      password,
      connectString,
      poolMax: parseInt(poolSize) || 10,
      poolMin: parseInt(poolMin) || 2,
      poolTimeout: parseInt(poolTimeout) || 30,
      poolIncrement: 1,
      connectionTimeout: parseInt(connectionTimeout) || 60000,
      privilege: privilege ? oracledb[privilege.toUpperCase()] : undefined,
      edition: edition || undefined,
      externalAuth: externalAuth || false,
      walletLocation: walletLocation || undefined,
      walletPassword: walletPassword || undefined,
      stmtCacheSize: 30,
      enableStatistics: false,
      queueMax: 500,
      queueTimeout: 60000,
      sessionCallback: undefined,
      sodaMetaDataCache: false,
      events: false,
    };

    Object.keys(poolConfig).forEach((key) => {
      if (poolConfig[key] === undefined) {
        delete poolConfig[key];
      }
    });

    return poolConfig;
  }

  async connect(config) {
    const poolConfig = this.buildConnectionConfig(config);

    chalk.green(
      `> Connecting to Oracle server @ ${poolConfig.connectString} with user ${poolConfig.user}${
        config.edition ? ` edition ${config.edition}` : ""
      }${config.privilege ? ` with ${config.privilege} privilege` : ""}`,
    );

    try {
      this.pool = await oracledb.createPool(poolConfig);
      this.currentSchema = poolConfig.user; // Default to connected user's schema

      // Test connection
      const connection = await this.pool.getConnection();
      await connection.execute("SELECT 1 FROM DUAL");
      await connection.close();
      logger.info("> Successfully connected to Oracle server");
    } catch (err) {
      logger.error(
        `> Oracle connection failed to ${poolConfig.connectString} as ${poolConfig.user} (${err.errorNum || err.code || err.name || "Error"})`,
      );
      throw err;
    }
  }

  getPoolMetrics() {
    if (!this.pool || !this.pool._allConnections) {
      return { available: 0, total: 0, waiting: 0 };
    }

    return {
      total: this.pool.poolMax || 0,
      available: this.pool._freeConnections?.length || 0,
      waiting: this.pool._pendingQueue?.length || 0,
    };
  }

  async switchDatabase(dbName) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    this.currentSchema = dbName;
    this.currentDatabase = dbName;
    logger.info(`> Switched to Oracle schema: ${dbName}`);
  }

  async _executeQueryImpl(query, options = { page: 1, pageSize: 10 }) {
    if (!this.pool) throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    const page = Number(options.page) || 1;
    const pageSize = Number(options.pageSize) || 10;

    const statements = query
      .split(";")
      .map((q) => q.trim())
      .filter((q) => q);

    const connection = await this.pool.getConnection();
    const queries = [];

    try {
      if (this.currentSchema) {
        await connection.execute(`ALTER SESSION SET CURRENT_SCHEMA = "${this.currentSchema}"`);
      }

      for (let single of statements) {
        const started = Date.now();
        // strip schema prefix of currentSchema if present
        if (this.currentSchema) {
          const rx = new RegExp(`\\b${this.currentSchema}\\.([a-zA-Z_][a-zA-Z0-9_]*)\\b`, "gi");
          single = single.replace(rx, "$1");
        }

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
            const hasFetch =
              /FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY/i.test(single) ||
              /OFFSET\s+\d+\s+ROWS/i.test(single);
            if (!hasFetch) {
              const offset = (page - 1) * pageSize;
              paginated =
                offset > 0
                  ? `${single} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`
                  : `${single} FETCH FIRST ${pageSize} ROWS ONLY`;
            }
            const res = await connection.execute(paginated, [], {
              outFormat: oracledb.OUT_FORMAT_OBJECT,
            });
            entry.rows = res.rows || [];

            try {
              const cntSql = `SELECT COUNT(*) AS COUNT FROM (${single})`;
              const cnt = await connection.execute(cntSql, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
              });
              entry.totalRows = Number(cnt.rows?.[0]?.COUNT) || 0;
              entry.pagination = {
                page,
                pageSize,
                totalPages: Math.ceil(entry.totalRows / pageSize),
                hasMore: page * pageSize < entry.totalRows,
              };
            } catch {
              entry.totalRows = entry.rows.length;
            }
          } else if (isShow || isDescribe) {
            entry.type = "schema";
            let res;
            if (isShow && /SHOW\s+TABLES/i.test(single)) {
              res = await connection.execute(
                `SELECT table_name FROM user_tables ORDER BY table_name`,
                [],
                { outFormat: oracledb.OUT_FORMAT_OBJECT },
              );
            } else if (isDescribe) {
              const table = single.match(/DESCRIBE\s+(\w+)/i)?.[1];
              if (table) {
                res = await connection.execute(
                  `SELECT column_name, data_type, nullable, data_default 
                 FROM user_tab_columns 
                 WHERE table_name = UPPER(:1) 
                 ORDER BY column_id`,
                  [table],
                  { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
              }
            }
            entry.rows = res?.rows || [];
            entry.messages.push({ query: single, message: "Schema command executed successfully" });
          } else if (isInsert || isUpdate || isDelete) {
            entry.type = "dml";
            const r = await connection.execute(single);
            await connection.commit();
            entry.messages.push({
              query: single,
              message: "Command executed successfully",
              affectedRows: r.rowsAffected || 0,
            });
            entry.stats = { affectedRows: r.rowsAffected || 0 };
          } else if (isCreate || isDrop || isAlter) {
            entry.type = "ddl";
            const r = await connection.execute(single);
            await connection.commit();
            entry.messages.push({
              query: single,
              message: "DDL executed successfully",
              affectedRows: r.rowsAffected || 0,
            });
            entry.stats = { affectedRows: r.rowsAffected || 0 };
          } else if (isGrant || isRevoke || isTxn) {
            entry.type = isTxn ? "transaction" : "permission";
            await connection.execute(single);
            if (!isTxn) await connection.commit();
            entry.messages.push({
              query: single,
              message: isTxn
                ? "Transaction command executed successfully"
                : "Permission command executed successfully",
            });
          } else {
            const res = await connection.execute(single, [], {
              outFormat: oracledb.OUT_FORMAT_OBJECT,
            });
            if (Array.isArray(res.rows) && res.rows.length > 0) {
              entry.type = "query";
              entry.rows = res.rows;
              entry.totalRows = res.rows.length;
              entry.pagination = {
                page: 1,
                pageSize: res.rows.length,
                totalPages: 1,
                hasMore: false,
              };
            } else {
              entry.type = "command";
              entry.stats = { affectedRows: res.rowsAffected || 0 };
              if (!/^\s*BEGIN\b/i.test(single)) {
                await connection.commit();
              }
            }
            entry.messages.push({
              query: single,
              message: "Command executed successfully",
              affectedRows: res.rowsAffected || 0,
            });
          }
        } catch (err) {
          entry.messages.push({ query: single, error: true, message: err.message });
        } finally {
          entry.stats = { ...(entry.stats || {}), elapsedMs: Date.now() - started };
          queries.push(entry);
        }
      }
    } finally {
      await connection.close();
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
      logger.info("> Disconnected from Oracle database");
      this.pool = null;
    }
  }

  async validateConnection() {
    if (!this.pool) return false;
    try {
      const connection = await this.pool.getConnection();
      await connection.execute("SELECT 1 FROM DUAL");
      await connection.close();
      return true;
    } catch (err) {
      logger.error("Oracle connection validation failed:", err);
      return false;
    }
  }

  // Get connection pool statistics
  async getConnectionStats() {
    if (!this.pool) return null;

    try {
      const connection = await this.pool.getConnection();
      try {
        const { rows } = await connection.execute(
          `
          SELECT 
            COUNT(*) as total_sessions,
            SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_sessions,
            SUM(CASE WHEN status = 'INACTIVE' THEN 1 ELSE 0 END) as inactive_sessions
          FROM v$session 
          WHERE type = 'USER'
        `,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        return {
          totalSessions: parseInt(rows[0].TOTAL_SESSIONS),
          activeSessions: parseInt(rows[0].ACTIVE_SESSIONS),
          inactiveSessions: parseInt(rows[0].INACTIVE_SESSIONS),
          poolConnections: this.pool.connectionsOpen,
          poolConnecting: this.pool.connectionsInUse,
        };
      } finally {
        await connection.close();
      }
    } catch (err) {
      logger.error("Error getting connection stats:", err);
      return null;
    }
  }

  async getDatabases() {
    if (!this.pool) throw new Error("Oracle connection not initialized");
    const connection = await this.pool.getConnection();
    try {
      const { rows: schemas } = await connection.execute(
        "SELECT username AS name FROM all_users WHERE username NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'SYSMAN', 'OUTLN', 'MDSYS', 'ORDSYS', 'EXFSYS', 'DMSYS', 'WMSYS', 'CTXSYS', 'ANONYMOUS', 'XDB', 'XS$NULL', 'ORACLE_OCM', 'APPQOSSYS', 'GGSYS', 'OJVMSYS', 'DVF', 'DVSYS') ORDER BY username",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const databaseStats = [];

      for (const schema of schemas) {
        const schemaName = schema.NAME;
        try {
          // Get schema size
          const { rows: sizeData } = await connection.execute(
            `SELECT NVL(SUM(bytes), 0) AS size_on_disk FROM dba_segments WHERE owner = :1`,
            [schemaName],
            { outFormat: oracledb.OUT_FORMAT_OBJECT },
          );
          const sizeOnDisk = parseInt(sizeData[0].SIZE_ON_DISK) || 0;

          // Get tables for this schema
          const { rows: tables } = await connection.execute(
            `SELECT table_name FROM all_tables WHERE owner = :1 ORDER BY table_name`,
            [schemaName],
            { outFormat: oracledb.OUT_FORMAT_OBJECT },
          );

          // Get views for this schema
          const { rows: views } = await connection.execute(
            `SELECT view_name FROM all_views WHERE owner = :1 ORDER BY view_name`,
            [schemaName],
            { outFormat: oracledb.OUT_FORMAT_OBJECT },
          );

          const tablesData = tables.map((table) => ({ name: table.TABLE_NAME }));
          const viewsData = views.map((view) => ({ name: view.VIEW_NAME }));

          databaseStats.push({
            name: schemaName,
            sizeOnDisk,
            tables: tablesData,
            views: viewsData,
          });
        } catch (err) {
          console.warn(`Cannot access schema ${schemaName}: ${err.message}`);
          databaseStats.push({
            name: schemaName,
            sizeOnDisk: 0,
            tables: [],
            views: [],
            error: "Access denied",
          });
        }
      }

      return databaseStats;
    } finally {
      await connection.close();
    }
  }

  async getTables(dbName) {
    if (!this.pool) throw new Error("Oracle connection not initialized");
    const connection = await this.pool.getConnection();
    try {
      const schemaName = dbName || this.currentSchema;
      const { rows } = await connection.execute(
        `SELECT table_name FROM all_tables WHERE owner = :1 ORDER BY table_name`,
        [schemaName],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return rows.map((row) => row.TABLE_NAME);
    } finally {
      await connection.close();
    }
  }

  async getTableInfo(dbName, tableName) {
    if (!this.pool) throw new Error("Oracle connection not initialized");
    const connection = await this.pool.getConnection();
    try {
      const schemaName = dbName || this.currentSchema;

      const { rows: columns } = await connection.execute(
        `SELECT column_name, data_type, nullable, data_default, data_length, data_precision, data_scale
         FROM all_tab_columns 
         WHERE owner = :1 AND table_name = UPPER(:2)
         ORDER BY column_id`,
        [schemaName, tableName],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const { rows: indexes } = await connection.execute(
        `SELECT index_name, uniqueness, index_type
         FROM all_indexes 
         WHERE owner = :1 AND table_name = UPPER(:2)
         ORDER BY index_name`,
        [schemaName, tableName],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const { rows: foreignKeys } = await connection.execute(
        `SELECT constraint_name AS fk_name, r_constraint_name, delete_rule
         FROM all_constraints 
         WHERE constraint_type = 'R' AND owner = :1 AND table_name = UPPER(:2)
         ORDER BY constraint_name`,
        [schemaName, tableName],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const { rows: triggers } = await connection.execute(
        `SELECT trigger_name, trigger_type, triggering_event, status
         FROM all_triggers 
         WHERE owner = :1 AND table_name = UPPER(:2)
         ORDER BY trigger_name`,
        [schemaName, tableName],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      return {
        db_name: schemaName,
        table_name: tableName,
        columns: columns.map((col) => ({
          column_name: col.COLUMN_NAME,
          data_type: col.DATA_TYPE,
          is_nullable: col.NULLABLE === "Y",
          default_value: col.DATA_DEFAULT,
          data_length: col.DATA_LENGTH,
          length: col.DATA_LENGTH != null ? Number(col.DATA_LENGTH) : null,
          precision: col.DATA_PRECISION != null ? Number(col.DATA_PRECISION) : null,
          scale: col.DATA_SCALE != null ? Number(col.DATA_SCALE) : null,
        })),
        indexes: indexes.map((idx) => ({
          index_name: idx.INDEX_NAME,
          is_unique: idx.UNIQUENESS === "UNIQUE",
          index_type: idx.INDEX_TYPE,
        })),
        foreign_keys: foreignKeys.map((fk) => ({
          fk_name: fk.FK_NAME,
          referenced_constraint: fk.R_CONSTRAINT_NAME,
          delete_rule: fk.DELETE_RULE,
        })),
        triggers: triggers.map((trig) => ({
          trigger_name: trig.TRIGGER_NAME,
          trigger_type: trig.TRIGGER_TYPE,
          triggering_event: trig.TRIGGERING_EVENT,
          status: trig.STATUS,
        })),
      };
    } finally {
      await connection.close();
    }
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    if (!this.pool) throw new Error("Oracle connection not initialized");
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
    if (!this.connection) throw new Error("Oracle connection not initialized");

    // Validate inputs
    if (offset < 0 || limit < 1 || limit > 1000) {
      throw new Error("Invalid range parameters");
    }

    // Strip trailing semicolon if present
    const cleanQuery = query.trim().replace(/;+$/, "");

    try {
      const useKeyset =
        options?.paginationMode === "seek" &&
        options?.cursor?.orderBy &&
        options?.cursor?.lastValue !== undefined &&
        options?.cursor?.lastValue !== null;

      const safeOrderBy = useKeyset ? this.sanitizeOrderBy(options.cursor.orderBy) : "";
      const direction = options?.cursor?.direction === "desc" ? "DESC" : "ASC";
      const comparator = direction === "DESC" ? "<" : ">";

      let result;
      if (useKeyset && safeOrderBy) {
        const paginatedQuery = `
          SELECT *
          FROM (
            SELECT *
            FROM (${cleanQuery}) subquery
            WHERE ${safeOrderBy} ${comparator} :lastValue
            ORDER BY ${safeOrderBy} ${direction}
          )
          FETCH FIRST ${limit + 1} ROWS ONLY
        `;
        result = await this.connection.execute(paginatedQuery, {
          lastValue: options.cursor.lastValue,
        });
      } else {
        // Fetch one extra row to determine if there are more results
        const paginatedQuery = `
          ${cleanQuery}
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit + 1} ROWS ONLY
        `;
        result = await this.connection.execute(paginatedQuery);
      }
      const rows = result.rows;
      const hasMore = rows && rows.length > limit;

      // Remove extra row if present
      const resultRows = hasMore ? rows.slice(0, limit) : rows || [];

      // Extract column information from metadata
      let columns = [];
      if (result.metaData && result.metaData.length > 0) {
        columns = result.metaData.map((col) => ({
          name: col.name,
          type: col.dbTypeName || col.fetchType,
        }));
      }

      return {
        rows: resultRows,
        hasMore,
        columns,
      };
    } catch (error) {
      logger.error(`Oracle fetchRowRange error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = OracleStrategy;
