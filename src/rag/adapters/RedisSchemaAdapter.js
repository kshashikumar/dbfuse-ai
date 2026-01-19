const { connectionManager } = require("../../config");
const SchemaAdapter = require("./SchemaAdapter");

class RedisSchemaAdapter extends SchemaAdapter {
  supports(dbType) {
    return String(dbType || "").toLowerCase() === "redis";
  }

  async extract({ connectionId } = {}) {
    if (!connectionId) {
      throw new Error("connectionId is required for Redis schema extraction");
    }

    const strategy = connectionManager.getConnection(connectionId);
    if (!strategy || typeof strategy.getKeys !== "function") {
      throw new Error("Redis strategy is not available for schema extraction.");
    }

    let keys;
    try {
      keys = await strategy.getKeys("*");
    } catch (error) {
      throw new Error(
        `Redis schema extraction is not implemented: ${error.message || "unknown error"}`,
      );
    }

    const keyList = Array.isArray(keys) ? keys : [];
    const groups = new Map();

    for (const key of keyList) {
      const name = this._normalizeKeyGroup(key);
      const entry = groups.get(name) || { name, keys: [] };
      entry.keys.push(key);
      groups.set(name, entry);
    }

    const tables = Array.from(groups.values()).map((group) => ({
      name: group.name,
      columns: [],
      indexes: [],
      foreignKeys: [],
      metadata: { type: "keyspace", sampleKeys: group.keys.slice(0, 5) },
    }));

    return {
      database: "redis",
      dbType: "redis",
      tables,
    };
  }

  _normalizeKeyGroup(key) {
    if (!key || typeof key !== "string") {
      return "default";
    }
    const parts = key.split(":");
    return parts[0] || "default";
  }
}

module.exports = RedisSchemaAdapter;
