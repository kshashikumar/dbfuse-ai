const logger = require("../../utils/logger");

const CacheStrategy = require("./base/cache-strategy");

class MemcachedStrategy extends CacheStrategy {
  constructor() {
    super();
    this.client = null;
    this.connectionConfig = null;
    this.currentDatabase = null;
  }

  async connect(config) {
    let Memcached;
    try {
      Memcached = require("memcached");
    } catch {
      throw new Error(
        "Memcached driver not installed. Add 'memcached' to dependencies to enable Memcached support.",
      );
    }

    const host = this.normalizeHost(config.host || "localhost");
    const port = config.port || 11211;
    const server = `${host}:${port}`;
    this.client = new Memcached(server, config.options || {});
    this.connectionConfig = config;
    this.currentDatabase = config.database || "default";
    logger.info("Memcached connection initialized");
  }

  async disconnect() {
    if (this.client && typeof this.client.end === "function") {
      await new Promise((resolve) => this.client.end(resolve));
    }
    this.client = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this._stats();
      return true;
    } catch (err) {
      logger.error("Memcached connection validation failed:", err);
      return false;
    }
  }

  async getKeys(pattern) {
    if (!this.client) throw new Error("Memcached connection not initialized");
    const limit = 200;
    const keys = [];

    try {
      const items = await this._stats("items");
      const slabIds = new Set();
      for (const server of Object.values(items || {})) {
        Object.keys(server || {}).forEach((key) => {
          const match = key.match(/^items:(\d+):/);
          if (match) slabIds.add(match[1]);
        });
      }

      for (const slabId of slabIds) {
        if (keys.length >= limit) break;
        const dump = await this._stats(["cachedump", slabId, limit]);
        for (const server of Object.values(dump || {})) {
          Object.keys(server || {}).forEach((key) => {
            if (keys.length < limit) keys.push(key);
          });
        }
      }
    } catch (error) {
      logger.debug("Memcached key scan failed:", error.message || error);
    }

    if (!pattern || pattern === "*") return keys;
    const safePattern = String(pattern).replace(/\*/g, ".*");
    const regex = new RegExp(`^${safePattern}$`);
    return keys.filter((key) => regex.test(key));
  }

  async getDatabases() {
    const tables = await this.getTables();
    return [
      {
        name: this.currentDatabase || "default",
        sizeOnDisk: 0,
        tables: tables.map((name) => ({ name })),
        views: [],
      },
    ];
  }

  async getTables() {
    const keys = await this.getKeys("*");
    const groups = new Set();
    for (const key of keys) {
      groups.add(this._normalizeKeyGroup(key));
    }
    return Array.from(groups);
  }

  async getTableInfo(dbName, tableName) {
    const prefix = tableName || "default";
    const pattern = prefix === "default" ? "*" : `${prefix}:*`;
    const keys = await this.getKeys(pattern);
    const sampled = keys.slice(0, 25);

    const columns = [];
    const sampleKeys = [];
    for (const key of sampled) {
      let valuePreview = null;
      try {
        const value = await this._getValue(key);
        valuePreview = this._serializePreview(value);
      } catch {
        valuePreview = null;
      }
      columns.push({
        column_name: key,
        data_type: "string",
      });
      sampleKeys.push({
        key,
        type: "string",
        ttl: null,
        valuePreview,
      });
    }

    return {
      db_name: dbName || this.currentDatabase || "default",
      table_name: prefix,
      columns,
      indexes: [],
      foreign_keys: [],
      triggers: [],
      sampleKeys,
    };
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    const details = [];
    for (const name of tableNames || []) {
      details.push(await this.getTableInfo(dbName, name));
    }
    return details;
  }

  async _executeQueryImpl(query, options = {}) {
    if (!this.client) throw new Error("Memcached connection not initialized");
    const normalized = this._normalizeQuery(query, options);

    switch (normalized.operation) {
      case "get": {
        const value = await this._getValue(normalized.key);
        return { key: normalized.key, value };
      }
      case "set": {
        await this._setValue(normalized.key, normalized.value, normalized.ttl);
        return { key: normalized.key, result: true };
      }
      case "add": {
        await this._addValue(normalized.key, normalized.value, normalized.ttl);
        return { key: normalized.key, added: true };
      }
      case "replace": {
        await this._replaceValue(normalized.key, normalized.value, normalized.ttl);
        return { key: normalized.key, replaced: true };
      }
      case "del":
      case "delete": {
        await this._deleteValue(normalized.key);
        return { deleted: true };
      }
      case "incr": {
        const delta = Number.isFinite(Number(normalized.delta))
          ? Number(normalized.delta)
          : Number.isFinite(Number(normalized.value))
            ? Number(normalized.value)
            : 1;
        const value = await this._incrementValue(
          normalized.key,
          delta,
          normalized.initial,
          normalized.ttl,
        );
        return { key: normalized.key, value };
      }
      case "decr": {
        const delta = Number.isFinite(Number(normalized.delta))
          ? Number(normalized.delta)
          : Number.isFinite(Number(normalized.value))
            ? Number(normalized.value)
            : 1;
        const value = await this._decrementValue(
          normalized.key,
          delta,
          normalized.initial,
          normalized.ttl,
        );
        return { key: normalized.key, value };
      }
      case "touch": {
        const ttl = Number.isFinite(Number(normalized.ttl)) ? Number(normalized.ttl) : 0;
        await this._touchValue(normalized.key, ttl);
        return { key: normalized.key, touched: true };
      }
      case "append": {
        await this._appendValue(normalized.key, normalized.value);
        return { key: normalized.key, appended: true };
      }
      case "prepend": {
        await this._prependValue(normalized.key, normalized.value);
        return { key: normalized.key, prepended: true };
      }
      case "mget": {
        const values = await this._getMulti(normalized.keys);
        return { keys: normalized.keys, values };
      }
      case "stats": {
        const stats = await this._stats();
        return { stats };
      }
      case "flush": {
        await this._flush();
        return { flushed: true };
      }
      default:
        throw new Error(`Unsupported Memcached operation: ${normalized.operation}`);
    }
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "get", key: query };
    }
    const payload = query?.payload || {};
    const operation = (
      query?.operation ||
      query?.action ||
      payload.operation ||
      payload.action ||
      "get"
    )
      .toString()
      .toLowerCase();

    const key = query?.key || payload.key;
    const keys = query?.keys || payload.keys || (key ? [key] : []);
    return {
      operation,
      key,
      keys: Array.isArray(keys) ? keys : [keys],
      value: query?.value || payload.value,
      delta: query?.delta || payload.delta,
      initial: query?.initial || payload.initial,
      ttl: query?.ttl || payload.ttl || options?.ttl,
    };
  }

  _normalizeKeyGroup(key) {
    if (!key) return "default";
    const raw = String(key);
    return raw.includes(":") ? raw.split(":")[0] : "default";
  }

  _getValue(key) {
    return new Promise((resolve, reject) => {
      this.client.get(key, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  }

  _getMulti(keys) {
    return new Promise((resolve, reject) => {
      this.client.getMulti(keys, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data || {});
      });
    });
  }

  _setValue(key, value, ttl) {
    return new Promise((resolve, reject) => {
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      this.client.set(key, value, expiry, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _addValue(key, value, ttl) {
    return new Promise((resolve, reject) => {
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      this.client.add(key, value, expiry, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _replaceValue(key, value, ttl) {
    return new Promise((resolve, reject) => {
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      this.client.replace(key, value, expiry, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _deleteValue(key) {
    return new Promise((resolve, reject) => {
      this.client.del(key, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _incrementValue(key, delta = 1, initial, ttl) {
    return new Promise((resolve, reject) => {
      const amount = Number.isFinite(Number(delta)) ? Number(delta) : 1;
      const hasInitial = initial !== undefined && initial !== null;
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      if (hasInitial) {
        const initValue = Number.isFinite(Number(initial)) ? Number(initial) : 0;
        this.client.incr(key, amount, initValue, expiry, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      } else {
        this.client.incr(key, amount, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      }
    });
  }

  _decrementValue(key, delta = 1, initial, ttl) {
    return new Promise((resolve, reject) => {
      const amount = Number.isFinite(Number(delta)) ? Number(delta) : 1;
      const hasInitial = initial !== undefined && initial !== null;
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      if (hasInitial) {
        const initValue = Number.isFinite(Number(initial)) ? Number(initial) : 0;
        this.client.decr(key, amount, initValue, expiry, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      } else {
        this.client.decr(key, amount, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
      }
    });
  }

  _touchValue(key, ttl) {
    return new Promise((resolve, reject) => {
      const expiry = Number.isFinite(Number(ttl)) ? Number(ttl) : 0;
      this.client.touch(key, expiry, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _appendValue(key, value) {
    return new Promise((resolve, reject) => {
      this.client.append(key, value, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _prependValue(key, value) {
    return new Promise((resolve, reject) => {
      this.client.prepend(key, value, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _stats(args) {
    return new Promise((resolve, reject) => {
      if (args && Array.isArray(args)) {
        this.client.stats(...args, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
        return;
      }
      if (args) {
        this.client.stats(args, (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
        return;
      }
      this.client.stats((err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    });
  }

  _flush() {
    return new Promise((resolve, reject) => {
      this.client.flush((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(true);
      });
    });
  }

  _serializePreview(value) {
    if (value === null || value === undefined) return null;
    const serialized = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    if (serialized.length > 500) {
      return `${serialized.slice(0, 500)}...`;
    }
    return serialized;
  }
}

module.exports = MemcachedStrategy;
