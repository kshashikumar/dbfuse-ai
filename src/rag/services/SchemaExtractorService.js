const { connectionManager } = require("../../config");
const AdapterRegistry = require("../adapters/AdapterRegistry");
const SqlSchemaAdapter = require("../adapters/SqlSchemaAdapter");
const MongoSchemaAdapter = require("../adapters/MongoSchemaAdapter");
const RedisSchemaAdapter = require("../adapters/RedisSchemaAdapter");
const CassandraSchemaAdapter = require("../adapters/CassandraSchemaAdapter");
const DynamoDBSchemaAdapter = require("../adapters/DynamoDBSchemaAdapter");
const CosmosDBSchemaAdapter = require("../adapters/CosmosDBSchemaAdapter");
const FirestoreSchemaAdapter = require("../adapters/FirestoreSchemaAdapter");
const CouchDBSchemaAdapter = require("../adapters/CouchDBSchemaAdapter");
const HBaseSchemaAdapter = require("../adapters/HBaseSchemaAdapter");
const MemcachedSchemaAdapter = require("../adapters/MemcachedSchemaAdapter");

class SchemaExtractorService {
  constructor(options = {}) {
    this.registry = options.registry || new AdapterRegistry();
    if (!this.registry.hasAdapters()) {
      // SQL Databases
      this.registry.register(new SqlSchemaAdapter());

      // NoSQL Databases
      this.registry.register(new MongoSchemaAdapter());
      this.registry.register(new CassandraSchemaAdapter());
      this.registry.register(new DynamoDBSchemaAdapter());
      this.registry.register(new CosmosDBSchemaAdapter());
      this.registry.register(new FirestoreSchemaAdapter());
      this.registry.register(new CouchDBSchemaAdapter());
      this.registry.register(new HBaseSchemaAdapter());

      // Cache Databases
      this.registry.register(new RedisSchemaAdapter());
      this.registry.register(new MemcachedSchemaAdapter());
    }
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for schema extraction");
    }

    const connectionInfo = connectionManager.getConnectionInfo(connectionId) || {};
    const dbType = connectionInfo.dbType || connectionInfo?.config?.dbType || null;
    const adapter = this.registry.getAdapter(dbType);
    if (!adapter) {
      throw new Error(`Schema adapter not available for ${dbType || "unknown"} databases.`);
    }

    return adapter.extract({ connectionId, dbName, dbType });
  }
}

module.exports = SchemaExtractorService;
