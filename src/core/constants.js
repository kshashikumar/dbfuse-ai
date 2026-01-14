/**
 * @fileoverview Backward compatibility layer for constants
 * @deprecated Use domain-specific imports from constants/ directory instead
 * Example: const { HTTP_STATUS } = require('./constants/http.constants');
 */

// Re-export all constants from modular structure for backward compatibility
module.exports = require("./constants/index.js");
