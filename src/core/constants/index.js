/**
 * @fileoverview Centralized constants export
 * Provides backward compatibility while organizing constants by domain
 * Import from domain-specific files for better tree-shaking
 */

const {
  DB_TYPES,
  QUERY_TYPES,
  ERROR_MESSAGES,
  DEFAULT_CONFIG,
  CONNECTION_STATES,
  DB_DEFAULTS,
} = require("./database.constants");

const {
  HTTP_STATUS,
  HEADERS,
  HEADER_VARIANTS,
  ENCODING,
  GENERAL_ERRORS,
  buildHeaderVariants,
} = require("./http.constants");

const {
  DEFAULT_MODEL_TEMPERATURE,
  FALLBACK_AI_MODEL,
  PERPLEXITY_API_BASE_URL,
  SCHEMA_PROMPT_BUDGET_CHARS,
  AI_MODELS,
} = require("./ai.constants");

const {
  BASIC_AUTH_SCHEME,
  AUTH_REALM,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  AUTH_MESSAGES,
} = require("./auth.constants");

const { MCP_CONSTANTS, MCP_ENV_VARS, MCP_MESSAGES } = require("./mcp.constants");

const { CONFIG_MESSAGES } = require("./config.constants");

// Export all constants for backward compatibility
module.exports = {
  // Database constants
  DB_TYPES,
  QUERY_TYPES,
  ERROR_MESSAGES,
  DEFAULT_CONFIG,
  CONNECTION_STATES,
  DB_DEFAULTS,

  // HTTP constants
  HTTP_STATUS,
  HEADERS,
  HEADER_VARIANTS,
  ENCODING,
  GENERAL_ERRORS,
  buildHeaderVariants,

  // AI constants
  DEFAULT_MODEL_TEMPERATURE,
  FALLBACK_AI_MODEL,
  PERPLEXITY_API_BASE_URL,
  SCHEMA_PROMPT_BUDGET_CHARS,
  AI_MODELS,

  // Auth constants
  BASIC_AUTH_SCHEME,
  AUTH_REALM,
  BASIC_TOKEN_RESPONSE_KEY,
  AUTH_STATE_KEY,
  AUTH_MESSAGES,

  // MCP constants
  MCP_CONSTANTS,
  MCP_ENV_VARS,
  MCP_MESSAGES,

  // Config constants
  CONFIG_MESSAGES,
};
