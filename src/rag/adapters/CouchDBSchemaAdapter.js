const { connectionManager } = require("../../config");
const SchemaAdapter = require("./SchemaAdapter");

class CouchDBSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "couchdb";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for CouchDB schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("CouchDB strategy is not available for schema extraction.");
    }

    let databases;
    try {
      // For CouchDB, getCollections returns list of databases
      databases = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`CouchDB schema extraction failed: ${error.message || "unknown error"}`);
    }

    const dbNames = this._normalizeDatabaseNames(databases || []);
    const tables = [];

    for (const name of dbNames) {
      let columns = [];
      if (typeof strategy.getCollectionInfo === "function") {
        try {
          const info = await strategy.getCollectionInfo(dbName, name);
          columns = this._normalizeFields(info);
        } catch {
          columns = [];
        }
      }

      tables.push({
        name,
        columns,
        indexes: [],
        foreignKeys: [],
        metadata: {
          type: "database",
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "couchdb",
      tables,
    };
  }

  _normalizeDatabaseNames(databases) {
    const names = databases
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.name || entry?.db_name || entry?.id || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeFields(info) {
    if (!info) return [];
    const fields = info?.fields || info?.columns || info?.schema || info?.properties || [];
    if (!Array.isArray(fields)) return [];
    return fields.map((field) => ({
      name: field?.name || field?.field || field?.id || null,
      dataType: field?.type || field?.dataType || null,
      raw: field,
    }));
  }
}

module.exports = CouchDBSchemaAdapter;
