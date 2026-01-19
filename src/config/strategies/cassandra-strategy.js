const logger = require("../../utils/logger");

const NoSQLStrategy = require("./base/nosql-strategy");

class CassandraStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let cassandra;
    try {
      cassandra = require("cassandra-driver");
    } catch (error) {
      throw new Error(
        "Cassandra driver not installed. Add 'cassandra-driver' to dependencies to enable Cassandra support.",
      );
    }

    const host = this.normalizeHost(config.host || "localhost");
    const contactPoints = Array.isArray(config.contactPoints) ? config.contactPoints : [host];
    const localDataCenter = config.dataCenter || config.datacenter || "datacenter1";
    const options = {
      contactPoints,
      localDataCenter,
      keyspace: config.database || config.keyspace || undefined,
    };

    if (config.username && config.password) {
      options.authProvider = new cassandra.auth.PlainTextAuthProvider(
        config.username,
        config.password,
      );
    }
    if (config.port) {
      options.protocolOptions = { port: config.port };
    }

    this.client = new cassandra.Client(options);
    await this.client.connect();
    this.connectionConfig = config;
    this.currentDatabase = options.keyspace || null;
    logger.info("Cassandra connection established");
  }

  async disconnect() {
    if (this.client) {
      await this.client.shutdown();
      this.client = null;
    }
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.execute("SELECT now() FROM system.local");
      return true;
    } catch (err) {
      logger.error("Cassandra connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("Cassandra connection not initialized");
    const result = await this.client.execute("SELECT keyspace_name FROM system_schema.keyspaces");
    const databases = result.rows.map((row) => row.keyspace_name);

    const entries = [];
    for (const dbName of databases) {
      let tables = [];
      try {
        tables = await this.getCollections(dbName);
      } catch {
        tables = [];
      }
      entries.push({
        name: dbName,
        sizeOnDisk: 0,
        tables: tables.map((name) => ({ name })),
        views: [],
      });
    }

    return entries;
  }

  async switchDatabase(dbName) {
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections(dbName) {
    if (!this.client) throw new Error("Cassandra connection not initialized");
    const keyspace = dbName || this.currentDatabase;
    if (!keyspace) throw new Error("No keyspace selected for Cassandra tables.");
    this.currentDatabase = keyspace;
    const result = await this.client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?",
      [keyspace],
      { prepare: true },
    );
    return result.rows.map((row) => row.table_name);
  }

  async getCollectionInfo(dbName, collectionName) {
    if (!this.client) throw new Error("Cassandra connection not initialized");
    const keyspace = dbName || this.currentDatabase;
    if (!keyspace) throw new Error("No keyspace selected for Cassandra.");
    if (!collectionName) throw new Error("Table name is required for Cassandra.");
    this.currentDatabase = keyspace;

    const columnResult = await this.client.execute(
      "SELECT column_name, type, kind, position FROM system_schema.columns WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, collectionName],
      { prepare: true },
    );
    const columns = columnResult.rows.map((row) => ({
      column_name: row.column_name,
      data_type: row.type,
      extra: row.kind ? `kind=${row.kind}` : undefined,
    }));

    const indexResult = await this.client.execute(
      "SELECT index_name, kind FROM system_schema.indexes WHERE keyspace_name = ? AND table_name = ?",
      [keyspace, collectionName],
      { prepare: true },
    );
    const indexes = indexResult.rows.map((row) => ({
      index_name: row.index_name,
      type: row.kind || "index",
      is_unique: false,
    }));

    let sampleDocuments = [];
    try {
      const sample = await this.client.execute(
        `SELECT * FROM ${this._quote(keyspace)}.${this._quote(collectionName)} LIMIT 20`,
      );
      sampleDocuments = sample.rows || [];
    } catch (error) {
      logger.debug("Cassandra sample query failed:", error.message || error);
    }

    return {
      db_name: keyspace,
      table_name: collectionName,
      columns,
      indexes,
      foreign_keys: [],
      triggers: [],
      sampleDocuments,
    };
  }

  async getTables(dbName) {
    return this.getCollections(dbName);
  }

  async getTableInfo(dbName, tableName) {
    return this.getCollectionInfo(dbName, tableName);
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    const details = [];
    for (const name of tableNames || []) {
      details.push(await this.getCollectionInfo(dbName, name));
    }
    return details;
  }

  async _executeQueryImpl(query, options = {}) {
    if (!this.client) throw new Error("Cassandra connection not initialized");
    const normalized = this._normalizeQuery(query, options);

    if (normalized.operation === "query") {
      const result = await this.client.execute(normalized.statement, normalized.params, {
        prepare: true,
        consistency: normalized.consistency,
      });
      return { rows: result.rows || [], totalRows: result.rowLength };
    }

    const keyspace = normalized.keyspace || this.currentDatabase;
    if (!keyspace) throw new Error("Cassandra keyspace is required.");
    const table = normalized.table;
    if (!table) throw new Error("Cassandra table is required.");

    switch (normalized.operation) {
      case "select": {
        const { whereClause, params } = this._buildWhereClause(normalized.where);
        const limit = normalized.limit ? ` LIMIT ${Number(normalized.limit)}` : "";
        const statement = `SELECT * FROM ${this._quote(keyspace)}.${this._quote(table)}${whereClause}${limit}`;
        const result = await this.client.execute(statement, params, { prepare: true });
        return { rows: result.rows || [], totalRows: result.rowLength };
      }
      case "insert": {
        const values = normalized.values || {};
        const columns = Object.keys(values);
        if (columns.length === 0) throw new Error("Cassandra values are required.");
        const placeholders = columns.map(() => "?").join(", ");
        const params = columns.map((col) => values[col]);
        const statement = `INSERT INTO ${this._quote(keyspace)}.${this._quote(table)} (${columns
          .map((col) => this._quote(col))
          .join(", ")}) VALUES (${placeholders})`;
        await this.client.execute(statement, params, { prepare: true });
        return { inserted: true };
      }
      case "update": {
        const values = normalized.values || {};
        const setColumns = Object.keys(values);
        if (setColumns.length === 0) throw new Error("Cassandra update values are required.");
        const { whereClause, params: whereParams } = this._buildWhereClause(normalized.where);
        if (!whereClause) throw new Error("Cassandra update requires a where clause.");
        const setClause = setColumns.map((col) => `${this._quote(col)} = ?`).join(", ");
        const params = [...setColumns.map((col) => values[col]), ...whereParams];
        const statement = `UPDATE ${this._quote(keyspace)}.${this._quote(table)} SET ${setClause}${whereClause}`;
        await this.client.execute(statement, params, { prepare: true });
        return { updated: true };
      }
      case "delete": {
        const { whereClause, params } = this._buildWhereClause(normalized.where);
        if (!whereClause) throw new Error("Cassandra delete requires a where clause.");
        const statement = `DELETE FROM ${this._quote(keyspace)}.${this._quote(table)}${whereClause}`;
        await this.client.execute(statement, params, { prepare: true });
        return { deleted: true };
      }
      default:
        throw new Error(`Unsupported Cassandra operation: ${normalized.operation}`);
    }
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "query", statement: query, params: [] };
    }

    const payload = query?.payload || {};
    const operation = (
      query?.operation ||
      query?.action ||
      payload.operation ||
      payload.action ||
      "query"
    )
      .toString()
      .toLowerCase();

    return {
      operation,
      statement: query?.statement || query?.query || payload.statement || payload.query || "",
      params: query?.params || payload.params || [],
      keyspace: query?.keyspace || payload.keyspace || query?.database || payload.database,
      table: query?.table || query?.collection || payload.table || payload.collection,
      values: query?.values || payload.values,
      where: query?.where || payload.where,
      limit: query?.limit || payload.limit || options?.pageSize,
      consistency: query?.consistency || payload.consistency,
    };
  }

  _buildWhereClause(where) {
    if (!where) return { whereClause: "", params: [] };
    if (Array.isArray(where)) {
      const clauses = [];
      const params = [];
      for (const entry of where) {
        if (entry && typeof entry === "object") {
          const op = entry.operator || entry.op || "=";
          clauses.push(`${this._quote(entry.field)} ${op} ?`);
          params.push(entry.value);
        }
      }
      return clauses.length
        ? { whereClause: ` WHERE ${clauses.join(" AND ")}`, params }
        : { whereClause: "", params };
    }

    if (typeof where === "object") {
      const columns = Object.keys(where);
      if (columns.length === 0) return { whereClause: "", params: [] };
      const clauses = columns.map((col) => `${this._quote(col)} = ?`);
      const params = columns.map((col) => where[col]);
      return { whereClause: ` WHERE ${clauses.join(" AND ")}`, params };
    }

    return { whereClause: "", params: [] };
  }

  _quote(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
  }
}

module.exports = CassandraStrategy;
