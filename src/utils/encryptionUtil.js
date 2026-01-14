const crypto = require("crypto");
const { ENCODING } = require("../core/constants/http.constants");

/**
 * Encryption utility for secure data storage
 * Supports AES-256-GCM encryption with authentication
 */

const ENCRYPTION_CONFIG = Object.freeze({
  ALGORITHM: "aes-256-gcm",
  IV_LENGTH: 12,
  TAG_LENGTH: 16,
  KEY_LENGTH: 32,
  VERSION: 1,
});

/**
 * Check if a value is an encrypted document
 * @param {*} value - Value to check
 * @returns {boolean} True if encrypted
 */
const isEncrypted = (value) =>
  value &&
  typeof value === "object" &&
  value.__encrypted === true &&
  typeof value.payload === "string";

/**
 * Derive a 256-bit encryption key from a secret string
 * @param {string} secret - Secret string to derive key from
 * @returns {Buffer|null} Derived key or null if secret is empty
 */
const deriveKey = (secret) => {
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    return null;
  }
  return crypto.createHash("sha256").update(secret.trim(), ENCODING.UTF8).digest();
};

/**
 * Generate a random encryption key
 * @returns {Buffer} Random 256-bit key
 */
const generateKey = () => {
  return crypto.randomBytes(ENCRYPTION_CONFIG.KEY_LENGTH);
};

/**
 * Encrypt data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {Buffer} key - 256-bit encryption key
 * @returns {Object} Encrypted document with metadata
 * @throws {Error} If encryption fails
 */
const encrypt = (plaintext, key) => {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Plaintext must be a non-empty string");
  }

  if (!Buffer.isBuffer(key) || key.length !== ENCRYPTION_CONFIG.KEY_LENGTH) {
    throw new Error(`Key must be a ${ENCRYPTION_CONFIG.KEY_LENGTH}-byte Buffer`);
  }

  try {
    const iv = crypto.randomBytes(ENCRYPTION_CONFIG.IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, ENCODING.UTF8), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      __encrypted: true,
      version: ENCRYPTION_CONFIG.VERSION,
      algorithm: ENCRYPTION_CONFIG.ALGORITHM,
      iv: iv.toString(ENCODING.BASE64),
      authTag: authTag.toString(ENCODING.BASE64),
      payload: encrypted.toString(ENCODING.BASE64),
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

/**
 * Decrypt an encrypted document
 * @param {Object} document - Encrypted document from encrypt()
 * @param {Buffer} key - 256-bit encryption key
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails or authentication fails
 */
const decrypt = (document, key) => {
  if (!isEncrypted(document)) {
    throw new Error("Invalid encrypted document format");
  }

  if (!Buffer.isBuffer(key) || key.length !== ENCRYPTION_CONFIG.KEY_LENGTH) {
    throw new Error(`Key must be a ${ENCRYPTION_CONFIG.KEY_LENGTH}-byte Buffer`);
  }

  try {
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
  } catch (error) {
    // Authentication failure or wrong key
    if (error.message.includes("Unsupported state or unable to authenticate data")) {
      throw new Error("Decryption failed: Invalid key or corrupted data");
    }
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

/**
 * Re-encrypt data with a new key (key rotation)
 * @param {Object} encryptedDocument - Existing encrypted document
 * @param {Buffer} oldKey - Current encryption key
 * @param {Buffer} newKey - New encryption key
 * @returns {Object} Re-encrypted document
 * @throws {Error} If rotation fails
 */
const rotateKey = (encryptedDocument, oldKey, newKey) => {
  if (!isEncrypted(encryptedDocument)) {
    throw new Error("Invalid encrypted document for key rotation");
  }

  try {
    const plaintext = decrypt(encryptedDocument, oldKey);
    const newDocument = encrypt(plaintext, newKey);
    return {
      ...newDocument,
      rotatedAt: new Date().toISOString(),
      previousVersion: encryptedDocument.version,
    };
  } catch (error) {
    throw new Error(`Key rotation failed: ${error.message}`);
  }
};

/**
 * Get encryption metrics
 * @param {Object} document - Encrypted document
 * @returns {Object} Metrics about the encrypted document
 */
const getMetrics = (document) => {
  if (!isEncrypted(document)) {
    return { encrypted: false };
  }

  return {
    encrypted: true,
    version: document.version,
    algorithm: document.algorithm || ENCRYPTION_CONFIG.ALGORITHM,
    createdAt: document.createdAt,
    rotatedAt: document.rotatedAt || null,
    payloadSize: document.payload.length,
  };
};

module.exports = {
  encrypt,
  decrypt,
  deriveKey,
  generateKey,
  rotateKey,
  isEncrypted,
  getMetrics,
  ENCRYPTION_CONFIG,
};
