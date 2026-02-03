const logger = require("../../utils/logger");
const { buildColumnsFromRecords } = require("../../utils/metadata-sampler");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

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
    } catch {
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

    const fields = buildColumnsFromRecords(sampleDocuments);

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
      case "view": {
        if (!normalized.designDoc || !normalized.view) {
          throw new Error("CouchDB view requires designDoc and view name.");
        }
        const result = await db.view(
          normalized.designDoc,
          normalized.view,
          normalized.params || {},
        );
        return {
          rows: result.rows || [],
          totalRows: result.total_rows ?? result.rows?.length ?? 0,
          offset: result.offset ?? 0,
        };
      }
      case "changes": {
        const result = await db.changes(normalized.params || {});
        return {
          changes: result.results || [],
          lastSeq: result.last_seq,
          pending: result.pending,
        };
      }
      case "attachmentget": {
        if (!normalized.id || !normalized.attachmentName) {
          throw new Error("CouchDB attachment get requires id and attachmentName.");
        }
        const data = await db.attachment.get(
          normalized.id,
          normalized.attachmentName,
          normalized.params || {},
        );
        return { id: normalized.id, attachmentName: normalized.attachmentName, data };
      }
      case "attachmentinsert": {
        if (!normalized.id || !normalized.attachmentName) {
          throw new Error("CouchDB attachment insert requires id and attachmentName.");
        }
        if (normalized.data === undefined) {
          throw new Error("CouchDB attachment insert requires data.");
        }
        const contentType = normalized.contentType || "application/octet-stream";
        const payload =
          normalized.encoding === "base64"
            ? Buffer.from(String(normalized.data), "base64")
            : normalized.data;
        const result = await db.attachment.insert(
          normalized.id,
          normalized.attachmentName,
          payload,
          contentType,
          normalized.params || {},
        );
        return { result };
      }
      case "attachmentdelete": {
        if (!normalized.id || !normalized.attachmentName || !normalized.rev) {
          throw new Error("CouchDB attachment delete requires id, attachmentName, and rev.");
        }
        const result = await db.attachment.destroy(
          normalized.id,
          normalized.attachmentName,
          normalized.rev,
        );
        return { result };
      }
      case "createindex": {
        if (!normalized.index) {
          throw new Error("CouchDB createIndex requires index definition.");
        }
        const result = await db.createIndex(normalized.index);
        return { result };
      }
      case "deleteindex": {
        if (!normalized.indexName || !normalized.designDoc) {
          throw new Error("CouchDB deleteIndex requires designDoc and indexName.");
        }
        if (typeof db.deleteIndex === "function") {
          const result = await db.deleteIndex(normalized.designDoc, normalized.indexName);
          return { result };
        }
        if (typeof db.request === "function") {
          const result = await db.request({
            method: "DELETE",
            path: `_index/${normalized.designDoc}/json/${normalized.indexName}`,
          });
          return { result };
        }
        throw new Error("CouchDB deleteIndex is not supported by this driver.");
      }
      case "listindexes": {
        const result = await db.getIndexes();
        return { indexes: result.indexes || [] };
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
    const { raw, payload } = getQueryParts(query);
    const operation = resolveOperation(raw, payload, { defaultOperation: "find" });

    return {
      operation,
      database: raw.database || payload.database || raw.dbName,
      id: raw.id || payload.id,
      rev: raw.rev || payload.rev,
      designDoc: raw.designDoc || payload.designDoc || raw.ddoc || payload.ddoc,
      view: raw.view || payload.view,
      filter: raw.selector || payload.selector || raw.filter,
      document: raw.document || payload.document,
      documents: raw.documents || payload.documents,
      params: raw.params || payload.params || raw.options || payload.options || {},
      attachmentName: raw.attachmentName || payload.attachmentName || raw.attachment,
      contentType: raw.contentType || payload.contentType,
      data: raw.data || payload.data,
      encoding: raw.encoding || payload.encoding,
      index: raw.index || payload.index,
      indexName: raw.indexName || payload.indexName,
      options,
    };
  }
}

module.exports = CouchDBStrategy;
