const logger = require("../../utils/logger");

const NoSQLStrategy = require("./base/nosql-strategy");

class HBaseStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let hbase;
    try {
      hbase = require("hbase");
    } catch {
      throw new Error(
        "HBase driver not installed. Add 'hbase' to dependencies to enable HBase support.",
      );
    }

    const host = this.normalizeHost(config.host || "localhost");
    const port = config.port || 9090;
    const protocol = config.protocol || "http";
    this.client = hbase({ host, port, protocol });
    this.connectionConfig = config;
    this.currentDatabase = config.database || "default";
    logger.info("HBase connection initialized");
  }

  async disconnect() {
    this.client = null;
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this._wrapCallback((cb) => this.client.tables(cb));
      return true;
    } catch (err) {
      logger.error("HBase connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("HBase connection not initialized");
    const tables = await this.getCollections();
    return [
      {
        name: this.currentDatabase || "default",
        sizeOnDisk: 0,
        tables: tables.map((name) => ({ name })),
        views: [],
      },
    ];
  }

  async switchDatabase(dbName) {
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections(dbName) {
    if (!this.client) throw new Error("HBase connection not initialized");
    if (dbName) {
      this.currentDatabase = dbName;
    }
    const tables = await this._wrapCallback((cb) => this.client.tables(cb));
    const namespace = this.currentDatabase || "default";
    return tables
      .map((table) => (typeof table === "string" ? table : table.name))
      .filter(Boolean)
      .filter((name) => {
        if (!namespace || namespace === "default") return true;
        return name.startsWith(`${namespace}:`);
      })
      .map((name) => name.replace(`${namespace}:`, ""));
  }

  async getCollectionInfo(dbName, collectionName) {
    if (!this.client) throw new Error("HBase connection not initialized");
    const namespace = dbName || this.currentDatabase || "default";
    if (!collectionName) throw new Error("Table name is required for HBase.");
    const tableName =
      namespace && namespace !== "default" ? `${namespace}:${collectionName}` : collectionName;
    const table = this.client.table(tableName);

    let sampleDocuments = [];
    try {
      const rows = await this._wrapCallback((cb) => table.scan({ maxVersions: 1, limit: 20 }, cb));
      sampleDocuments = rows.map((row) => this._formatRow(row));
    } catch (error) {
      logger.debug("HBase scan failed:", error.message || error);
      sampleDocuments = [];
    }

    const fields = Object.entries(this._inferFieldTypes(sampleDocuments)).map(
      ([name, dataType]) => ({
        column_name: name,
        data_type: dataType,
      }),
    );

    return {
      db_name: namespace,
      table_name: collectionName,
      columns: fields,
      indexes: [],
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
    if (!this.client) throw new Error("HBase connection not initialized");
    const normalized = this._normalizeQuery(query, options);
    const namespace = normalized.database || this.currentDatabase || "default";
    if (!normalized.table) throw new Error("HBase table is required.");
    const tableName =
      namespace && namespace !== "default" ? `${namespace}:${normalized.table}` : normalized.table;
    const table = this.client.table(tableName);

    switch (normalized.operation) {
      case "get": {
        if (!normalized.rowKey) throw new Error("HBase rowKey is required.");
        const getOptions = {};
        if (normalized.columns?.length) getOptions.columns = normalized.columns;
        if (Number.isFinite(Number(normalized.maxVersions))) {
          getOptions.maxVersions = Number(normalized.maxVersions);
        }
        const cells = await this._wrapCallback((cb) => {
          if (Object.keys(getOptions).length > 0) {
            table.row(normalized.rowKey).get(getOptions, cb);
          } else {
            table.row(normalized.rowKey).get(cb);
          }
        });
        return { documents: [this._formatRow({ key: normalized.rowKey, columns: cells })] };
      }
      case "scan": {
        const scanOptions = {
          maxVersions: Number.isFinite(Number(normalized.maxVersions))
            ? Number(normalized.maxVersions)
            : 1,
          limit: normalized.limit || options?.pageSize || 20,
        };
        if (normalized.startRow) scanOptions.startRow = normalized.startRow;
        if (normalized.endRow) scanOptions.endRow = normalized.endRow;
        if (normalized.columns?.length) scanOptions.columns = normalized.columns;
        if (normalized.filter) scanOptions.filter = normalized.filter;
        const rows = await this._wrapCallback((cb) => table.scan(scanOptions, cb));
        const documents = rows.map((row) => this._formatRow(row));
        return { documents, totalRows: documents.length };
      }
      case "put":
      case "insert":
      case "update": {
        if (!normalized.rowKey) throw new Error("HBase rowKey is required.");
        if (!normalized.values || typeof normalized.values !== "object") {
          throw new Error("HBase values are required.");
        }
        await this._wrapCallback((cb) => table.row(normalized.rowKey).put(normalized.values, cb));
        return { written: true };
      }
      case "increment": {
        if (!normalized.rowKey) throw new Error("HBase rowKey is required.");
        if (!normalized.values || typeof normalized.values !== "object") {
          throw new Error("HBase increment requires values.");
        }
        if (typeof table.row(normalized.rowKey).increment !== "function") {
          throw new Error("HBase increment not supported by this driver.");
        }
        const result = await this._wrapCallback((cb) =>
          table.row(normalized.rowKey).increment(normalized.values, cb),
        );
        return { result };
      }
      case "append": {
        if (!normalized.rowKey) throw new Error("HBase rowKey is required.");
        if (!normalized.values || typeof normalized.values !== "object") {
          throw new Error("HBase append requires values.");
        }
        if (typeof table.row(normalized.rowKey).append !== "function") {
          throw new Error("HBase append not supported by this driver.");
        }
        const result = await this._wrapCallback((cb) =>
          table.row(normalized.rowKey).append(normalized.values, cb),
        );
        return { result };
      }
      case "delete": {
        if (!normalized.rowKey) throw new Error("HBase rowKey is required.");
        await this._wrapCallback((cb) => table.row(normalized.rowKey).delete(cb));
        return { deleted: true };
      }
      default:
        throw new Error(`Unsupported HBase operation: ${normalized.operation}`);
    }
  }

  _normalizeQuery(query, _options = {}) {
    if (typeof query === "string") {
      return { operation: "scan", table: query };
    }

    const payload = query?.payload || {};
    const operation = (
      query?.operation ||
      query?.action ||
      payload.operation ||
      payload.action ||
      "scan"
    )
      .toString()
      .toLowerCase();

    return {
      operation,
      table: query?.table || query?.collection || payload.table || payload.collection,
      database: query?.database || payload.database,
      rowKey: query?.rowKey || payload.rowKey || query?.key || payload.key,
      values: query?.values || payload.values || query?.document || payload.document,
      startRow: query?.startRow || payload.startRow,
      endRow: query?.endRow || payload.endRow,
      limit: query?.limit || payload.limit,
      columns: this._normalizeColumns(query?.columns || payload.columns),
      filter: query?.filter || payload.filter,
      maxVersions: query?.maxVersions || payload.maxVersions,
    };
  }

  _normalizeColumns(columns) {
    if (!columns) return [];
    if (Array.isArray(columns)) return columns;
    return [columns];
  }

  _wrapCallback(fn) {
    return new Promise((resolve, reject) => {
      fn((err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  }

  _formatRow(row) {
    if (!row) return {};
    const formatted = { rowKey: row.key || row.row || row.id || "" };
    const columns = row.columns || row;
    if (Array.isArray(columns)) {
      for (const cell of columns) {
        const name = cell.column || cell.name || cell.qualifier;
        if (!name) continue;
        formatted[name] = cell.$ !== undefined ? cell.$ : (cell.value ?? cell);
      }
      return formatted;
    }
    if (columns && typeof columns === "object") {
      for (const [key, value] of Object.entries(columns)) {
        if (key === "key") continue;
        formatted[key] = value?.$ || value;
      }
    }
    return formatted;
  }

  _inferFieldTypes(documents) {
    const map = {};
    for (const doc of documents || []) {
      if (!doc || typeof doc !== "object") continue;
      for (const [key, value] of Object.entries(doc)) {
        if (!map[key]) {
          map[key] = this._typeOfValue(value);
        }
      }
    }
    return map;
  }

  _typeOfValue(value) {
    if (Array.isArray(value)) return "array";
    if (value === null) return "null";
    const type = typeof value;
    if (type === "object") return "object";
    return type;
  }
}

module.exports = HBaseStrategy;
