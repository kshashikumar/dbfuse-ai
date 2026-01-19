const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const { ENV_KEYS } = require("../core/env");
const { MCP_CONSTANTS, DEFAULT_CONFIG } = require("../core/constants");
const { encrypt, decrypt, deriveKey, isEncrypted } = require("../utils/encryptionUtil");
const logger = require("../utils/logger");

const CONNECTIONS_FILENAME = "dbConnections.json";
const DEFAULT_STATUS = "Available";
const ENCODING = "utf8";

// Metrics tracking
const metrics = {
  reads: 0,
  writes: 0,
  encryptions: 0,
  decryptions: 0,
  errors: 0,
};

const resolveConfigDirectory = () => {
  const override = process.env[ENV_KEYS.CONFIG_DIR];
  if (override && typeof override === "string" && override.trim()) {
    return path.resolve(override.trim());
  }
  return path.resolve(__dirname);
};

const resolveConnectionsPath = () => path.join(resolveConfigDirectory(), CONNECTIONS_FILENAME);

const getEncryptionKey = () => {
  const secret = process.env[ENV_KEYS.CONNECTIONS_KEY];
  if (!secret || !secret.trim()) {
    return null;
  }
  return deriveKey(secret);
};

/**
 * Validate connection record structure
 * @param {Object} record - Connection record to validate
 * @returns {Object} Validation result { valid, errors }
 */
const validateConnectionRecord = (record) => {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["Record must be an object"] };
  }

  const dbType = String(record.dbType || "").toLowerCase();
  const optionalHostTypes = new Set(["firestore", "dynamodb"]);
  const requiresHost = dbType !== "sqlite3" && !optionalHostTypes.has(dbType);
  const requiresUsername = ![
    "sqlite3",
    "mongodb",
    "redis",
    "couchdb",
    "cosmosdb",
    "firestore",
    "dynamodb",
    "cassandra",
    "hbase",
    "memcached",
  ].includes(dbType);

  // Required fields validation
  if (!record.dbType || typeof record.dbType !== "string") {
    errors.push("dbType is required and must be a string");
  }

  if (requiresHost && (!record.host || typeof record.host !== "string")) {
    errors.push("host is required and must be a string");
  }

  if (record.port !== undefined && typeof record.port !== "number" && isNaN(Number(record.port))) {
    errors.push("port must be a valid number");
  }

  if (requiresUsername && (!record.username || typeof record.username !== "string")) {
    errors.push("username is required and must be a string");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

const inspectConnectionStore = () => {
  const filePath = resolveConnectionsPath();
  if (!fs.existsSync(filePath)) {
    return { exists: false, encrypted: false, filePath };
  }

  try {
    const raw = fs.readFileSync(filePath, ENCODING);
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      encrypted: isEncrypted(parsed),
      filePath,
    };
  } catch (error) {
    metrics.errors++;
    return { exists: true, encrypted: false, filePath, error: error.message };
  }
};

const normalizeConnectionRecord = (record = {}) => {
  const normalized = {
    id: record.id ?? null,
    username: record.username ?? "",
    password: record.password ?? "",
    host: record.host ?? "",
    port: typeof record.port === "number" ? record.port : Number(record.port) || 0,
    dbType: record.dbType ?? "",
    database: record.database ?? "",
    socketPath: record.socketPath ?? "",
    ssl: Boolean(record.ssl),
    connectionTimeout:
      typeof record.connectionTimeout === "number"
        ? record.connectionTimeout
        : DEFAULT_CONFIG.CONNECTION_TIMEOUT,
    poolSize: typeof record.poolSize === "number" ? record.poolSize : DEFAULT_CONFIG.POOL_SIZE,
    status: record.status || DEFAULT_STATUS,
    createdAt: record.createdAt || new Date().toISOString(),
    lastUsed: record.lastUsed ?? null,
    metadata: record.metadata ?? undefined,
  };

  return normalized;
};

const stripSecrets = (record) => ({
  ...record,
  password: record.password ? "***" : "",
});

async function readConnections(options = {}) {
  const { hideSecrets = false } = options;
  const filePath = resolveConnectionsPath();
  metrics.reads++;

  try {
    const data = await fsp.readFile(filePath, ENCODING);
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseError) {
      metrics.errors++;
      logger.error("Connection store is corrupted: %o", parseError);
      const error = new Error("Connection store file is corrupted");
      error.code = "CONNECTION_STORE_CORRUPTED";
      error.filePath = filePath;
      throw error;
    }

    let records;
    if (isEncrypted(parsed)) {
      metrics.decryptions++;
      const key = getEncryptionKey();
      if (!key) {
        metrics.errors++;
        const error = new Error(
          "Encrypted connection store detected but DBFUSE_CONNECTIONS_KEY is not configured.",
        );
        error.code = "ENCRYPTED_STORE_KEY_REQUIRED";
        error.filePath = filePath;
        throw error;
      }

      try {
        const decryptedJson = decrypt(parsed, key);
        records = JSON.parse(decryptedJson);
      } catch (decryptError) {
        metrics.errors++;
        logger.error("Failed to decrypt connection store: %o", decryptError);
        const error = new Error(
          "Failed to decrypt connection store with the provided DBFUSE_CONNECTIONS_KEY.",
        );
        error.code = "ENCRYPTED_STORE_DECRYPT_FAILED";
        error.filePath = filePath;
        error.cause = decryptError;
        throw error;
      }
    } else if (Array.isArray(parsed)) {
      records = parsed;
    } else {
      logger.warn("Connection store file did not contain an array. Returning empty list.");
      return [];
    }

    return records.map((record) => {
      const normalized = normalizeConnectionRecord(record);
      return hideSecrets ? stripSecrets(normalized) : normalized;
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      logger.info("Connection store not found at %s. Returning empty array.", filePath);
      return [];
    }
    if (
      (error.code && error.code.startsWith("CONNECTION_STORE")) ||
      error.code === "ENCRYPTED_STORE_KEY_REQUIRED" ||
      error.code === "ENCRYPTED_STORE_DECRYPT_FAILED"
    ) {
      throw error;
    }
    metrics.errors++;
    logger.error("Failed to read connection store: %o", error);
    throw error;
  }
}

