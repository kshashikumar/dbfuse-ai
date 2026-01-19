const { connectionManager } = require("../../config");
const SchemaAdapter = require("./SchemaAdapter");

class FirestoreSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "firestore";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for Firestore schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("Firestore strategy is not available for schema extraction.");
    }

    let collections;
    try {
      collections = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`Firestore schema extraction failed: ${error.message || "unknown error"}`);
    }

    const collectionNames = this._normalizeCollectionNames(collections || []);
    const tables = [];

    for (const name of collectionNames) {
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
          type: "collection",
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "firestore",
      tables,
    };
  }

  _normalizeCollectionNames(collections) {
    const names = collections
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.id || entry?.name || entry?.collection || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeFields(info) {
    if (!info) return [];
    const fields = info?.fields || info?.columns || info?.schema || [];
    if (!Array.isArray(fields)) return [];
    return fields.map((field) => ({
      name: field?.name || field?.field || field?.id || null,
      dataType: field?.type || field?.dataType || null,
      raw: field,
    }));
  }
}

module.exports = FirestoreSchemaAdapter;
