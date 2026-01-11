/**
 * @fileoverview Base controller class providing common functionality for all controllers
 * Includes standardized response handling, error management, and header extraction
 */

const logger = require("../../utils/logger");
const { HTTP_STATUS, GENERAL_ERRORS } = require("../../core/constants");

/**
 * Base controller class with common methods for all controllers
 * Provides consistent patterns for response handling and error management
 * Designed for extensibility and agent framework integration
 */
class BaseController {
  /**
   * Send standardized JSON response
   * @param {Object} res - Express response object
   * @param {number} status - HTTP status code
   * @param {Object|null} data - Response data (null if error)
   * @param {string|null} error - Error message (null if success)
   */
  sendResponse(res, status, data = null, error = null) {
    if (res.headersSent) {
      logger.warn("Attempted to send response after headers were sent");
      return;
    }

    const response = error ? { error, timestamp: new Date().toISOString() } : data;
    res.status(status).json(response);
  }

  /**
   * Send success response with data
   * @param {Object} res - Express response object
   * @param {Object} data - Response data
   * @param {number} status - HTTP status code (default: 200)
   */
  sendSuccess(res, data, status = HTTP_STATUS.OK) {
    this.sendResponse(res, status, { ...data, timestamp: new Date().toISOString() });
  }

  /**
   * Send error response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   * @param {number} status - HTTP status code (default: 500)
   */
  sendError(res, message, status = HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    this.sendResponse(res, status, null, message);
  }

  /**
   * Handle errors with categorization and appropriate HTTP status codes
   * @param {Object} res - Express response object
   * @param {Error} error - Error object
   * @param {string} operation - Operation description for logging
   */
  handleError(res, error, operation) {
    logger.error(`Error in ${operation}:`, error.message, error.stack);

    // SQL syntax errors
    if (
      error.message.includes("syntax error") ||
      error.code === "ER_PARSE_ERROR" ||
      error.sqlState === "42000" ||
      error.code === "42601" ||
      error.code === "ORA-00900" ||
      error.message.includes("SQLITE_ERROR")
    ) {
      return this.sendError(
        res,
        "SQL syntax error. Please check your query.",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    // Database-specific errors
    if (error.code || error.sqlState || error.number) {
      return this.sendError(res, `Database error: ${error.message}`, HTTP_STATUS.BAD_REQUEST);
    }

    // Connection errors
    if (error.message.includes("connection") || error.code === "ECONNREFUSED") {
      return this.sendError(res, "Database connection error", HTTP_STATUS.SERVICE_UNAVAILABLE);
    }

    // Validation errors
    if (error.name === "ValidationError" || error.message.includes("required")) {
      return this.sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
    }

    // Not found errors
    if (error.message.includes("not found") || error.code === "ENOENT") {
      return this.sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
    }

    // Authentication errors
    if (error.message.includes("unauthorized") || error.message.includes("authentication")) {
      return this.sendError(res, error.message, HTTP_STATUS.UNAUTHORIZED);
    }

    // Generic server error
    this.sendError(res, GENERAL_ERRORS.INTERNAL_SERVER_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }

  /**
   * Extract header value with support for case-insensitive variants
   * @param {Object} headers - Request headers object
   * @param {Array<string>} variants - Array of possible header name variants
   * @returns {string|null} Header value or null if not found
   */
  getHeaderValue(headers, variants) {
    if (!headers || !variants || !Array.isArray(variants)) {
      return null;
    }

    for (const variant of variants) {
      const value = headers[variant];
      if (value !== undefined && value !== null && value !== "") {
        return String(value).trim();
      }
    }

    return null;
  }

  /**
   * Extract single header by name (case-insensitive)
   * @param {Object} req - Express request object
   * @param {string} headerName - Header name to extract
   * @returns {string|null} Header value or null if not found
   */
  getHeader(req, headerName) {
    const normalized = headerName.toLowerCase();
    return req.get(normalized) || null;
  }

  /**
   * Validate required fields in request body
   * @param {Object} body - Request body
   * @param {Array<string>} requiredFields - Array of required field names
   * @returns {Object|null} Error object if validation fails, null if success
   */
  validateRequired(body, requiredFields) {
    const missing = requiredFields.filter((field) => {
      const value = body[field];
      return (
        value === undefined || value === null || (typeof value === "string" && value.trim() === "")
      );
    });

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missing.join(", ")}`,
        missingFields: missing,
      };
    }

    return { valid: true };
  }

  /**
   * Validate numeric field within range
   * @param {number} value - Value to validate
   * @param {number} min - Minimum allowed value
   * @param {number} max - Maximum allowed value
   * @param {string} fieldName - Field name for error message
   * @returns {Object} Validation result
   */
  validateRange(value, min, max, fieldName = "Value") {
    const num = parseInt(value, 10);

    if (isNaN(num)) {
      return {
        valid: false,
        error: `${fieldName} must be a valid number`,
      };
    }

    if (num < min || num > max) {
      return {
        valid: false,
        error: `${fieldName} must be between ${min} and ${max}`,
      };
    }

    return { valid: true, value: num };
  }

  /**
   * Sanitize string input to prevent injection attacks
   * @param {string} input - Input string to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeInput(input) {
    if (typeof input !== "string") {
      return input;
    }

    return input
      .trim()
      .replace(/[<>]/g, "") // Remove angle brackets
      .replace(/javascript:/gi, "") // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, ""); // Remove event handlers
  }

  /**
   * Parse pagination parameters from request
   * @param {Object} query - Request query parameters
   * @param {number} defaultPageSize - Default page size
   * @param {number} maxPageSize - Maximum allowed page size
   * @returns {Object} Parsed pagination parameters
   */
  parsePagination(query, defaultPageSize = 10, maxPageSize = 1000) {
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(query.pageSize) || defaultPageSize),
      maxPageSize,
    );

    return { page, pageSize };
  }

  /**
   * Build paginated response object
   * @param {Array} data - Data array
   * @param {number} page - Current page
   * @param {number} pageSize - Page size
   * @param {number} totalCount - Total count of items
   * @returns {Object} Paginated response
   */
  buildPaginatedResponse(data, page, pageSize, totalCount) {
    return {
      data,
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        totalCount,
        hasMore: page * pageSize < totalCount,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Wrap async route handler with error catching
   * Useful for reducing try-catch boilerplate in route handlers
   * @param {Function} fn - Async function to wrap
   * @returns {Function} Wrapped function with error handling
   */
  asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch((error) => {
        this.handleError(res, error, fn.name || "async operation");
      });
    };
  }

  /**
   * Log operation with context for debugging and agent monitoring
   * @param {string} operation - Operation name
   * @param {Object} context - Additional context data
   * @param {string} level - Log level (info, debug, warn, error)
   */
  logOperation(operation, context = {}, level = "info") {
    const logData = {
      operation,
      timestamp: new Date().toISOString(),
      ...context,
    };

    logger[level](`[${operation}]`, logData);
  }
}

module.exports = BaseController;
