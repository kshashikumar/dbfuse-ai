const { connectionManager } = require("../../config");
const SchemaAdapter = require("./SchemaAdapter");

class DynamoDBSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "dynamodb";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for DynamoDB schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("DynamoDB strategy is not available for schema extraction.");
    }

    let tables;
    try {
      tables = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`DynamoDB schema extraction failed: ${error.message || "unknown error"}`);
    }

    const tableNames = this._normalizeTableNames(tables || []);
    const extractedTables = [];

    for (const name of tableNames) {
      let columns = [];
      let indexes = [];
      if (typeof strategy.getCollectionInfo === "function") {
        try {
          const info = await strategy.getCollectionInfo(dbName, name);
          columns = this._normalizeColumns(info);
          indexes = this._normalizeIndexes(info);
        } catch {
          columns = [];
          indexes = [];
        }
      }

      extractedTables.push({
        name,
        columns,
        indexes,
        foreignKeys: [],
        metadata: {
          type: "table",
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "dynamodb",
      tables: extractedTables,
    };
  }

  _normalizeTableNames(tables) {
    const names = tables
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.TableName || entry?.name || entry?.tableName || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeColumns(info) {
    if (!info) return [];
    const columns = info?.columns || info?.AttributeDefinitions || info?.attributes || [];
    if (!Array.isArray(columns)) return [];
    return columns.map((col) => ({
      name: col?.AttributeName || col?.name || col?.columnName || null,
      dataType: col?.AttributeType || col?.type || col?.dataType || null,
      raw: col,
    }));
  }

  _normalizeIndexes(info) {
    if (!info) return [];
    const gsi = info?.GlobalSecondaryIndexes || [];
    const lsi = info?.LocalSecondaryIndexes || [];
    const allIndexes = [...gsi, ...lsi];

    return allIndexes.map((idx) => ({
      name: idx?.IndexName || idx?.name || null,
      type: idx?.IndexType || (gsi.includes(idx) ? "GSI" : "LSI"),
      raw: idx,
    }));
  }
}

module.exports = DynamoDBSchemaAdapter;
