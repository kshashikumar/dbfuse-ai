/**
 * @fileoverview Authentication utility functions
 * Provides credential encoding/decoding and token management
 */

const { ENCODING, BASIC_AUTH_SCHEME } = require("../core/constants");

const logger = require("./logger");

/**
 * Decode Basic Auth credentials from Authorization header
 * @param {string} header - Authorization header value
 * @returns {Array<string>} Array containing [username, password] or empty array on failure
 */
function decodeCredentials(header) {
  try {
    if (!header || typeof header !== "string") {
      return [];
    }

    const base64Part = header.trim().replace(/^Basic\s+/i, "");
    const clean = base64Part.replace(/^Basic\s+/i, "");

    const decoded = Buffer.from(clean, ENCODING.BASE64).toString(ENCODING.ASCII);
    const [username, password] = decoded.split(":");

    if (!username || !password) {
      return [];
    }

    return [username, password];
  } catch {
    logger.warn("Failed to decode basic auth credentials");
    return [];
  }
}

/**
 * Encode credentials into Basic Auth token
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {string} Basic Auth token
 */
function encodeCredentials(username, password) {
  const credentials = `${username}:${password}`;
  const encoded = Buffer.from(credentials, ENCODING.UTF8).toString(ENCODING.BASE64);
  return `${BASIC_AUTH_SCHEME}${encoded}`;
}

/**
 * Verify credentials against environment variables
 * @param {string} username - Username to verify
 * @param {string} password - Password to verify
 * @returns {boolean} True if credentials match environment variables
 */
function verifyCredentials(username, password) {
  const envUsername = process.env.DBFUSE_USERNAME;
  const envPassword = process.env.DBFUSE_PASSWORD;

  // If no auth configured, allow access
  if (!envUsername || !envPassword) {
    return true;
  }

  return username === envUsername && password === envPassword;
}

/**
 * Check if authentication is required
 * @returns {boolean} True if authentication is required
 */
function isAuthRequired() {
  return Boolean(process.env.DBFUSE_USERNAME && process.env.DBFUSE_PASSWORD);
}

/**
 * Sanitize username to prevent injection
 * @param {string} username - Username to sanitize
 * @returns {string} Sanitized username
 */
function sanitizeUsername(username) {
  if (typeof username !== "string") {
    return "";
  }

  return username
    .trim()
    .replace(/[<>'"]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 255);
}

/**
 * Create auth token with expiry timestamp (for future JWT implementation)
 * @param {string} username - Username
 * @param {string} password - Password
 * @param {number} expiryHours - Hours until token expires (default: 24)
 * @returns {Object} Token object with value and expiry
 */
function createToken(username, password, expiryHours = 24) {
  const token = encodeCredentials(username, password);
  const expiryTime = new Date();
  expiryTime.setHours(expiryTime.getHours() + expiryHours);

  return {
    token,
    expiresAt: expiryTime.toISOString(),
    expiresIn: expiryHours * 3600, // seconds
  };
}

/**
 * Validate token format (Basic Auth)
 * @param {string} token - Token to validate
 * @returns {boolean} True if token format is valid
 */
function validateTokenFormat(token) {
  if (!token || typeof token !== "string") {
    return false;
  }

  // Check Basic Auth format
  if (!token.trim().toLowerCase().startsWith("basic ")) {
    return false;
  }

  // Try to decode
  const [username, password] = decodeCredentials(token);
  return Boolean(username && password);
}

module.exports = {
  decodeCredentials,
  encodeCredentials,
  verifyCredentials,
  isAuthRequired,
  sanitizeUsername,
  createToken,
  validateTokenFormat,
};
