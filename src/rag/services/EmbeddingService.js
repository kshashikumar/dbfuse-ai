const storageManager = require("../storage/StorageManager");

class EmbeddingService {
  constructor(options = {}) {
    this.dimensions = Number.isFinite(options.dimensions) ? options.dimensions : 256;
    this.cache = new Map();
  }

  embedText(text) {
    const normalized = String(text || "").toLowerCase();
    const cacheKey = `${this.dimensions}:${normalized}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const tokens = normalized.split(/[^a-z0-9_]+/).filter(Boolean);
    const vector = new Array(this.dimensions).fill(0);

    for (const token of tokens) {
      const idx = this._hashToken(token) % this.dimensions;
      vector[idx] += 1;
    }

    const normalizedVector = this._normalize(vector);
    this.cache.set(cacheKey, normalizedVector);
    return normalizedVector;
  }

  async generateForSchema(schema) {
    if (!schema || !Array.isArray(schema.tables)) {
      throw new Error("Schema is required for embeddings");
    }

    await storageManager.initialize();
    const vectorStore = storageManager.getVectorStore();
    const databaseName = schema.database || schema.dbName || "default";

    for (const table of schema.tables) {
      if (!table?.name) {
        continue;
      }

      const tableText = this._describeTable(databaseName, table);
      const tableId = this._makeId("table", databaseName, table.name);

      await vectorStore.upsertEmbedding({
        id: this._makeId("embedding", tableId),
        nodeId: tableId,
        vector: this.embedText(tableText),
        metadata: {
          type: "table",
          database: databaseName,
          table: table.name,
          nodeId: tableId,
        },
      });

      for (const column of table.columns || []) {
        if (!column?.name) {
          continue;
        }

        const columnText = this._describeColumn(databaseName, table.name, column);
        const columnId = this._makeId("column", databaseName, table.name, column.name);

        await vectorStore.upsertEmbedding({
          id: this._makeId("embedding", columnId),
          nodeId: columnId,
          vector: this.embedText(columnText),
          metadata: {
            type: "column",
            database: databaseName,
            table: table.name,
            column: column.name,
            nodeId: columnId,
            tableId,
          },
        });
      }
    }
  }

  _describeTable(databaseName, table) {
    const columns = (table.columns || [])
      .map((col) => `${col.name}${col.dataType ? `:${col.dataType}` : ""}`)
      .join(", ");
    return `database ${databaseName} table ${table.name} columns ${columns}`;
  }

  _describeColumn(databaseName, tableName, column) {
    const type = column.dataType ? ` type ${column.dataType}` : "";
    return `database ${databaseName} table ${tableName} column ${column.name}${type}`;
  }

  _hashToken(token) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  _normalize(vector) {
    let sum = 0;
    for (const value of vector) {
      sum += value * value;
    }
    if (sum === 0) {
      return vector;
    }
    const norm = Math.sqrt(sum);
    return vector.map((value) => value / norm);
  }

  _makeId(...parts) {
    return parts
      .map((part) => encodeURIComponent(String(part || "").trim()))
      .filter((part) => part.length > 0)
      .join("|");
  }
}

module.exports = EmbeddingService;
