const logger = require("../../utils/logger");

const NoSQLStrategy = require("./base/nosql-strategy");

class CouchDBStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let nano;
    try {
      nano = require("nano");
    } catch (error) {
      throw new Error(
        "CouchDB driver not installed. Add 'nano' to dependencies to enable CouchDB support.",
      );
    }

    const url = this._buildUrl(config);
    this.client = nano(url);
    this.connectionConfig = config;
    this.currentDatabase = config.database || null;
    logger.info("CouchDB connection initialized");
  }

  async disconnect() {
    this.client = null;
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.db.list();
      return true;
    } catch (err) {
      logger.error("CouchDB connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("CouchDB connection not initialized");
    const dbs = await this.client.db.list();
    return (dbs || []).map((name) => ({
      name,
      sizeOnDisk: 0,
      tables: [],
      views: [],
    }));
  }

  async switchDatabase(dbName) {
    if (!this.client) throw new Error("CouchDB connection not initialized");
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections() {
    if (!this.client) throw new Error("CouchDB connection not initialized");
    return this.client.db.list();
  }

  async getCollectionInfo(dbName, collectionName) {
    if (!this.client) throw new Error("CouchDB connection not initialized");
    const targetDb = dbName || this.currentDatabase || collectionName;
    if (!targetDb) throw new Error("No database selected for CouchDB.");
    const db = this.client.use(targetDb);

    let sampleDocuments = [];
    try {
      const list = await db.list({ include_docs: true, limit: 20 });
      sampleDocuments = (list.rows || []).map((row) => row.doc).filter(Boolean);
    } catch (error) {
      logger.debug("CouchDB sample docs failed:", error.message || error);
      sampleDocuments = [];
    }

    let indexes = [];
    try {
      const idx = await db.getIndexes();
      indexes = (idx.indexes || []).map((entry) => ({
        index_name: entry.name,
        type: entry.type,
        is_unique: false,
      }));
    } catch {
      indexes = [];
    }

    const fields = Object.entries(this._inferFieldTypes(sampleDocuments)).map(
      ([name, dataType]) => ({
        column_name: name,
        data_type: dataType,
      }),
    );

    return {
      db_name: targetDb,
      table_name: targetDb,
      columns: fields,
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
    if (!this.client) throw new Error("CouchDB connection not initialized");
    const normalized = this._normalizeQuery(query, options);
    const dbName = normalized.database || this.currentDatabase;
    if (!dbName) throw new Error("CouchDB database is required.");
    const db = this.client.use(dbName);

    switch (normalized.operation) {
      case "find": {
        const result = await db.find({
          selector: normalized.filter || {},
          ...normalized.options,
        });
        return { documents: result.docs || [], totalRows: result.docs?.length || 0 };
      }
      case "get": {
        if (!normalized.id) throw new Error("CouchDB document id is required.");
        const doc = await db.get(normalized.id);
        return { documents: doc ? [doc] : [] };
      }
      case "insert": {
        if (!normalized.document) throw new Error("CouchDB document is required.");
        const result = await db.insert(normalized.document);
        return { inserted: Boolean(result?.ok), id: result?.id };
      }
      case "update": {
        if (!normalized.document) throw new Error("CouchDB document is required.");
        const result = await db.insert(normalized.document);
        return { updated: Boolean(result?.ok), id: result?.id };
      }
      case "delete": {
        const id = normalized.id || normalized.document?._id;
        const rev = normalized.rev || normalized.document?._rev;
        if (!id || !rev) {
          throw new Error("CouchDB delete requires id and rev.");
        }
        const result = await db.destroy(id, rev);
        return { deleted: Boolean(result?.ok), id: result?.id };
      }
      case "bulk": {
        if (!Array.isArray(normalized.documents)) {
          throw new Error("CouchDB bulk requires documents array.");
        }
        const result = await db.bulk({ docs: normalized.documents });
        return { result };
      }
      default:
        throw new Error(`Unsupported CouchDB operation: ${normalized.operation}`);
    }
  }

  _buildUrl(config = {}) {
    if (config.url) return config.url;
    const host = this.normalizeHost(config.host || "localhost");
    const port = config.port || 5984;
    const auth =
      config.username && config.password
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
        : "";
    return `http://${auth}${host}:${port}`;
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "find", filter: { _id: query } };
    }
    const payload = query?.payload || {};
    const operation = (
      query?.operation ||
      query?.action ||
      payload.operation ||
      payload.action ||
      "find"
    )
      .toString()
      .toLowerCase();

    return {
      operation,
      database: query?.database || payload.database || query?.dbName,
      id: query?.id || payload.id,
      rev: query?.rev || payload.rev,
      filter: query?.selector || payload.selector || query?.filter,
      document: query?.document || payload.document,
      documents: query?.documents || payload.documents,
      options,
    };
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

module.exports = CouchDBStrategy;
