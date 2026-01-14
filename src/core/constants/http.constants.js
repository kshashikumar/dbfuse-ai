/**
 * @fileoverview HTTP-related constants
 * Contains HTTP status codes, headers, and encoding settings
 */

/**
 * Build header name variants for case-insensitive matching
 * @param {string} headerName - Header name to build variants for
 * @returns {Array<string>} Array of header name variants
 */
const buildHeaderVariants = (headerName) => {
  const lower = headerName.toLowerCase();
  const upper = headerName.toUpperCase();
  const title = headerName
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join("-");
  return Array.from(new Set([lower, upper, title]));
};

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
};

const HEADERS = {
  DB_TYPE: "x-db-type",
  CONNECTION_ID: "x-connection-id",
  CONTENT_TYPE: "application/json",
  AUTHORIZATION: "authorization",
  WWW_AUTHENTICATE: "www-authenticate",
};

const HEADER_VARIANTS = {
  DB_TYPE: buildHeaderVariants("x-db-type"),
  CONNECTION_ID: buildHeaderVariants("x-connection-id"),
};

const ENCODING = Object.freeze({
  UTF8: "utf8",
  ASCII: "ascii",
  BASE64: "base64",
});

const GENERAL_ERRORS = Object.freeze({
  INTERNAL_SERVER_ERROR: "Internal Server Error",
});

module.exports = {
  HTTP_STATUS,
  HEADERS,
  HEADER_VARIANTS,
  ENCODING,
  GENERAL_ERRORS,
  buildHeaderVariants,
};
