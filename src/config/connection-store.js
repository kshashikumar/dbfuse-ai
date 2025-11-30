const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const { ENV_KEYS } = require("../core/env");
const { MCP_CONSTANTS, DEFAULT_CONFIG, ENCODING } = require("../core/constants");
const logger = require("../utils/logger");

const CONNECTIONS_FILENAME = "dbConnections.json";
const DEFAULT_STATUS = "Available";
const ENCRYPTION_CONFIG = Object.freeze({
  ALGORITHM: "aes-256-gcm",
  IV_LENGTH: 12,
  TAG_LENGTH: 16,
});

const isEncryptedDocument = (value) =>
  value &&
  typeof value === "object" &&
  value.__encrypted === true &&
  typeof value.payload === "string";

const deriveEncryptionKey = () => {
  const secret = process.env[ENV_KEYS.CONNECTIONS_KEY];
  if (!secret || !secret.trim()) {
    return null;
  }
  return crypto.createHash("sha256").update(secret.trim(), ENCODING.UTF8).digest();
};

const encryptPayload = (plaintext, key) => {
  const iv = crypto.randomBytes(ENCRYPTION_CONFIG.IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, ENCODING.UTF8), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    __encrypted: true,
    version: 1,
    iv: iv.toString(ENCODING.BASE64),
    authTag: authTag.toString(ENCODING.BASE64),
    payload: encrypted.toString(ENCODING.BASE64),
    createdAt: new Date().toISOString(),
  };
};

const decryptPayload = (document, key) => {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_CONFIG.ALGORITHM,
    key,
    Buffer.from(document.iv, ENCODING.BASE64),
  );
  decipher.setAuthTag(Buffer.from(document.authTag, ENCODING.BASE64));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(document.payload, ENCODING.BASE64)),
    decipher.final(),
  ]);
  return decrypted.toString(ENCODING.UTF8);
};

const resolveConfigDirectory = () => {
  const override = process.env[ENV_KEYS.CONFIG_DIR];
  if (override && typeof override === "string" && override.trim()) {
    return path.resolve(override.trim());
  }
  return path.resolve(__dirname);
};

const resolveConnectionsPath = () => path.join(resolveConfigDirectory(), CONNECTIONS_FILENAME);

const inspectConnectionStore = () => {
  const filePath = resolveConnectionsPath();
  if (!fs.existsSync(filePath)) {
    return { exists: false, encrypted: false, filePath };
  }

  try {
    const raw = fs.readFileSync(filePath, ENCODING.UTF8);
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      encrypted: isEncryptedDocument(parsed),
      filePath,
    };
  } catch (error) {
    return { exists: true, encrypted: false, filePath, error };
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

  try {
    const data = await fsp.readFile(filePath, ENCODING.UTF8);
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseError) {
      logger.error("Connection store is corrupted: %o", parseError);
      throw parseError;
    }

    let records;
    if (isEncryptedDocument(parsed)) {
      const key = deriveEncryptionKey();
      if (!key) {
        const missingKeyError = new Error(
          "Encrypted connection store detected but DBFUSE_CONNECTIONS_KEY is not configured.",
        );
        missingKeyError.code = "ENCRYPTED_STORE_KEY_REQUIRED";
        missingKeyError.filePath = filePath;
        throw missingKeyError;
      }

      try {
        const decryptedJson = decryptPayload(parsed, key);
        records = JSON.parse(decryptedJson);
      } catch (decryptError) {
        logger.error("Failed to decrypt connection store: %o", decryptError);
        const wrapped = new Error(
          "Failed to decrypt connection store with the provided DBFUSE_CONNECTIONS_KEY.",
        );
        wrapped.code = "ENCRYPTED_STORE_DECRYPT_FAILED";
        wrapped.filePath = filePath;
        wrapped.cause = decryptError;
        throw wrapped;
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
    logger.error("Failed to read connection store: %o", error);
    throw error;
  }
}

async function writeConnections(connections = []) {
  const filePath = resolveConnectionsPath();
  const directory = path.dirname(filePath);

  await fsp.mkdir(directory, { recursive: true });

  const normalized = connections.map((record, index) => {
    const normalizedRecord = normalizeConnectionRecord(record);
    if (normalizedRecord.id === null || normalizedRecord.id === undefined) {
      normalizedRecord.id = record.id ?? index + 1;
    }
    return normalizedRecord;
  });

  const key = deriveEncryptionKey();
  const serialized = JSON.stringify(normalized, null, 2);
  if (key) {
    const encryptedDocument = encryptPayload(serialized, key);
    await fsp.writeFile(filePath, JSON.stringify(encryptedDocument, null, 2), {
      encoding: ENCODING.UTF8,
    });
    return normalized;
  }

  await fsp.writeFile(filePath, serialized, { encoding: ENCODING.UTF8 });
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
};
