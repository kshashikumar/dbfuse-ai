/**
 * @fileoverview Validation middleware for common request validations
 * Provides reusable middleware functions for header, body, and parameter validation
 */

const logger = require("../utils/logger");
const { HTTP_STATUS, HEADERS, HEADER_VARIANTS } = require("../core/constants");
const { PORT_RANGE } = require("../core/env");
const { getHeaderValue } = require("../utils/http");
const sanitizeHtml = require("sanitize-html");

/**
 * Validate that connection ID header is present
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateConnectionId = (req, res, next) => {
  const connectionId = getHeaderValue(req.headers, HEADER_VARIANTS.CONNECTION_ID);

  if (!connectionId) {
    logger.warn("Missing connection ID header");
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: `${HEADERS.CONNECTION_ID} header is required`,
      timestamp: new Date().toISOString(),
    });
  }

  req.connectionId = connectionId;
  next();
};

/**
 * Validate that database type header is present
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validateDbType = (req, res, next) => {
  const dbType = getHeaderValue(req.headers, HEADER_VARIANTS.DB_TYPE);

  if (!dbType) {
    logger.warn("Missing database type header");
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: `Database type (${HEADERS.DB_TYPE}) must be specified in headers`,
      timestamp: new Date().toISOString(),
    });
  }

  req.dbType = dbType;
  next();
};

/**
 * Create middleware to validate required fields in request body
 * @param {Array<string>} requiredFields - Array of required field names
 * @returns {Function} Express middleware function
 */
const validateRequired = (requiredFields) => {
  return (req, res, next) => {
    const missing = requiredFields.filter((field) => {
      const value = req.body[field];
      return (
        value === undefined || value === null || (typeof value === "string" && value.trim() === "")
      );
    });

    if (missing.length > 0) {
      logger.warn("Missing required fields:", missing);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Missing required fields: ${missing.join(", ")}`,
        missingFields: missing,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

/**
 * Validate port number is within acceptable range
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const validatePortRange = (req, res, next) => {
  const port = parseInt(req.body.PORT || req.body.port, 10);

  if (isNaN(port)) {
    // If no port provided or can't parse, let it through (may have default)
    return next();
  }

  if (port < PORT_RANGE.MIN || port > PORT_RANGE.MAX) {
    logger.warn(`Invalid port number: ${port}`);
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: `Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}`,
      provided: port,
      range: PORT_RANGE,
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

/**
 * Validate query parameter exists
 * @param {string} paramName - Name of query parameter to validate
 * @returns {Function} Express middleware function
 */
const validateQuery = (paramName) => {
  return (req, res, next) => {
    const value = req.query[paramName];

    if (!value || (typeof value === "string" && value.trim() === "")) {
      logger.warn(`Missing query parameter: ${paramName}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Query parameter '${paramName}' is required`,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

/**
 * Validate URL parameter exists
 * @param {string} paramName - Name of URL parameter to validate
 * @returns {Function} Express middleware function
 */
const validateParam = (paramName) => {
  return (req, res, next) => {
    const value = req.params[paramName];

    if (!value || (typeof value === "string" && value.trim() === "")) {
      logger.warn(`Missing URL parameter: ${paramName}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `URL parameter '${paramName}' is required`,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

/**
 * Validate numeric ID parameter
 * @param {string} paramName - Name of parameter to validate (default: 'id')
 * @returns {Function} Express middleware function
 */
const validateNumericId = (paramName = "id") => {
  return (req, res, next) => {
    const value = req.params[paramName];
    const numValue = parseInt(value, 10);

    if (isNaN(numValue) || numValue < 1) {
      logger.warn(`Invalid numeric ID: ${value}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Invalid ${paramName}. Must be a positive integer.`,
        provided: value,
        timestamp: new Date().toISOString(),
      });
    }

    req.params[`${paramName}Numeric`] = numValue;
    next();
  };
};

/**
 * Validate array body field
 * @param {string} fieldName - Name of field that should be an array
 * @param {number} minLength - Minimum array length (default: 1)
 * @returns {Function} Express middleware function
 */
const validateArray = (fieldName, minLength = 1) => {
  return (req, res, next) => {
    const value = req.body[fieldName];

    if (!Array.isArray(value)) {
      logger.warn(`Field ${fieldName} is not an array`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `${fieldName} must be an array`,
        timestamp: new Date().toISOString(),
      });
    }

    if (value.length < minLength) {
      logger.warn(`Array ${fieldName} has insufficient length: ${value.length}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `${fieldName} must contain at least ${minLength} item(s)`,
        provided: value.length,
        minimum: minLength,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
};

/**
 * Sanitize string inputs to prevent injection attacks
 * @param {Array<string>} fieldNames - Array of field names to sanitize
 * @returns {Function} Express middleware function
 */
const sanitizeInputs = (fieldNames) => {
  return (req, res, next) => {
    fieldNames.forEach((fieldName) => {
      const rawValue = req.body[fieldName];
      if (rawValue && typeof rawValue === "string") {
        const trimmedValue = rawValue.trim();
        req.body[fieldName] = sanitizeHtml(trimmedValue, {
          allowedTags: [],
          allowedAttributes: {},
        });
      }
    });
    next();
  };
};

/**
 * Validate pagination parameters
 * @param {number} maxPageSize - Maximum allowed page size (default: 1000)
 * @returns {Function} Express middleware function
 */
const validatePagination = (maxPageSize = 1000) => {
  return (req, res, next) => {
    const page = parseInt(req.query.page || req.body.page || 1, 10);
    const pageSize = parseInt(req.query.pageSize || req.body.pageSize || 10, 10);

    if (isNaN(page) || page < 1) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: "Page must be a positive integer",
        provided: req.query.page || req.body.page,
        timestamp: new Date().toISOString(),
      });
    }

    if (isNaN(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        error: `Page size must be between 1 and ${maxPageSize}`,
        provided: req.query.pageSize || req.body.pageSize,
        range: { min: 1, max: maxPageSize },
        timestamp: new Date().toISOString(),
      });
    }

    req.pagination = { page, pageSize };
    next();
  };
};

module.exports = {
  validateConnectionId,
  validateDbType,
  validateRequired,
  validatePortRange,
  validateQuery,
  validateParam,
  validateNumericId,
  validateArray,
  sanitizeInputs,
  validatePagination,
};
