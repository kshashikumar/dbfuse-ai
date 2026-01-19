// db_strategies/redis-strategy.js
const logger = require("../../utils/logger");

const CacheStrategy = require("./base/cache-strategy");

class RedisStrategy extends CacheStrategy {
  constructor() {
    super();
    this.client = null;
    this.connectionConfig = null;
    this.currentDatabase = null;
  }

  async connect(config) {
    let createClient;
    try {
      ({ createClient } = require("redis"));
    } catch (error) {
      throw new Error(
        "Redis driver not installed. Add 'redis' to dependencies to enable Redis support.",
      );
    }

    const url = this._buildRedisUrl(config);
    this.client = createClient({ url });
    this.client.on("error", (err) => logger.error("Redis client error:", err));
    await this.client.connect();
    this.connectionConfig = config;
    this.currentDatabase = Number.isFinite(Number(config.database)) ? Number(config.database) : 0;
    logger.info("Redis connection established");
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  async validateConnection() {
    return Boolean(this.client && this.client.isOpen);
  }

  async switchDatabase(dbName) {
    if (!this.client) throw new Error("Redis connection not initialized");
    if (dbName === undefined || dbName === null) return;
    const raw = String(dbName).replace(/^db/i, "");
    const index = Number.isFinite(Number(raw)) ? Number(raw) : 0;
    try {
      await this.client.select(index);
      this.currentDatabase = index;
    } catch (error) {
      logger.error("Redis select failed:", error);
      throw error;
    }
  }

  async getKeys(pattern) {
    if (!this.client) throw new Error("Redis connection not initialized");
    const match = pattern || "*";
    const keys = [];
    try {
      for await (const key of this.client.scanIterator({ MATCH: match, COUNT: 200 })) {
        keys.push(key);
        if (keys.length >= 500) {
          break;
        }
      }
    } catch (error) {
      logger.error("Redis scan failed:", error);
      throw error;
    }

    return keys;
  }

  async getDatabases() {
    if (!this.client) throw new Error("Redis connection not initialized");
    const dbName = `db${this.currentDatabase || 0}`;
    return [
      {
        name: dbName,
        sizeOnDisk: 0,
        tables: (await this.getTables()).map((name) => ({ name })),
        views: [],
      },
    ];
  }

  async getTables() {
    if (!this.client) throw new Error("Redis connection not initialized");
    const keys = await this.getKeys("*");
    const groups = new Set();
    for (const key of keys) {
      groups.add(this._normalizeKeyGroup(key));
    }
    return Array.from(groups);
  }

  async getTableInfo(dbName, tableName) {
    if (!this.client) throw new Error("Redis connection not initialized");
    const prefix = tableName || "default";
    const pattern = prefix === "default" ? "*" : `${prefix}:*`;
    const keys = await this.getKeys(pattern);
    const sampled = keys.slice(0, 25);

    const columns = [];
    const sampleKeys = [];
    for (const key of sampled) {
      let dataType = "unknown";
      let ttl = null;
      let valuePreview = null;
      try {
        dataType = await this.client.type(key);
        ttl = await this.client.ttl(key);
        valuePreview = await this._getValuePreview(key, dataType);
      } catch {
        // ignore
      }
      columns.push({
        column_name: key,
        data_type: dataType,
        extra: ttl !== null ? `ttl=${ttl}` : undefined,
      });
      sampleKeys.push({
        key,
        type: dataType,
        ttl: Number.isFinite(ttl) ? ttl : null,
        valuePreview,
      });
    }

    return {
      db_name: dbName || `db${this.currentDatabase || 0}`,
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
      const info = await this.getTableInfo(dbName, name);
      details.push(info);
    }
    return details;
  }

  async _executeQueryImpl(query, options = {}) {
    if (!this.client) throw new Error("Redis connection not initialized");

    const normalized = this._normalizeRedisQuery(query, options);
    const operation = normalized.operation;

    if (!operation) {
      throw new Error("Redis operation is required");
    }

    const op = operation.toLowerCase();

    switch (op) {
      case "get": {
        const value = await this.client.get(normalized.key);
        return { key: normalized.key, value };
      }
      case "set": {
        const setOptions = {};
        if (Number.isFinite(Number(normalized.ttl))) {
          setOptions.EX = Number(normalized.ttl);
        }
        if (normalized.options?.nx) setOptions.NX = true;
        if (normalized.options?.xx) setOptions.XX = true;
        const result =
          Object.keys(setOptions).length > 0
            ? await this.client.set(normalized.key, normalized.value, setOptions)
            : await this.client.set(normalized.key, normalized.value);
        return { key: normalized.key, result };
      }
      case "del": {
        const deleted = await this.client.del(...normalized.keys);
        return { deleted };
      }
      case "mget": {
        const values = await this.client.mGet(normalized.keys);
        return { keys: normalized.keys, values };
      }
      case "mset": {
        const payload = this._normalizeRedisMap(normalized.values);
        if (!payload) throw new Error("Redis mset values are required");
        const result = await this.client.mSet(payload);
        return { result };
      }
      case "hgetall": {
        const value = await this.client.hGetAll(normalized.key);
        return { key: normalized.key, value };
      }
      case "hset": {
        const values = this._normalizeRedisMap(
          normalized.values,
          normalized.field,
          normalized.value,
        );
        if (!values) throw new Error("Redis hash values are required");
        const result = await this.client.hSet(normalized.key, values);
        return { key: normalized.key, result };
      }
      case "lrange": {
        const start = Number.isFinite(Number(normalized.start)) ? Number(normalized.start) : 0;
        const stop = Number.isFinite(Number(normalized.stop)) ? Number(normalized.stop) : 9;
        const values = await this.client.lRange(normalized.key, start, stop);
        return { key: normalized.key, values };
      }
      case "lpush": {
        const values = this._normalizeRedisValues(normalized.values);
        if (values.length === 0) throw new Error("Redis list values are required");
        const length = await this.client.lPush(normalized.key, values);
        return { key: normalized.key, length };
      }
      case "rpush": {
        const values = this._normalizeRedisValues(normalized.values);
        if (values.length === 0) throw new Error("Redis list values are required");
        const length = await this.client.rPush(normalized.key, values);
        return { key: normalized.key, length };
      }
      case "sadd": {
        const values = this._normalizeRedisValues(normalized.values);
        if (values.length === 0) throw new Error("Redis set values are required");
        const added = await this.client.sAdd(normalized.key, values);
        return { key: normalized.key, added };
      }
      case "srem": {
        const values = this._normalizeRedisValues(normalized.values);
        if (values.length === 0) throw new Error("Redis set values are required");
        const removed = await this.client.sRem(normalized.key, values);
        return { key: normalized.key, removed };
      }
      case "smembers": {
        const values = await this.client.sMembers(normalized.key);
        return { key: normalized.key, values };
      }
      case "zadd": {
        const values = this._normalizeRedisSortedSet(normalized.values);
        if (values.length === 0) throw new Error("Redis sorted set values are required");
        const added = await this.client.zAdd(normalized.key, values);
        return { key: normalized.key, added };
      }
      case "zrange": {
        const start = Number.isFinite(Number(normalized.start)) ? Number(normalized.start) : 0;
        const stop = Number.isFinite(Number(normalized.stop)) ? Number(normalized.stop) : 9;
        const values = await this.client.zRange(normalized.key, start, stop);
        return { key: normalized.key, values };
      }
      case "expire": {
        const result = await this.client.expire(normalized.key, Number(normalized.ttl) || 0);
        return { key: normalized.key, result };
      }
      case "expiremany": {
        const ttl = Number(normalized.ttl);
        if (!Number.isFinite(ttl) || ttl <= 0) {
          throw new Error("Redis TTL is required");
        }
        let keys = normalized.keys;
        if (!keys || keys.length === 0) {
          if (!normalized.pattern) {
            throw new Error("Redis keys or pattern are required");
          }
          keys = await this.getKeys(normalized.pattern);
          if (normalized.limit) {
            keys = keys.slice(0, normalized.limit);
          }
        }
        if (keys.length === 0) {
          return { updated: 0, total: 0 };
        }
        const pipeline = this.client.multi();
        keys.forEach((key) => pipeline.expire(key, ttl));
        const results = await pipeline.exec();
        let updated = 0;
        if (Array.isArray(results)) {
          for (const res of results) {
            if (res === 1 || res === true) updated++;
          }
        }
        return { updated, total: keys.length };
      }
      case "ttl": {
        const ttl = await this.client.ttl(normalized.key);
        return { key: normalized.key, ttl };
      }
      case "type": {
        const type = await this.client.type(normalized.key);
        return { key: normalized.key, type };
      }
      case "scan": {
        const keys = [];
        const match = normalized.pattern || "*";
        const count = Number.isFinite(Number(normalized.count)) ? Number(normalized.count) : 200;
        for await (const key of this.client.scanIterator({ MATCH: match, COUNT: count })) {
          keys.push(key);
          if (normalized.limit && keys.length >= normalized.limit) break;
        }
        return { keys };
      }
      case "command": {
        const command = String(normalized.command).toUpperCase();
        const args = this._coerceRedisArgs(normalized.args);
        const result = await this.client.sendCommand([command, ...args]);
        return { command, result };
      }
      default:
        throw new Error(`Unsupported Redis operation: ${operation}`);
    }
  }

  _buildRedisUrl(config = {}) {
    if (config.url) return config.url;
    const host = config.host || "localhost";
    const port = config.port || 6379;
    const auth =
      config.username && config.password
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
        : config.password
          ? `:${encodeURIComponent(config.password)}@`
          : "";
    const dbIndex = Number.isFinite(Number(config.database)) ? `/${config.database}` : "";
    return `redis://${auth}${host}:${port}${dbIndex}`;
  }

  async _getValuePreview(key, type) {
    if (!this.client) return null;
    const safeType = (type || "").toLowerCase();
    try {
      let preview = null;
      switch (safeType) {
        case "string":
          preview = await this.client.get(key);
          break;
        case "list":
          preview = await this.client.lRange(key, 0, 9);
          break;
        case "set": {
          const values = await this.client.sMembers(key);
          preview = values.slice(0, 10);
          break;
        }
        case "zset": {
          if (typeof this.client.zRangeWithScores === "function") {
            preview = await this.client.zRangeWithScores(key, 0, 9);
          } else {
            preview = await this.client.zRange(key, 0, 9);
          }
          break;
        }
        case "hash":
          preview = await this.client.hGetAll(key);
          break;
        default:
          preview = null;
      }

      if (preview === null || preview === undefined) return null;
      const serialized = typeof preview === "string" ? preview : JSON.stringify(preview, null, 2);
      if (serialized.length > 500) {
        return `${serialized.slice(0, 500)}...`;
      }
      return serialized;
    } catch (error) {
      logger.debug("Redis preview failed for %s: %s", key, error.message || error);
      return null;
    }
  }

  _normalizeRedisQuery(query, options = {}) {
    const raw = query && typeof query === "object" ? query : {};
    const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    const mergedOptions = {
      ...options,
      ...(raw.options && typeof raw.options === "object" ? raw.options : {}),
      ...(payload.options && typeof payload.options === "object" ? payload.options : {}),
    };

    const operation =
      raw.operation || raw.action || payload.operation || payload.action || raw.command;
    const normalizedOperation =
      typeof operation === "string" ? operation : raw.command || payload.command ? "command" : null;

    const key = raw.key || payload.key;
    const keys = raw.keys || payload.keys || (key ? [key] : []);
    const values = raw.values || payload.values || raw.value || payload.value;

    return {
      operation: normalizedOperation,
      key,
      keys: Array.isArray(keys) ? keys : [keys],
      value: raw.value || payload.value,
      values,
      field: raw.field || payload.field,
      ttl: raw.ttl || payload.ttl || mergedOptions.ttl,
      pattern: raw.pattern || payload.pattern,
      count: raw.count || payload.count,
      limit: mergedOptions.limit || mergedOptions.pageSize,
      start: raw.start || payload.start,
      stop: raw.stop || payload.stop,
      command: raw.command || payload.command,
      args: raw.args || payload.args,
      options: mergedOptions,
    };
  }

  _coerceRedisArgs(args) {
    if (!args) return [];
    if (Array.isArray(args)) return args.map((value) => String(value));
    return [String(args)];
  }

  _normalizeRedisValues(values) {
    if (values === undefined || values === null) return [];
    if (Array.isArray(values)) return values.map((value) => String(value));
    return [String(values)];
  }

  _normalizeRedisMap(values, field, value) {
    if (values && typeof values === "object" && !Array.isArray(values)) {
      return values;
    }
    if (field) {
      return { [field]: value ?? "" };
    }
    if (Array.isArray(values)) {
      const map = {};
      for (const entry of values) {
        if (Array.isArray(entry) && entry.length >= 2) {
          map[entry[0]] = entry[1];
        }
      }
      return Object.keys(map).length > 0 ? map : null;
    }
    return null;
  }

  _normalizeRedisSortedSet(values) {
    if (!values) return [];
    if (Array.isArray(values)) {
      return values
        .map((entry) => {
          if (entry && typeof entry === "object" && "score" in entry && "value" in entry) {
            return { score: Number(entry.score), value: String(entry.value) };
          }
          return null;
        })
        .filter(Boolean);
    }
    if (typeof values === "object" && "score" in values && "value" in values) {
      return [{ score: Number(values.score), value: String(values.value) }];
    }
    return [];
  }
}

module.exports = RedisStrategy;
