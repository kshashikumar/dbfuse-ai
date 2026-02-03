const logger = require("../../utils/logger");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

const NoSQLStrategy = require("./base/nosql-strategy");

class DynamoDBStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.docClient = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let DynamoDBClient;
    let DynamoDBDocumentClient;
    try {
      ({ DynamoDBClient } = require("@aws-sdk/client-dynamodb"));
      ({ DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb"));
    } catch {
      throw new Error(
        "DynamoDB driver not installed. Add '@aws-sdk/client-dynamodb' and '@aws-sdk/lib-dynamodb' to dependencies to enable DynamoDB support.",
      );
    }

    const region =
      config.region ||
      config.database ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1";
    const endpoint = this._buildEndpoint(config);
    const accessKeyId = config.accessKeyId || config.username;
    const secretAccessKey = config.secretAccessKey || config.password;
    const credentials =
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            sessionToken: config.sessionToken,
          }
        : undefined;

    this.client = new DynamoDBClient({
      region,
      endpoint,
      credentials,
    });
    this.docClient = DynamoDBDocumentClient.from(this.client);
    this.connectionConfig = config;
    this.currentDatabase = config.database || region;
    logger.info("DynamoDB connection established");
  }

  async disconnect() {
    if (this.client && typeof this.client.destroy === "function") {
      this.client.destroy();
    }
    this.client = null;
    this.docClient = null;
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      const { ListTablesCommand } = require("@aws-sdk/client-dynamodb");
      await this.client.send(new ListTablesCommand({ Limit: 1 }));
      return true;
    } catch (err) {
      logger.error("DynamoDB connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("DynamoDB connection not initialized");
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

  async getCollections() {
    if (!this.client) throw new Error("DynamoDB connection not initialized");
    const { ListTablesCommand } = require("@aws-sdk/client-dynamodb");
    const tables = [];
    let lastEvaluatedTableName = undefined;

    do {
      const response = await this.client.send(
        new ListTablesCommand({
          Limit: 50,
          ExclusiveStartTableName: lastEvaluatedTableName,
        }),
      );
      if (response.TableNames) {
        tables.push(...response.TableNames);
      }
      lastEvaluatedTableName = response.LastEvaluatedTableName;
      if (tables.length >= 200) break;
    } while (lastEvaluatedTableName);

    return tables;
  }

  async getCollectionInfo(_dbName, collectionName) {
    if (!this.client) throw new Error("DynamoDB connection not initialized");
    if (!collectionName) throw new Error("DynamoDB table name is required.");

    const { DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
    const metadata = await this.client.send(
      new DescribeTableCommand({ TableName: collectionName }),
    );
    const table = metadata.Table || {};

    const columns = (table.AttributeDefinitions || []).map((attr) => ({
      column_name: attr.AttributeName,
      data_type: attr.AttributeType,
    }));

    const indexes = [];
    for (const gsi of table.GlobalSecondaryIndexes || []) {
      indexes.push({
        index_name: gsi.IndexName,
        type: "GSI",
        definition: JSON.stringify({
          keySchema: gsi.KeySchema,
          projection: gsi.Projection,
        }),
      });
    }
    for (const lsi of table.LocalSecondaryIndexes || []) {
      indexes.push({
        index_name: lsi.IndexName,
        type: "LSI",
        definition: JSON.stringify({
          keySchema: lsi.KeySchema,
          projection: lsi.Projection,
        }),
      });
    }

    let sampleDocuments = [];
    try {
      const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
      const result = await this.docClient.send(
        new ScanCommand({ TableName: collectionName, Limit: 20 }),
      );
      sampleDocuments = result.Items || [];
    } catch (error) {
      logger.debug("DynamoDB sample scan failed:", error.message || error);
    }

    return {
      db_name: this.currentDatabase || "default",
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
    if (!this.docClient) throw new Error("DynamoDB connection not initialized");
    const normalized = this._normalizeQuery(query, options);
    const operation = normalized.operation;

    const {
      GetCommand,
      PutCommand,
      UpdateCommand,
      DeleteCommand,
      QueryCommand,
      ScanCommand,
      BatchGetCommand,
      BatchWriteCommand,
      TransactGetCommand,
      TransactWriteCommand,
    } = require("@aws-sdk/lib-dynamodb");
    const {
      CreateTableCommand,
      UpdateTableCommand,
      DeleteTableCommand,
    } = require("@aws-sdk/client-dynamodb");

    switch (operation) {
      case "get": {
        if (!normalized.table || !normalized.key) {
          throw new Error("DynamoDB table and key are required.");
        }
        const response = await this.docClient.send(
          new GetCommand({ TableName: normalized.table, Key: normalized.key }),
        );
        return { documents: response.Item ? [response.Item] : [] };
      }
      case "put":
      case "insert": {
        if (!normalized.table || !normalized.item) {
          throw new Error("DynamoDB table and item are required.");
        }
        await this.docClient.send(
          new PutCommand({
            TableName: normalized.table,
            Item: normalized.item,
            ...normalized.requestOptions,
          }),
        );
        return { inserted: true };
      }
      case "update": {
        if (!normalized.table || !normalized.key) {
          throw new Error("DynamoDB table and key are required.");
        }
        const response = await this.docClient.send(
          new UpdateCommand({
            TableName: normalized.table,
            Key: normalized.key,
            ...normalized.requestOptions,
            ReturnValues: normalized.requestOptions?.ReturnValues || "ALL_NEW",
          }),
        );
        return { updated: true, document: response.Attributes || null };
      }
      case "delete": {
        if (!normalized.table || !normalized.key) {
          throw new Error("DynamoDB table and key are required.");
        }
        await this.docClient.send(
          new DeleteCommand({
            TableName: normalized.table,
            Key: normalized.key,
            ...normalized.requestOptions,
          }),
        );
        return { deleted: true };
      }
      case "query": {
        if (!normalized.table) throw new Error("DynamoDB table is required.");
        const response = await this.docClient.send(
          new QueryCommand({
            TableName: normalized.table,
            ...normalized.requestOptions,
            Limit: normalized.limit || normalized.requestOptions?.Limit,
            ExclusiveStartKey:
              normalized.exclusiveStartKey || normalized.requestOptions?.ExclusiveStartKey,
          }),
        );
        return {
          documents: response.Items || [],
          lastEvaluatedKey: response.LastEvaluatedKey || null,
          count: response.Count,
          scannedCount: response.ScannedCount,
        };
      }
      case "scan": {
        if (!normalized.table) throw new Error("DynamoDB table is required.");
        const response = await this.docClient.send(
          new ScanCommand({
            TableName: normalized.table,
            ...normalized.requestOptions,
            Limit: normalized.limit || normalized.requestOptions?.Limit,
            ExclusiveStartKey:
              normalized.exclusiveStartKey || normalized.requestOptions?.ExclusiveStartKey,
          }),
        );
        return {
          documents: response.Items || [],
          lastEvaluatedKey: response.LastEvaluatedKey || null,
          count: response.Count,
          scannedCount: response.ScannedCount,
        };
      }
      case "batchget": {
        if (!normalized.requestItems) {
          throw new Error("DynamoDB batch get requires requestItems.");
        }
        const response = await this.docClient.send(
          new BatchGetCommand({ RequestItems: normalized.requestItems }),
        );
        return { responses: response.Responses || {}, unprocessed: response.UnprocessedKeys || {} };
      }
      case "batchwrite": {
        if (!normalized.requestItems) {
          throw new Error("DynamoDB batch write requires requestItems.");
        }
        const response = await this.docClient.send(
          new BatchWriteCommand({ RequestItems: normalized.requestItems }),
        );
        return { unprocessed: response.UnprocessedItems || {} };
      }
      case "transactget": {
        if (!normalized.transactItems) {
          throw new Error("DynamoDB transactGet requires transactItems.");
        }
        const response = await this.docClient.send(
          new TransactGetCommand({ TransactItems: normalized.transactItems }),
        );
        return { responses: response.Responses || [] };
      }
      case "transactwrite": {
        if (!normalized.transactItems) {
          throw new Error("DynamoDB transactWrite requires transactItems.");
        }
        const response = await this.docClient.send(
          new TransactWriteCommand({ TransactItems: normalized.transactItems }),
        );
        return { result: response || {} };
      }
      case "createtable": {
        if (!this.client) throw new Error("DynamoDB connection not initialized");
        const params = normalized.tableDefinition || normalized.requestOptions;
        if (!params || !params.TableName) {
          throw new Error("DynamoDB createTable requires tableDefinition with TableName.");
        }
        const response = await this.client.send(new CreateTableCommand(params));
        return { table: response.TableDescription || response.Table };
      }
      case "updatetable": {
        if (!this.client) throw new Error("DynamoDB connection not initialized");
        const params = normalized.tableDefinition || normalized.requestOptions;
        if (!params || !params.TableName) {
          throw new Error("DynamoDB updateTable requires tableDefinition with TableName.");
        }
        const response = await this.client.send(new UpdateTableCommand(params));
        return { table: response.TableDescription || response.Table };
      }
      case "deletetable": {
        if (!this.client) throw new Error("DynamoDB connection not initialized");
        const tableName = normalized.table || normalized.requestOptions?.TableName;
        if (!tableName) {
          throw new Error("DynamoDB deleteTable requires table name.");
        }
        const response = await this.client.send(new DeleteTableCommand({ TableName: tableName }));
        return { table: response.TableDescription || response.Table || { TableName: tableName } };
      }
      default:
        throw new Error(`Unsupported DynamoDB operation: ${operation}`);
    }
  }

  _buildEndpoint(config = {}) {
    if (config.endpoint) return config.endpoint;
    if (!config.host) return undefined;
    const host = this.normalizeHost(config.host);
    const port = config.port ? `:${config.port}` : "";
    const protocol = config.ssl === false ? "http" : "https";
    return `${protocol}://${host}${port}`;
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "scan", table: query };
    }

    const { raw, payload } = getQueryParts(query);
    const operation = resolveOperation(raw, payload, { defaultOperation: "scan" });

    return {
      operation,
      table: raw.table || raw.collection || payload.table || payload.collection,
      key: raw.key || payload.key,
      item: raw.item || raw.document || payload.item || payload.document,
      requestOptions: raw.options || payload.options || {},
      requestItems: raw.requestItems || payload.requestItems,
      transactItems: raw.transactItems || payload.transactItems,
      tableDefinition: raw.tableDefinition || payload.tableDefinition,
      limit: raw.limit || payload.limit || options?.pageSize,
      exclusiveStartKey: raw.exclusiveStartKey || payload.exclusiveStartKey,
    };
  }
}

module.exports = DynamoDBStrategy;
