// db_strategies/redis-strategy.js
const logger = require("../../utils/logger");
const { limitSample } = require("../../utils/metadata-sampler");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

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
    } catch {
      throw new Error(
        "Redis driver not installed. Add 'redis' to dependencies to enable Redis support.",
      );
    }

    const url = this._buildRedisUrl(config);
    const socket = this._buildRedisSocketOptions(config);
    this.client = createClient({ url, socket });
    this.client.on("error", (err) => logger.error("Redis client error:", err));
    await this.client.connect();
    this.connectionConfig = config;
    const parsedDb = this._parseDbIndex(config?.database);
    this.currentDatabase = Number.isFinite(parsedDb) ? parsedDb : 0;
    logger.info("Redis connection established");
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch (err) {
      logger.error("Redis connection validation failed:", err);
      return false;
    }
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
    let keyspaceInfo = "";
    try {
      keyspaceInfo = await this.client.info("keyspace");
    } catch (error) {
      logger.debug("Redis INFO keyspace failed:", error?.message || error);
      keyspaceInfo = "";
    }

    const keyspaces = this._parseKeyspaceInfo(keyspaceInfo);
    if (keyspaces.length > 0) {
      return keyspaces.map((entry) => ({
        name: entry.name,
        sizeOnDisk: 0,
        tables: [],
        views: [],
        keyCount: entry.keys,
        expires: entry.expires,
        avgTtl: entry.avgTtl,
      }));
    }

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

  async getCollections(dbName) {
    if (dbName && typeof this.switchDatabase === "function") {
      await this.switchDatabase(dbName);
    }
    return this.getTables();
  }

  async getTableInfo(dbName, tableName) {
    if (!this.client) throw new Error("Redis connection not initialized");
    const prefix = tableName || "default";
    const pattern = prefix === "default" ? "*" : `${prefix}:*`;
    const keys = await this.getKeys(pattern);
    const sampled = limitSample(keys, 25);

    const columns = [];
    const sampleKeys = [];
    for (const key of sampled) {
      let dataType = "unknown";
      let ttl = null;
      let valuePreview = null;
      try {
        dataType = await this.client.type(key);
        ttl = await this.client.ttl(key);
        if (ttl === -2) {
          continue;
        }
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

  async getCollectionInfo(dbName, collectionName) {
    return this.getTableInfo(dbName, collectionName);
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
      case "incr":
      case "incrby": {
        const delta = Number.isFinite(Number(normalized.delta)) ? Number(normalized.delta) : 1;
        const result = await this.client.sendCommand(["INCRBY", normalized.key, String(delta)]);
        return { key: normalized.key, value: Number(result) };
      }
      case "decr":
      case "decrby": {
        const delta = Number.isFinite(Number(normalized.delta)) ? Number(normalized.delta) : 1;
        const result = await this.client.sendCommand(["DECRBY", normalized.key, String(delta)]);
        return { key: normalized.key, value: Number(result) };
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
      case "getset": {
        const result = await this.client.sendCommand([
          "GETSET",
          normalized.key,
          String(normalized.value ?? ""),
        ]);
        return { key: normalized.key, value: result };
      }
      case "setnx": {
        const result = await this.client.sendCommand([
          "SETNX",
          normalized.key,
          String(normalized.value ?? ""),
        ]);
        return { key: normalized.key, result: result === 1 || result === "1" };
      }
      case "setex": {
        const ttl = Number(normalized.ttl);
        if (!Number.isFinite(ttl) || ttl <= 0) {
          throw new Error("Redis TTL is required");
        }
        const result = await this.client.sendCommand([
          "SETEX",
          normalized.key,
          String(ttl),
          String(normalized.value ?? ""),
        ]);
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
      case "llen": {
        const length = await this.client.sendCommand(["LLEN", normalized.key]);
        return { key: normalized.key, length: Number(length) };
      }
      case "lpop":
      case "rpop": {
        const count = Number.isFinite(Number(normalized.count)) ? Number(normalized.count) : null;
        const command = op === "lpop" ? "LPOP" : "RPOP";
        const args = count ? [command, normalized.key, String(count)] : [command, normalized.key];
        const result = await this.client.sendCommand(args);
        if (count) {
          return { key: normalized.key, values: Array.isArray(result) ? result : [result] };
        }
        return { key: normalized.key, value: result };
      }
      case "blpop":
      case "brpop": {
        const keys = normalized.keys || [];
        if (keys.length === 0) throw new Error("Redis keys are required");
        const timeout = Number.isFinite(Number(normalized.timeout))
          ? Number(normalized.timeout)
          : 1;
        const command = op === "blpop" ? "BLPOP" : "BRPOP";
        const result = await this.client.sendCommand([command, ...keys, String(timeout)]);
        if (Array.isArray(result) && result.length >= 2) {
          return { key: result[0], value: result[1] };
        }
        return { result };
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
      case "sunion": {
        const keys = normalized.keys || [];
        if (keys.length === 0) throw new Error("Redis keys are required");
        const values = await this.client.sendCommand(["SUNION", ...keys]);
        return { keys, values };
      }
      case "sinter": {
        const keys = normalized.keys || [];
        if (keys.length === 0) throw new Error("Redis keys are required");
        const values = await this.client.sendCommand(["SINTER", ...keys]);
        return { keys, values };
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
      case "zrangebyscore": {
        const min = normalized.min ?? "-inf";
        const max = normalized.max ?? "+inf";
        const args = ["ZRANGEBYSCORE", normalized.key, String(min), String(max)];
        if (normalized.withScores) {
          args.push("WITHSCORES");
        }
        if (
          Number.isFinite(Number(normalized.offset)) &&
          Number.isFinite(Number(normalized.count))
        ) {
          args.push("LIMIT", String(Number(normalized.offset)), String(Number(normalized.count)));
        }
        const values = await this.client.sendCommand(args);
        return { key: normalized.key, values };
      }
      case "zrem": {
        const members = this._normalizeRedisValues(normalized.members || normalized.values);
        if (members.length === 0) throw new Error("Redis sorted set members are required");
        const removed = await this.client.sendCommand(["ZREM", normalized.key, ...members]);
        return { key: normalized.key, removed: Number(removed) };
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
      case "publish": {
        const channel = normalized.channel || normalized.key;
        if (!channel) throw new Error("Redis channel is required");
        const message = normalized.message ?? normalized.value ?? "";
        const subscribers = await this.client.publish(channel, String(message));
        return { channel, subscribers };
      }
      case "subscribe": {
        const channels = normalized.channels?.length
          ? normalized.channels
          : normalized.channel
            ? [normalized.channel]
            : [];
        if (channels.length === 0) throw new Error("Redis channel is required");
        if (typeof this.client.duplicate !== "function") {
          throw new Error("Redis client does not support subscriptions");
        }

        const limit = Number.isFinite(Number(normalized.limit)) ? Number(normalized.limit) : 1;
        const timeoutMs = Number.isFinite(Number(normalized.timeoutMs))
          ? Number(normalized.timeoutMs)
          : Number.isFinite(Number(normalized.timeout))
            ? Number(normalized.timeout) * 1000
            : 1000;

        const subscriber = this.client.duplicate();
        await subscriber.connect();

        const messages = [];
        let resolveDone;
        const done = new Promise((resolve) => {
          resolveDone = resolve;
        });

        const pushMessage = (message, channel) => {
          messages.push({ channel, message });
          if (messages.length >= limit) {
            resolveDone();
          }
        };

        await Promise.all(
          channels.map((channel) =>
            subscriber.subscribe(channel, (message) => pushMessage(message, channel)),
          ),
        );

        let timer = null;
        if (timeoutMs > 0) {
          timer = setTimeout(() => resolveDone(), timeoutMs);
        }

        await done;

        if (timer) clearTimeout(timer);

        await Promise.all(
          channels.map((channel) => subscriber.unsubscribe(channel).catch(() => {})),
        );
        await subscriber.disconnect();

        return { channels, messages, count: messages.length };
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
    const useTls =
      config.protocol === "rediss" ||
      config.protocol === "redis+tls" ||
      config.ssl === true ||
      config.tls === true ||
      (typeof config.ssl === "object" && config.ssl !== null);
    const protocol = useTls ? "rediss" : "redis";
    const host = this.normalizeHost(config.host || "localhost");
    const port = config.port || 6379;
    const auth =
      config.username && config.password
        ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
        : config.password
          ? `:${encodeURIComponent(config.password)}@`
          : "";
    const rawDb = config.database;
    const numericDb = this._parseDbIndex(rawDb);
    const dbIndex = Number.isFinite(numericDb) ? `/${numericDb}` : "";
    return `${protocol}://${auth}${host}:${port}${dbIndex}`;
  }

  _buildRedisSocketOptions(config = {}) {
    const socket = {};
    const connectTimeout = Number(config.connectionTimeout);
    if (Number.isFinite(connectTimeout) && connectTimeout > 0) {
      socket.connectTimeout = connectTimeout;
    }

    const tlsOptions = this._resolveTlsOptions(config);
    if (tlsOptions) {
      socket.tls = true;
      Object.assign(socket, tlsOptions);
    }

    return socket;
  }

  _resolveTlsOptions(config = {}) {
    if (typeof config.ssl === "object" && config.ssl !== null) {
      return config.ssl;
    }
    if (typeof config.tls === "object" && config.tls !== null) {
      return config.tls;
    }
    if (
      config.protocol === "rediss" ||
      config.protocol === "redis+tls" ||
      config.ssl === true ||
      config.tls === true
    ) {
      return {};
    }
    return null;
  }

  _parseDbIndex(value) {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const numericRaw = raw.startsWith("db") ? raw.slice(2) : raw;
    const numeric = Number(numericRaw);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return numeric;
  }

  _normalizeKeyGroup(key) {
    if (!key) return "default";
    const raw = String(key);
    return raw.includes(":") ? raw.split(":")[0] : "default";
  }

  _parseKeyspaceInfo(info) {
    const lines = String(info || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = [];
    for (const line of lines) {
      if (!line.startsWith("db")) continue;
      const [name, stats] = line.split(":", 2);
      if (!name || !stats) continue;
      const payload = {};
      for (const part of stats.split(",")) {
        const [key, value] = part.split("=");
        if (!key) continue;
        payload[key.trim()] = value;
      }
      entries.push({
        name,
        keys: Number(payload.keys) || 0,
        expires: Number(payload.expires) || 0,
        avgTtl: Number(payload.avg_ttl) || 0,
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
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
    const { raw, payload } = getQueryParts(query);
    const mergedOptions = {
      ...options,
      ...(raw.options && typeof raw.options === "object" ? raw.options : {}),
      ...(payload.options && typeof payload.options === "object" ? payload.options : {}),
    };

    const normalizedOperation = resolveOperation(raw, payload, {
      defaultOperation: null,
      commandFallback: true,
      coerceNonString: false,
    });

    const key = raw.key || payload.key;
    const keys = raw.keys || payload.keys || (key ? [key] : []);
    const values = raw.values || payload.values || raw.value || payload.value;
    const channel = raw.channel || payload.channel;
    const channels = raw.channels || payload.channels || (channel ? [channel] : []);

    return {
      operation: normalizedOperation,
      key,
      keys: Array.isArray(keys) ? keys : [keys],
      value: raw.value || payload.value,
      values,
      delta: raw.delta || payload.delta,
      field: raw.field || payload.field,
      ttl: raw.ttl || payload.ttl || mergedOptions.ttl,
      pattern: raw.pattern || payload.pattern,
      count: raw.count || payload.count,
      limit: mergedOptions.limit || mergedOptions.pageSize,
      offset: raw.offset || payload.offset,
      start: raw.start || payload.start,
      stop: raw.stop || payload.stop,
      min: raw.min || payload.min,
      max: raw.max || payload.max,
      withScores: raw.withScores ?? payload.withScores ?? mergedOptions.withScores,
      members: raw.members || payload.members,
      channel,
      channels: Array.isArray(channels) ? channels : [channels],
      message: raw.message || payload.message,
      timeout: raw.timeout || payload.timeout || mergedOptions.timeout,
      timeoutMs: raw.timeoutMs || payload.timeoutMs || mergedOptions.timeoutMs,
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
