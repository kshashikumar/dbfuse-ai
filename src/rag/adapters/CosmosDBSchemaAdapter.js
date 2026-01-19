const { connectionManager } = require("../../config");
const SchemaAdapter = require("./SchemaAdapter");

class CosmosDBSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "cosmosdb";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for CosmosDB schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getCollections !== "function") {
      throw new Error("CosmosDB strategy is not available for schema extraction.");
    }

    let containers;
    try {
      containers = await strategy.getCollections(dbName);
    } catch (error) {
      throw new Error(`CosmosDB schema extraction failed: ${error.message || "unknown error"}`);
    }

    const containerNames = this._normalizeContainerNames(containers || []);
    const tables = [];

    for (const name of containerNames) {
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
          type: "container",
          database: dbName,
        },
      });
    }

    return {
      database: dbName || "default",
      dbType: "cosmosdb",
      tables,
    };
  }

  _normalizeContainerNames(containers) {
    const names = containers
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        return entry?.id || entry?.name || entry?.containerName || null;
      })
      .filter((name) => typeof name === "string" && name.trim().length > 0);

    return Array.from(new Set(names));
  }

  _normalizeFields(info) {
    if (!info) return [];
    const fields = info?.fields || info?.columns || info?.schema || info?.properties || [];
    if (!Array.isArray(fields)) return [];
    return fields.map((field) => ({
      name: field?.name || field?.id || field?.field || null,
      dataType: field?.type || field?.dataType || null,
      raw: field,
    }));
  }
}

module.exports = CosmosDBSchemaAdapter;
