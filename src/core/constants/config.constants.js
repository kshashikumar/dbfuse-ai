/**
 * @fileoverview Configuration-related constants
 * Contains configuration messages and validation settings
 */

const { PORT_RANGE } = require("../env");

const CONFIG_MESSAGES = Object.freeze({
  LOAD_ERROR: "Failed to load configuration",
  SAVE_ERROR: "Failed to save configuration",
  SAVE_SUCCESS: "Configuration saved successfully",
  SAVE_SUCCESS_PORT_CHANGE:
    "Configuration saved successfully. Server will restart to apply port changes...",
  USERNAME_REQUIRED: "Database username is required",
  PORT_RANGE_INVALID: `Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}`,
  INVALID_CONFIG: "Invalid configuration data",
  CONFIG_VERSION_MISMATCH: "Configuration version mismatch",
});

module.exports = {
  CONFIG_MESSAGES,
};
