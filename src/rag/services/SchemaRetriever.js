const storageManager = require("../storage/StorageManager");

const EmbeddingService = require("./EmbeddingService");

class SchemaRetriever {
  constructor(options = {}) {
    this.embeddingService = options.embeddingService || new EmbeddingService();
  }

  async retrieveContext({ query, database, limit = 8, minScore = 0.2 } = {}) {
    if (!query) {
      throw new Error("query is required for retrieval");
    }

    await storageManager.initialize();
    const vectorStore = storageManager.getVectorStore();
    const graphStore = storageManager.getGraphStore();

    const queryVector = this.embeddingService.embedText(query);
    const matches = await vectorStore.findSimilar(queryVector, { limit, minScore });

    const tables = new Map();
    for (const match of matches) {
      const metadata = match.metadata || {};
      const tableName = metadata.table;
      if (!tableName) {
        continue;
      }
      const tableEntry = tables.get(tableName) || {
        name: tableName,
        score: 0,
        columns: new Set(),
        nodeId: metadata.tableId || null,
      };

      tableEntry.score = Math.max(tableEntry.score, match.score || 0);
      if (metadata.column) {
        tableEntry.columns.add(metadata.column);
      }
      if (!tableEntry.nodeId && metadata.tableId) {
        tableEntry.nodeId = metadata.tableId;
      }
      tables.set(tableName, tableEntry);
    }

    const relationships = [];
    for (const entry of tables.values()) {
      const tableId = entry.nodeId || this._makeId("table", database || "default", entry.name);
      const edges = await graphStore.getEdgesForNode(tableId);
      for (const edge of edges) {
        if (edge.relationship !== "REFERENCES") {
          continue;
        }
        relationships.push({
          from: entry.name,
          to: await this._resolveTableName(graphStore, edge.targetId, edge.sourceId),
          metadata: edge.metadata || null,
        });
      }
    }

    const normalizedTables = Array.from(tables.values()).map((entry) => ({
      name: entry.name,
      score: entry.score,
      columns: Array.from(entry.columns),
    }));

    normalizedTables.sort((a, b) => b.score - a.score);

    return {
      tables: normalizedTables,
      relationships,
      matches,
    };
  }

  async _resolveTableName(graphStore, targetId, sourceId) {
    const target = await graphStore.getNodeById(targetId);
    if (target?.name) {
      return target.name;
    }
    const source = await graphStore.getNodeById(sourceId);
    if (source?.name) {
      return source.name;
    }
    return null;
  }

  _makeId(...parts) {
    return parts
      .map((part) => encodeURIComponent(String(part || "").trim()))
      .filter((part) => part.length > 0)
      .join("|");
  }
}

module.exports = SchemaRetriever;