async function writeConnections(connections = []) {
  const filePath = resolveConnectionsPath();
  const directory = path.dirname(filePath);
  metrics.writes++;

  await fsp.mkdir(directory, { recursive: true });

  // Validate and normalize all connections
  const normalized = connections.map((record, index) => {
    const validation = validateConnectionRecord(record);
    if (!validation.valid) {
      logger.warn(
        `Connection record at index ${index} validation failed: ${validation.errors.join(", ")}`,
      );
    }

    const normalizedRecord = normalizeConnectionRecord(record);
    if (normalizedRecord.id === null || normalizedRecord.id === undefined) {
      normalizedRecord.id = record.id ?? index + 1;
    }
    return normalizedRecord;
  });

  const key = getEncryptionKey();
  const serialized = JSON.stringify(normalized, null, 2);

  if (key) {
    metrics.encryptions++;
    try {
      const encryptedDocument = encrypt(serialized, key);
      await fsp.writeFile(filePath, JSON.stringify(encryptedDocument, null, 2), {
        encoding: ENCODING,
      });
    } catch (error) {
      metrics.errors++;
      logger.error("Encryption failed while writing connections: %o", error);
      throw new Error(`Failed to encrypt connection store: ${error.message}`);
    }
    return normalized;
  }

  await fsp.writeFile(filePath, serialized, { encoding: ENCODING });
  return normalized;
}

async function deleteConnectionStore() {
  const filePath = resolveConnectionsPath();
  try {
    await fsp.unlink(filePath);
    logger.info("Deleted connection store at %s", filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      logger.info("Connection store already absent at %s", filePath);
      return false;
    }
    logger.error("Failed to delete connection store: %o", error);
    throw error;
  }
}

const buildConnectionSignature = (connection) => {
  const { dbType, host, port, database } = connection;
  const safeHost = host || "localhost";
  const safePort = port ? String(port) : "default";
  const safeDb = database || "default";
  return `${dbType || "unknown"}:${safeHost}:${safePort}:${safeDb}`.toLowerCase();
};

function findConnection(connections, identifier) {
  if (identifier === undefined || identifier === null) return null;
  const raw = typeof identifier === "string" ? identifier : String(identifier);
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Check mcp stored prefix (mcp:stored:<id>)
  const storedPrefixMatch = trimmed.match(
    new RegExp(
      `^${MCP_CONSTANTS.STORED_CONNECTION_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(.+)$`,
      "i",
    ),
  );
  if (storedPrefixMatch) {
    const storedId = storedPrefixMatch[1];
    const numeric = Number(storedId);
    if (!Number.isNaN(numeric)) {
      const match = connections.find((conn) => Number(conn.id) === numeric);
      if (match) return match;
    }
    return connections.find((conn) => String(conn.id) === storedId);
  }

  // Numeric id lookup
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    const match = connections.find((conn) => Number(conn.id) === numeric);
    if (match) return match;
  }

  // Exact id string match
  const idMatch = connections.find((conn) => String(conn.id) === trimmed);
  if (idMatch) return idMatch;

  // dbType only (only if unique)
  const dbTypeMatches = connections.filter((conn) => conn.dbType === trimmed);
  if (dbTypeMatches.length === 1) {
    return dbTypeMatches[0];
  }

  // signature match (dbType:host:port:database)
  const signatureMatch = connections.find(
    (conn) => buildConnectionSignature(conn) === trimmed.toLowerCase(),
  );
  if (signatureMatch) return signatureMatch;

  return null;
}

/**
 * Get connection store metrics
 * @returns {Object} Metrics about operations
 */
function getMetrics() {
  return { ...metrics };
}

/**
 * Reset connection store metrics
 */
function resetMetrics() {
  metrics.reads = 0;
  metrics.writes = 0;
  metrics.encryptions = 0;
  metrics.decryptions = 0;
  metrics.errors = 0;
}

module.exports = {
  readConnections,
  writeConnections,
  findConnection,
  resolveConnectionsPath,
  resolveConfigDirectory,
  buildConnectionSignature,
  normalizeConnectionRecord,
  deleteConnectionStore,
  inspectConnectionStore,
  validateConnectionRecord,
  getMetrics,
  resetMetrics,
};
