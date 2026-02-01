const { connectionManager } = require("../../config");

const SchemaAdapter = require("./SchemaAdapter");

class HBaseSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "hbase";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for HBase schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("HBase strategy is not available for schema extraction.");
    }

    let tables;
    try {
      tables = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`HBase schema extraction failed: ${error.message || "unknown error"}`);
    }

    const tableNames = this._normalizeTableNames(tables || []);
    const extractedTables = [];

    for (const name of tableNames) {
      let columns = [];
      if (typeof strategy.getCollectionInfo === "function") {
        try {
          const info = await strategy.getCollectionInfo(dbName, name);
          columns = this._normalizeColumnFamilies(info);
        } catch {
          columns = [];
        }
      }

      extractedTables.push({
        name,
        columns,
        indexes: [],
        foreignKeys: [],
        metadata: {
          type: "table",
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "hbase",
      tables: extractedTables,
    };
  }

  _normalizeTableNames(tables) {
    const names = tables
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.name || entry?.tableName || entry?.table || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeColumnFamilies(info) {
    if (!info) return [];
    // HBase has column families instead of regular columns
    const columnFamilies = info?.columnFamilies || info?.families || info?.columns || [];
    if (!Array.isArray(columnFamilies)) return [];
    return columnFamilies.map((cf) => ({
      name: cf?.name || cf?.family || null,
      dataType: "column_family",
      raw: cf,
    }));
  }
}

module.exports = HBaseSchemaAdapter;
