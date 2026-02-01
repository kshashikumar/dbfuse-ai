const { connectionManager } = require("../../config");

const SchemaAdapter = require("./SchemaAdapter");

class CassandraSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "cassandra";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for Cassandra schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("Cassandra strategy is not available for schema extraction.");
    }

    let tables;
    try {
      tables = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`Cassandra schema extraction failed: ${error.message || "unknown error"}`);
    }

    const tableNames = this._normalizeTableNames(tables || []);
    const extractedTables = [];

    for (const name of tableNames) {
      let columns = [];
      if (typeof strategy.getCollectionInfo === "function") {
        try {
          const info = await strategy.getCollectionInfo(dbName, name);
          columns = this._normalizeColumns(info);
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
          keyspace: dbName,
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "cassandra",
      tables: extractedTables,
    };
  }

  _normalizeTableNames(tables) {
    const names = tables
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.name || entry?.table_name || entry?.tableName || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeColumns(info) {
    if (!info) return [];
    const columns = info?.columns || info?.fields || info?.schema || [];
    if (!Array.isArray(columns)) return [];
    return columns.map((col) => ({
      name: col?.name || col?.column_name || col?.columnName || null,
      dataType: col?.type || col?.dataType || col?.data_type || null,
      raw: col,
    }));
  }
}

module.exports = CassandraSchemaAdapter;
