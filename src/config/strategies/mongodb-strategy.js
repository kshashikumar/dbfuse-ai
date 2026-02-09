// db_strategies/mongodb-strategy.js
const logger = require("../../utils/logger");
const { buildColumnsFromRecords } = require("../../utils/metadata-sampler");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

const NoSQLStrategy = require("./base/nosql-strategy");

class MongoDBStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let MongoClient;
    try {
      ({ MongoClient } = require("mongodb"));
    } catch {
      throw new Error(
        "MongoDB driver not installed. Add 'mongodb' to dependencies to enable MongoDB support.",
      );
    }

    const url = this._buildMongoUrl(config);
    this.client = new MongoClient(url, {
      maxPoolSize: config.poolSize || 10,
      serverSelectionTimeoutMS: config.connectionTimeout || 5000,
    });
    await this.client.connect();
    this.connectionConfig = config;
    this.currentDatabase = config.database || null;
    logger.info("MongoDB connection established");
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.db("admin").command({ ping: 1 });
      return true;
    } catch (err) {
      logger.error("MongoDB connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("MongoDB connection not initialized");
    const adminDb = this.client.db("admin");
    const admin = typeof adminDb.admin === "function" ? adminDb.admin() : this.client.db().admin();
    try {
      const dbs = await admin.listDatabases();
      const results = [];

      for (const db of dbs.databases || []) {
        const dbName = db.name;
        let collections = [];
        try {
          collections = await this.getCollections(dbName);
        } catch {
          collections = [];
        }
        results.push({
          name: dbName,
          sizeOnDisk: db.sizeOnDisk || 0,
          tables: collections.map((name) => ({ name })),
          views: [],
        });
      }

      return results;
    } catch (error) {
      logger.warn("MongoDB listDatabases failed, falling back to current database", error);
      const fallbackDb = this.currentDatabase || this.connectionConfig?.database;
      if (!fallbackDb) {
        throw error;
      }
      let collections = [];
      try {
        collections = await this.getCollections(fallbackDb);
      } catch {
        collections = [];
      }
      return [
        {
          name: fallbackDb,
          sizeOnDisk: 0,
          tables: collections.map((name) => ({ name })),
          views: [],
          error: "listDatabases failed; showing current database only.",
        },
      ];
    }
  }

  async switchDatabase(dbName) {
    if (!this.client) throw new Error("MongoDB connection not initialized");
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections(dbName) {
    if (!this.client) throw new Error("MongoDB connection not initialized");
    const targetDb = dbName || this.currentDatabase || this.connectionConfig?.database;
    if (!targetDb) {
      throw new Error("No database selected for MongoDB collections.");
    }
    this.currentDatabase = targetDb;
    const collections = await this.client.db(targetDb).listCollections().toArray();
    return collections.map((col) => col.name);
  }

  async getCollectionInfo(dbName, collectionName) {
    if (!this.client) throw new Error("MongoDB connection not initialized");
    const targetDb = dbName || this.currentDatabase || this.connectionConfig?.database;
    if (!targetDb) {
      throw new Error("No database selected for MongoDB collection info.");
    }

    const collection = this.client.db(targetDb).collection(collectionName);
    try {
      const sample = await collection.find({}).limit(20).toArray();
      const fields = buildColumnsFromRecords(sample);

      let indexes = [];
      try {
        indexes = await collection.indexes();
      } catch {
        indexes = [];
      }

      let documentCount = null;
      try {
        documentCount = await collection.estimatedDocumentCount();
      } catch {
        documentCount = null;
      }

      return {
        db_name: targetDb,
        table_name: collectionName,
        columns: fields,
        indexes: indexes.map((idx) => ({
          index_name: idx.name,
          is_unique: Boolean(idx.unique),
          type: idx?.key ? Object.keys(idx.key).join(",") : undefined,
        })),
        foreign_keys: [],
        triggers: [],
        sampleDocuments: sample,
        documentCount,
      };
    } catch (error) {
      const message = error?.message || "Failed to load collection info.";
      if (String(message).toLowerCase().includes("not authorized")) {
        logger.warn(`MongoDB collection access denied: ${targetDb}.${collectionName}`);
        return {
          db_name: targetDb,
          table_name: collectionName,
          columns: [],
          indexes: [],
          foreign_keys: [],
          triggers: [],
          sampleDocuments: [],
          documentCount: null,
          error: "Not authorized to read this collection.",
        };
      }
      throw error;
    }
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
      const info = await this.getTableInfo(dbName, name);
      details.push(info);
    }
    return details;
  }

  async _executeQueryImpl(query, options = {}) {
    if (!this.client) throw new Error("MongoDB connection not initialized");

    const normalized = this._normalizeMongoQuery(query, options);
    const operation = normalized.operation;
    const db = this._resolveDatabase(normalized.database);
    const collection = normalized.collection ? db.collection(normalized.collection) : null;

    if (!operation) {
      throw new Error("MongoDB operation is required");
    }

    const op = operation.toLowerCase();

    switch (op) {
      case "find": {
        if (!collection) throw new Error("MongoDB collection is required");
        const { filter, projection, sort, pagination } = normalized;
        try {
          let cursor = collection.find(filter || {}, projection ? { projection } : undefined);
          if (sort) cursor = cursor.sort(sort);
          if (pagination.skip > 0) cursor = cursor.skip(pagination.skip);
          if (pagination.limit > 0) cursor = cursor.limit(pagination.limit);

          const documents = await cursor.toArray();
          const includeTotal = normalized.options.includeTotal ?? pagination.hasPaging;
          const totalRows = includeTotal ? await collection.countDocuments(filter || {}) : null;

          return {
            documents,
            totalRows,
            pagination: pagination.hasPaging
              ? {
                  page: pagination.page,
                  pageSize: pagination.limit,
                  totalPages: totalRows ? Math.ceil(totalRows / pagination.limit) : null,
                  hasMore: totalRows ? pagination.page * pagination.limit < totalRows : null,
                }
              : null,
          };
        } catch (error) {
          if (this._isNotAuthorized(error)) {
            logger.warn(
              `MongoDB find access denied: ${this.currentDatabase}.${normalized.collection}`,
            );
            return {
              documents: [],
              totalRows: null,
              pagination: pagination.hasPaging
                ? {
                    page: pagination.page,
                    pageSize: pagination.limit,
                    totalPages: null,
                    hasMore: null,
                  }
                : null,
              error: "Not authorized to read this collection.",
            };
          }
          throw error;
        }
      }
      case "findone": {
        if (!collection) throw new Error("MongoDB collection is required");
        const document = await collection.findOne(
          normalized.filter || {},
          normalized.projection ? { projection: normalized.projection } : undefined,
        );
        return { documents: document ? [document] : [], totalRows: document ? 1 : 0 };
      }
      case "findoneandupdate": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!normalized.update) throw new Error("MongoDB update document is required");
        const result = await collection.findOneAndUpdate(
          normalized.filter || {},
          normalized.update,
          {
            ...normalized.options,
            returnDocument: normalized.options?.returnDocument || "after",
          },
        );
        return {
          documents: result?.value ? [result.value] : [],
          lastErrorObject: result?.lastErrorObject,
          ok: result?.ok,
        };
      }
      case "findoneanddelete": {
        if (!collection) throw new Error("MongoDB collection is required");
        const result = await collection.findOneAndDelete(normalized.filter || {}, {
          ...normalized.options,
        });
        return {
          documents: result?.value ? [result.value] : [],
          ok: result?.ok,
        };
      }
      case "aggregate": {
        if (!collection) throw new Error("MongoDB collection is required");
        const pipeline = Array.isArray(normalized.pipeline) ? [...normalized.pipeline] : [];
        if (normalized.pagination.hasPaging) {
          pipeline.push({ $skip: normalized.pagination.skip });
          pipeline.push({ $limit: normalized.pagination.limit });
        }
        const documents = await collection.aggregate(pipeline).toArray();
        return { documents, totalRows: documents.length };
      }
      case "insertone": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!normalized.document) throw new Error("MongoDB document is required");
        const response = await collection.insertOne(normalized.document);
        return {
          insertedCount: response.insertedId ? 1 : 0,
          insertedIds: response.insertedId ? [response.insertedId] : [],
        };
      }
      case "insertmany": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!Array.isArray(normalized.documents) || normalized.documents.length === 0) {
          throw new Error("MongoDB documents array is required");
        }
        const response = await collection.insertMany(normalized.documents);
        const insertedIds = response.insertedIds ? Object.values(response.insertedIds) : [];
        return {
          insertedCount: response.insertedCount || insertedIds.length,
          insertedIds,
        };
      }
      case "updateone":
      case "updatemany": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!normalized.update) throw new Error("MongoDB update document is required");
        const handler = op === "updateone" ? "updateOne" : "updateMany";
        const response = await collection[handler](normalized.filter || {}, normalized.update, {
          upsert: Boolean(normalized.options.upsert),
        });
        return {
          matchedCount: response.matchedCount || 0,
          modifiedCount: response.modifiedCount || 0,
          upsertedId: response.upsertedId || null,
        };
      }
      case "replaceone": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!normalized.document) throw new Error("MongoDB replacement document is required");
        const response = await collection.replaceOne(normalized.filter || {}, normalized.document, {
          upsert: Boolean(normalized.options.upsert),
        });
        return {
          matchedCount: response.matchedCount || 0,
          modifiedCount: response.modifiedCount || 0,
          upsertedId: response.upsertedId || null,
        };
      }
      case "deleteone":
      case "deletemany": {
        if (!collection) throw new Error("MongoDB collection is required");
        const handler = op === "deleteone" ? "deleteOne" : "deleteMany";
        const response = await collection[handler](normalized.filter || {});
        return {
          deletedCount: response.deletedCount || 0,
        };
      }
      case "bulkwrite": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!Array.isArray(normalized.operations) || normalized.operations.length === 0) {
          throw new Error("MongoDB bulkWrite operations array is required");
        }
        const result = await collection.bulkWrite(normalized.operations, normalized.options || {});
        return { result };
      }
      case "createcollection": {
        if (!normalized.collection) throw new Error("MongoDB collection is required");
        const created = await db.createCollection(
          normalized.collection,
          normalized.collectionOptions || {},
        );
        return {
          created: Boolean(created?.collectionName || created?.namespace),
          name: normalized.collection,
        };
      }
      case "dropcollection": {
        if (!normalized.collection) throw new Error("MongoDB collection is required");
        const dropped = await db.dropCollection(normalized.collection);
        return { dropped: Boolean(dropped), name: normalized.collection };
      }
      case "renamecollection": {
        if (!normalized.collection || !normalized.newName) {
          throw new Error("MongoDB collection and newName are required");
        }
        const renamed = await db
          .collection(normalized.collection)
          .rename(normalized.newName, { dropTarget: Boolean(normalized.dropTarget) });
        return {
          renamed: Boolean(renamed?.collectionName || renamed?.namespace),
          from: normalized.collection,
          to: normalized.newName,
        };
      }
      case "count": {
        if (!collection) throw new Error("MongoDB collection is required");
        const count = await collection.countDocuments(normalized.filter || {});
        return { totalRows: count };
      }
      case "distinct": {
        if (!collection) throw new Error("MongoDB collection is required");
        if (!normalized.field) throw new Error("MongoDB field is required");
        const values = await collection.distinct(normalized.field, normalized.filter || {});
        return { values, totalRows: values.length };
      }
      case "createindex": {
        if (!collection) throw new Error("MongoDB collection is required");
        const indexKeys = normalized.indexKeys || normalized.keys;
        if (!indexKeys) throw new Error("MongoDB index keys are required");
        const indexOptions = normalized.indexOptions || {};
        const indexName = await collection.createIndex(indexKeys, indexOptions);
        return { indexName };
      }
      case "dropindex": {
        if (!collection) throw new Error("MongoDB collection is required");
        const indexName = normalized.indexName;
        if (!indexName) throw new Error("MongoDB index name is required");
        await collection.dropIndex(indexName);
        return { dropped: indexName };
      }
      case "explain": {
        if (!collection) throw new Error("MongoDB collection is required");
        const explainPayload = normalized.explain || {};
        const explainOperation = (explainPayload.operation || "find").toLowerCase();
        if (explainOperation === "aggregate") {
          const pipeline = Array.isArray(explainPayload.pipeline)
            ? explainPayload.pipeline
            : normalized.pipeline || [];
          const result = await collection.aggregate(pipeline).explain();
          return { raw: result };
        }

        const filter = explainPayload.filter || normalized.filter || {};
        const projection = explainPayload.projection || normalized.projection;
        const sort = explainPayload.sort || normalized.sort;
        let cursor = collection.find(filter, projection ? { projection } : undefined);
        if (sort) cursor = cursor.sort(sort);
        const result = await cursor.explain();
        return { raw: result };
      }
      case "command": {
        const commandPayload = normalized.command || normalized.payload;
        if (!commandPayload || typeof commandPayload !== "object") {
          throw new Error("MongoDB command payload is required");
        }
        const result = await db.command(commandPayload);
        return { raw: result };
      }
      default:
        throw new Error(`Unsupported MongoDB operation: ${operation}`);
    }
  }

  _buildMongoUrl(config = {}) {
    if (config.url) return config.url;
    const host = config.host || "localhost";
    const port = config.port || 27017;
    const dbName = config.database || "";
    const auth =
      config.username && config.password
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
        : "";
    return `mongodb://${auth}${host}:${port}/${dbName}`;
  }

  _normalizeMongoQuery(query, options = {}) {
    const { raw, payload } = getQueryParts(query);
    const mergedOptions = {
      ...options,
      ...(raw.options && typeof raw.options === "object" ? raw.options : {}),
      ...(payload.options && typeof payload.options === "object" ? payload.options : {}),
    };

    const pagination = this._buildPagination(mergedOptions);

    const normalizedOperation = resolveOperation(raw, payload, {
      defaultOperation: null,
      commandFallback: true,
      coerceNonString: false,
    });

    return {
      mode: raw.mode || payload.mode || raw.type,
      operation: normalizedOperation,
      collection: raw.collection || payload.collection || raw.table,
      database: raw.database || raw.dbName || payload.database,
      filter: raw.filter || payload.filter || payload.query || raw.criteria,
      document: raw.document || payload.document,
      documents: raw.documents || payload.documents,
      update: raw.update || payload.update,
      pipeline: raw.pipeline || payload.pipeline,
      projection: raw.projection || payload.projection,
      sort: raw.sort || payload.sort,
      field: raw.field || payload.field,
      keys: raw.keys || payload.keys,
      indexKeys: raw.indexKeys || payload.indexKeys,
      indexOptions: raw.indexOptions || payload.indexOptions,
      indexName: raw.indexName || payload.indexName,
      operations: raw.operations || payload.operations || raw.bulkOps || payload.bulkOps,
      collectionOptions: raw.collectionOptions || payload.collectionOptions,
      newName: raw.newName || payload.newName || raw.renameTo || payload.renameTo,
      dropTarget: raw.dropTarget ?? payload.dropTarget,
      explain: raw.explain || payload.explain,
      command: raw.commandPayload || payload.command || raw.command,
      payload,
      options: mergedOptions,
      pagination,
    };
  }

  _buildPagination(options = {}) {
    const page = Math.max(1, parseInt(options.page) || 1);
    const pageSize = Math.max(1, parseInt(options.pageSize) || 0);
    const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : pageSize;
    const skip = Number.isFinite(Number(options.skip))
      ? Number(options.skip)
      : limit > 0
        ? (page - 1) * limit
        : 0;
    return {
      page,
      limit: limit || 0,
      skip: skip || 0,
      hasPaging: limit > 0,
    };
  }

  _resolveDatabase(dbName) {
    const targetDb = dbName || this.currentDatabase || this.connectionConfig?.database;
    if (!targetDb) {
      throw new Error("No database selected for MongoDB query.");
    }
    this.currentDatabase = targetDb;
    return this.client.db(targetDb);
  }

  _isNotAuthorized(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("not authorized") || message.includes("unauthorized");
  }

  /**
   * Fetch documents in a specific range for virtual scrolling
   * @param {string} collectionName - Collection name
   * @param {object} filter - MongoDB filter/query object
   * @param {number} offset - Starting document index (0-based)
   * @param {number} limit - Number of documents to fetch
   * @param {object} options - Additional options (sort, projection, etc.)
   * @returns {Promise<{rows: any[], hasMore: boolean, columns?: any[]}>}
   */
  async fetchRowRange(collectionName, filter = {}, offset, limit, options = {}) {
    if (!this.client) throw new Error("MongoDB connection not initialized");

    // Validate inputs
    if (offset < 0 || limit < 1 || limit > 1000) {
      throw new Error("Invalid range parameters");
    }

    const db = this._resolveDatabase(options.database);
    const collection = db.collection(collectionName);

    try {
      // Fetch one extra document to determine if there are more results
      const cursor = collection
        .find(filter)
        .skip(offset)
        .limit(limit + 1);

      // Apply sort if provided
      if (options.sort) {
        cursor.sort(options.sort);
      }

      // Apply projection if provided
      if (options.projection) {
        cursor.project(options.projection);
      }

      const docs = await cursor.toArray();
      const hasMore = docs.length > limit;

      // Remove extra document if present
      const resultRows = hasMore ? docs.slice(0, limit) : docs;

      // Extract column information from first document if available
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
      logger.error(`MongoDB fetchRowRange error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = MongoDBStrategy;
