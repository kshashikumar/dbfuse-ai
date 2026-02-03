const logger = require("../../utils/logger");
const { buildColumnsFromRecords } = require("../../utils/metadata-sampler");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

const NoSQLStrategy = require("./base/nosql-strategy");

class CosmosDBStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let CosmosClient;
    try {
      ({ CosmosClient } = require("@azure/cosmos"));
    } catch {
      throw new Error(
        "Azure Cosmos DB driver not installed. Add '@azure/cosmos' to dependencies to enable Cosmos DB support.",
      );
    }

    const endpoint = this._buildEndpoint(config);
    const key = config.key || config.primaryKey || config.password;
    if (!endpoint) throw new Error("Cosmos DB endpoint is required.");
    if (!key) throw new Error("Cosmos DB key is required.");

    this.client = new CosmosClient({
      endpoint,
      key,
      ...(config.consistency ? { consistencyLevel: config.consistency } : {}),
    });
    this.connectionConfig = config;
    this.currentDatabase = config.database || null;
    logger.info("Cosmos DB connection established");
  }

  async disconnect() {
    this.client = null;
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.getDatabaseAccount();
      return true;
    } catch (err) {
      logger.error("Cosmos DB connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("Cosmos DB connection not initialized");
    const result = await this.client.databases.readAll().fetchAll();
    const databases = result.resources || [];

    const entries = [];
    for (const db of databases) {
      let tables = [];
      try {
        const collections = await this.getCollections(db.id);
        tables = collections.map((name) => ({ name }));
      } catch {
        tables = [];
      }
      entries.push({
        name: db.id,
        sizeOnDisk: 0,
        tables,
        views: [],
      });
    }

    return entries;
  }

  async switchDatabase(dbName) {
    if (!this.client) throw new Error("Cosmos DB connection not initialized");
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections(dbName) {
    if (!this.client) throw new Error("Cosmos DB connection not initialized");
    const databaseId = dbName || this.currentDatabase;
    if (!databaseId) {
      throw new Error("No database selected for Cosmos DB containers.");
    }
    this.currentDatabase = databaseId;
    const result = await this.client.database(databaseId).containers.readAll().fetchAll();
    const containers = result.resources || [];
    return containers.map((container) => container.id);
  }

  async getCollectionInfo(dbName, collectionName) {
    if (!this.client) throw new Error("Cosmos DB connection not initialized");
    const databaseId = dbName || this.currentDatabase;
    if (!databaseId) throw new Error("No database selected for Cosmos DB.");
    if (!collectionName) throw new Error("Container name is required for Cosmos DB.");
    this.currentDatabase = databaseId;

    const container = this.client.database(databaseId).container(collectionName);
    let containerInfo = null;
    try {
      const read = await container.read();
      containerInfo = read.resource || null;
    } catch {
      containerInfo = null;
    }

    const sampleDocuments = await this._sampleDocuments(container);
    const fields = buildColumnsFromRecords(sampleDocuments);

    const indexes = [];
    if (containerInfo?.partitionKey?.paths?.length) {
      indexes.push({
        index_name: "partitionKey",
        type: "partitionKey",
        definition: containerInfo.partitionKey.paths.join(", "),
      });
    }
    if (containerInfo?.indexingPolicy) {
      indexes.push({
        index_name: "indexingPolicy",
        type: containerInfo.indexingPolicy.indexingMode || "policy",
        definition: JSON.stringify(containerInfo.indexingPolicy),
      });
    }

    return {
      db_name: databaseId,
      table_name: collectionName,
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
    if (!this.client) throw new Error("Cosmos DB connection not initialized");

    const normalized = this._normalizeQuery(query, options);
    const operation = normalized.operation;
    const databaseId = normalized.database || this.currentDatabase;
    if (!databaseId) throw new Error("Cosmos DB database is required.");

    const containerName = normalized.collection;
    if (!containerName) throw new Error("Cosmos DB container is required.");
    const container = this.client.database(databaseId).container(containerName);

    switch (operation) {
      case "query": {
        const queryOptions = {
          maxItemCount: normalized.limit || normalized.options?.pageSize,
          continuationToken: normalized.continuationToken,
          ...normalized.queryOptions,
        };
        const result = await container.items.query(normalized.statement, queryOptions).fetchAll();
        return {
          documents: result.resources || [],
          totalRows: Array.isArray(result.resources) ? result.resources.length : 0,
          continuationToken:
            result.continuationToken || result.headers?.["x-ms-continuation"] || null,
        };
      }
      case "create":
      case "insert": {
        if (!normalized.document) throw new Error("Cosmos DB document is required.");
        const response = await container.items.create(normalized.document);
        return { inserted: true, id: response.resource?.id };
      }
      case "upsert": {
        if (!normalized.document) throw new Error("Cosmos DB document is required.");
        const response = await container.items.upsert(normalized.document);
        return { upserted: true, id: response.resource?.id };
      }
      case "replace": {
        if (!normalized.id || !normalized.document) {
          throw new Error("Cosmos DB id and document are required.");
        }
        const response = await container
          .item(normalized.id, normalized.partitionKey)
          .replace(normalized.document);
        return { replaced: true, id: response.resource?.id };
      }
      case "patch": {
        if (!normalized.id || !Array.isArray(normalized.patch)) {
          throw new Error("Cosmos DB id and patch operations are required.");
        }
        const response = await container
          .item(normalized.id, normalized.partitionKey)
          .patch(normalized.patch);
        return { patched: true, id: response.resource?.id };
      }
      case "read":
      case "get": {
        if (!normalized.id) throw new Error("Cosmos DB id is required.");
        const response = await container.item(normalized.id, normalized.partitionKey).read();
        return { documents: response.resource ? [response.resource] : [] };
      }
      case "delete": {
        if (!normalized.id) throw new Error("Cosmos DB id is required.");
        await container.item(normalized.id, normalized.partitionKey).delete();
        return { deleted: true, id: normalized.id };
      }
      case "bulk": {
        if (!Array.isArray(normalized.operations)) {
          throw new Error("Cosmos DB bulk operations array is required.");
        }
        if (typeof container.items.bulk !== "function") {
          throw new Error("Cosmos DB bulk operations are not supported by this driver.");
        }
        const result = await container.items.bulk(normalized.operations);
        return { result };
      }
      case "createdatabase": {
        if (!databaseId) throw new Error("Cosmos DB database is required.");
        const result = await this.client.databases.create({ id: databaseId });
        return { database: result.resource };
      }
      case "deletedatabase": {
        if (!databaseId) throw new Error("Cosmos DB database is required.");
        await this.client.database(databaseId).delete();
        return { deleted: true, database: databaseId };
      }
      case "createcontainer": {
        if (!databaseId) throw new Error("Cosmos DB database is required.");
        if (!normalized.containerDefinition) {
          throw new Error("Cosmos DB containerDefinition is required.");
        }
        const options = { ...(normalized.options || {}) };
        if (Number.isFinite(Number(normalized.throughput))) {
          options.throughput = Number(normalized.throughput);
        }
        const result = await this.client
          .database(databaseId)
          .containers.create(normalized.containerDefinition, options);
        return { container: result.resource };
      }
      case "replacecontainer": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        if (!normalized.containerDefinition) {
          throw new Error("Cosmos DB containerDefinition is required.");
        }
        const result = await this.client
          .database(databaseId)
          .container(containerName)
          .replace(normalized.containerDefinition);
        return { container: result.resource };
      }
      case "deletecontainer": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        await this.client.database(databaseId).container(containerName).delete();
        return { deleted: true, container: containerName };
      }
      case "createstoredprocedure": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        if (!normalized.storedProcedureId || !normalized.body) {
          throw new Error("Cosmos DB storedProcedureId and body are required.");
        }
        const result = await this.client
          .database(databaseId)
          .container(containerName)
          .scripts.storedProcedures.create({
            id: normalized.storedProcedureId,
            body: normalized.body,
          });
        return { storedProcedure: result.resource };
      }
      case "replacestoredprocedure": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        if (!normalized.storedProcedureId || !normalized.body) {
          throw new Error("Cosmos DB storedProcedureId and body are required.");
        }
        const result = await this.client
          .database(databaseId)
          .container(containerName)
          .scripts.storedProcedure(normalized.storedProcedureId)
          .replace({ id: normalized.storedProcedureId, body: normalized.body });
        return { storedProcedure: result.resource };
      }
      case "deletestoredprocedure": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        if (!normalized.storedProcedureId) {
          throw new Error("Cosmos DB storedProcedureId is required.");
        }
        await this.client
          .database(databaseId)
          .container(containerName)
          .scripts.storedProcedure(normalized.storedProcedureId)
          .delete();
        return { deleted: true, storedProcedureId: normalized.storedProcedureId };
      }
      case "executestoredprocedure": {
        if (!databaseId || !containerName) {
          throw new Error("Cosmos DB database and container are required.");
        }
        if (!normalized.storedProcedureId) {
          throw new Error("Cosmos DB storedProcedureId is required.");
        }
        const result = await this.client
          .database(databaseId)
          .container(containerName)
          .scripts.storedProcedure(normalized.storedProcedureId)
          .execute(normalized.partitionKey, normalized.params || []);
        return { result: result.resource ?? result };
      }
      default:
        throw new Error(`Unsupported Cosmos DB operation: ${operation}`);
    }
  }

  _buildEndpoint(config = {}) {
    if (config.endpoint) return config.endpoint;
    if (config.url) return config.url;
    const host = this.normalizeHost(config.host || "");
    if (!host) return "";
    const port = config.port ? `:${config.port}` : "";
    const protocol = config.ssl === false ? "http" : "https";
    return `${protocol}://${host}${port}`;
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "query", statement: query, options };
    }

    const { raw, payload } = getQueryParts(query);
    const operation = resolveOperation(raw, payload, { defaultOperation: "query" });

    return {
      operation,
      statement: raw.statement || raw.query || payload.statement || payload.query || "",
      queryOptions: raw.queryOptions || payload.queryOptions,
      collection: raw.collection || payload.collection || raw.container,
      database: raw.database || payload.database,
      id: raw.id || payload.id,
      partitionKey: raw.partitionKey || payload.partitionKey,
      document: raw.document || payload.document,
      patch: raw.patch || payload.patch,
      operations: raw.operations || payload.operations,
      limit: raw.limit || payload.limit,
      continuationToken: raw.continuationToken || payload.continuationToken,
      containerDefinition: raw.containerDefinition || payload.containerDefinition,
      storedProcedureId:
        raw.storedProcedureId || payload.storedProcedureId || raw.sprocId || payload.sprocId,
      body: raw.body || payload.body,
      params: raw.params || payload.params,
      throughput: raw.throughput || payload.throughput,
      options,
    };
  }

  async _sampleDocuments(container) {
    try {
      const result = await container.items
        .query("SELECT * FROM c", { maxItemCount: 20 })
        .fetchAll();
      return result.resources || [];
    } catch (error) {
      logger.debug("Cosmos DB sample query failed:", error.message || error);
      return [];
    }
  }
}

module.exports = CosmosDBStrategy;
