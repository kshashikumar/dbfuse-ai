const { connectionManager } = require("../../config");

const SchemaAdapter = require("./SchemaAdapter");

class MemcachedSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "memcached";
  }

  async extract({ connectionId, dbName } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for Memcached schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy) {
      throw new Error("Memcached strategy is not available for schema extraction.");
    }

    let keyPatterns = [];

    // Memcached doesn't have native schema, try to get key patterns if available
    if (typeof strategy.getKeys === "function") {
      try {
        const keys = await strategy.getKeys();
        keyPatterns = this._extractKeyPatterns(keys || []);
      } catch {
        // Memcached might not support listing keys
        keyPatterns = [];
      }
    }

    // If no keys available, return minimal schema
    const tables = keyPatterns.map((pattern) => ({
      name: pattern,
      columns: [
        {
          name: "key",
          dataType: "string",
          raw: null,
        },
        {
          name: "value",
          dataType: "binary",
          raw: null,
        },
      ],
      indexes: [],
      foreignKeys: [],
      metadata: {
        type: "key_pattern",
        pattern,
      },
    }));

    // If no patterns detected, return a generic key-value structure
    if (tables.length === 0) {
      tables.push({
        name: "cache",
        columns: [
          { name: "key", dataType: "string", raw: null },
          { name: "value", dataType: "binary", raw: null },
        ],
        indexes: [],
        foreignKeys: [],
        metadata: { type: "key_value" },
      });
    }

    return {
      database: dbName || "default",
      dbType: "memcached",
      tables,
    };
  }

  _extractKeyPatterns(keys) {
    // Try to detect common patterns in key names
    const patterns = new Set();

    for (const key of keys) {
      if (typeof key !== "string") continue;

      // Extract pattern by replacing numbers and UUIDs with wildcards
      const pattern = key
        .replace(/\d+/g, "*")
        .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "*");

      patterns.add(pattern);
    }

    return Array.from(patterns);
  }
}

module.exports = MemcachedSchemaAdapter;
