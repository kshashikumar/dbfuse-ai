/**
 * @fileoverview Configuration service
 * Handles reading, writing, and validating .env configuration files
 * Provides transaction safety and version control for agent framework integration
 */

const fs = require("fs");
const path = require("path");

const logger = require("../utils/logger");
const {
  SERVER_DEFAULT_PORT,
  PORT_RANGE,
  ENV_KEYS,
  ENV_OVERLAY_KEYS,
  DEFAULT_ENV_VALUES,
  DEFAULT_ENV_FILE_CONTENT,
  normalizeProvider,
  inferProviderFromModel,
  PROVIDER_API_ENV_KEYS,
} = require("../core/env");
const { ENCODING } = require("../core/constants");

/**
 * @typedef {Object} ConfigData
 * @property {string} AI_MODEL - AI model name
 * @property {string} AI_API_KEY - AI API key
 * @property {string} AI_PROVIDER - AI provider name
 * @property {number} PORT - Server port
 * @property {string} DBFUSE_USERNAME - Username for basic auth
 * @property {string} DBFUSE_PASSWORD - Password for basic auth
 * @property {string} DBFUSE_CONNECTIONS_KEY - Encryption key for connections
 */

class ConfigService {
  constructor() {
    this.configDir = this._resolveConfigDir();
    this.envPath = path.join(this.configDir, ".env");
    this.backupPath = path.join(this.configDir, ".env.backup");
  }

  /**
   * Resolve config directory consistently across environments
   * @private
   * @returns {string} Config directory path
   */
  _resolveConfigDir() {
    const explicit = process.env[ENV_KEYS.CONFIG_DIR];
    if (explicit && typeof explicit === "string" && explicit.trim()) {
      return explicit.trim();
    }
    // Default to project root
    return path.resolve(__dirname, "../../");
  }

  /**
   * Create backup of current .env file
   * @private
   * @returns {boolean} True if backup created successfully
   */
  _createBackup() {
    try {
      if (fs.existsSync(this.envPath)) {
        const content = fs.readFileSync(this.envPath, ENCODING.UTF8);
        fs.writeFileSync(this.backupPath, content, { encoding: ENCODING.UTF8 });
        logger.debug("Created .env backup");
        return true;
      }
      return false;
    } catch (error) {
      logger.error("Failed to create .env backup:", error);
      return false;
    }
  }

  /**
   * Restore .env from backup
   * @private
   * @returns {boolean} True if restored successfully
   */
  _restoreBackup() {
    try {
      if (fs.existsSync(this.backupPath)) {
        const content = fs.readFileSync(this.backupPath, ENCODING.UTF8);
        fs.writeFileSync(this.envPath, content, { encoding: ENCODING.UTF8 });
        logger.info("Restored .env from backup");
        return true;
      }
      return false;
    } catch (error) {
      logger.error("Failed to restore .env from backup:", error);
      return false;
    }
  }

  /**
   * Parse .env file content into config object
   * @private
   * @param {string} content - .env file content
   * @returns {Object} Parsed configuration
   */
  _parseEnvContent(content) {
    const config = {};

    content.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        const [key, ...valueParts] = trimmedLine.split("=");
        if (key && valueParts.length > 0) {
          let value = valueParts.join("=").replace(/^"|"$/g, ""); // Remove quotes

          // Type conversion
          if (key === ENV_KEYS.PORT) {
            value = parseInt(value) || SERVER_DEFAULT_PORT;
          }

          config[key.trim()] = value;
        }
      }
    });

    return config;
  }

  /**
   * Apply environment variable overlays
   * @private
   * @param {Object} config - Base configuration
   * @returns {Object} Configuration with overlays applied
   */
  _applyOverlays(config) {
    ENV_OVERLAY_KEYS.forEach((key) => {
      if (process.env[key] != null && process.env[key] !== "") {
        if (key === ENV_KEYS.PORT) {
          config[key] = parseInt(process.env[key]) || config[key] || SERVER_DEFAULT_PORT;
        } else {
          config[key] = process.env[key];
        }
      }
    });

    return config;
  }

  /**
   * Normalize AI provider and infer from model if needed
   * @private
   * @param {Object} config - Configuration object
   * @returns {Object} Configuration with normalized provider
   */
  _normalizeAIConfig(config) {
    config.AI_PROVIDER = normalizeProvider(
      config.AI_PROVIDER || inferProviderFromModel(config.AI_MODEL),
    );

    // Surface provider-specific API key if AI_API_KEY is empty
    if (!config.AI_API_KEY || String(config.AI_API_KEY).trim() === "") {
      const providerKey = PROVIDER_API_ENV_KEYS[config.AI_PROVIDER];
      if (providerKey && process.env[providerKey]) {
        config.AI_API_KEY = process.env[providerKey];
      }
    }

    return config;
  }

  /**
   * Read configuration from .env file
   * @returns {ConfigData} Configuration object
   */
  readConfig() {
    try {
      // Create default .env if doesn't exist
      if (!fs.existsSync(this.envPath)) {
        fs.writeFileSync(this.envPath, DEFAULT_ENV_FILE_CONTENT, {
          encoding: ENCODING.UTF8,
        });
        logger.info("Created default .env file");
      }

      const envContent = fs.readFileSync(this.envPath, ENCODING.UTF8);
      let config = this._parseEnvContent(envContent);

      // Apply overlays from environment
      config = this._applyOverlays(config);

      // Set defaults for missing values
      if (typeof config[ENV_KEYS.CONNECTIONS_KEY] === "undefined") {
        config[ENV_KEYS.CONNECTIONS_KEY] = DEFAULT_ENV_VALUES[ENV_KEYS.CONNECTIONS_KEY];
      }

      // Normalize AI configuration
      config = this._normalizeAIConfig(config);

      logger.debug("Configuration loaded successfully");
      return config;
    } catch (error) {
      logger.error("Error reading configuration:", error);
      // Return defaults on error
      return {
        AI_MODEL: DEFAULT_ENV_VALUES[ENV_KEYS.AI_MODEL],
        AI_API_KEY: DEFAULT_ENV_VALUES[ENV_KEYS.AI_API_KEY],
        AI_PROVIDER: DEFAULT_ENV_VALUES[ENV_KEYS.AI_PROVIDER],
        PORT: DEFAULT_ENV_VALUES[ENV_KEYS.PORT],
        DBFUSE_USERNAME: DEFAULT_ENV_VALUES[ENV_KEYS.USERNAME],
        DBFUSE_PASSWORD: DEFAULT_ENV_VALUES[ENV_KEYS.PASSWORD],
        [ENV_KEYS.CONNECTIONS_KEY]: DEFAULT_ENV_VALUES[ENV_KEYS.CONNECTIONS_KEY],
      };
    }
  }

  /**
   * Write configuration to .env file with transaction safety
   * @param {ConfigData} config - Configuration object
   * @returns {Object} Result object with success status and any errors
   */
  writeConfig(config) {
    try {
      // Create backup before modifying
      this._createBackup();

      // Normalize provider
      if (config && typeof config.AI_PROVIDER !== "undefined") {
        config.AI_PROVIDER = normalizeProvider(config.AI_PROVIDER);
      }

      // Build .env content
      const envContent = Object.entries(config)
        .map(([key, value]) => {
          const needsQuotes =
            typeof value === "string" && (value.includes(" ") || value.includes("="));
          return `${key}=${needsQuotes ? `"${value}"` : value}`;
        })
        .join("\n");

      // Write atomically (write to temp, then rename)
      const tempPath = `${this.envPath}.tmp`;
      fs.writeFileSync(tempPath, envContent, { encoding: ENCODING.UTF8 });
      fs.renameSync(tempPath, this.envPath);

      logger.info("Configuration saved successfully");
      return { success: true };
    } catch (error) {
      logger.error("Error writing configuration:", error);

      // Attempt to restore from backup
      const restored = this._restoreBackup();

      return {
        success: false,
        error: error.message,
        restored,
      };
    }
  }

  /**
   * Update process.env with new configuration
   * @param {ConfigData} config - Configuration object
   */
  updateProcessEnv(config) {
    Object.entries(config).forEach(([key, value]) => {
      process.env[key] = String(value);
    });

    // Also export provider-specific API key if available
    if (config.AI_API_KEY && config.AI_PROVIDER) {
      const providerKey = PROVIDER_API_ENV_KEYS[config.AI_PROVIDER];
      if (providerKey) {
        process.env[providerKey] = config.AI_API_KEY;
      }
    }

    logger.debug("Process environment updated");
  }

  /**
   * Validate configuration object
   * @param {ConfigData} config - Configuration to validate
   * @returns {Object} Validation result with valid flag and errors array
   */
  validateConfig(config) {
    const errors = [];

    // Validate required fields
    if (!config[ENV_KEYS.USERNAME] || !String(config[ENV_KEYS.USERNAME]).trim()) {
      errors.push("Username is required");
    }

    // Validate port range
    const port = parseInt(config[ENV_KEYS.PORT]);
    if (isNaN(port) || port < PORT_RANGE.MIN || port > PORT_RANGE.MAX) {
      errors.push(`Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}`);
    }

    // Validate AI provider if model is set
    if (config.AI_MODEL && !config.AI_PROVIDER) {
      errors.push("AI provider is required when model is specified");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Determine if configuration change requires server restart
   * @param {ConfigData} currentConfig - Current configuration
   * @param {ConfigData} newConfig - New configuration
   * @returns {Object} Object with requiresRestart flag and reason
   */
  requiresRestart(currentConfig, newConfig) {
    const currentPort = parseInt(currentConfig[ENV_KEYS.PORT]) || SERVER_DEFAULT_PORT;
    const newPort = parseInt(newConfig[ENV_KEYS.PORT]) || SERVER_DEFAULT_PORT;

    if (currentPort !== newPort) {
      return {
        requiresRestart: true,
        reason: "port_change",
        oldValue: currentPort,
        newValue: newPort,
      };
    }

    return { requiresRestart: false };
  }

  /**
   * Get config version for tracking changes (agent framework integration)
   * @returns {string} Config version hash
   */
  getConfigVersion() {
    try {
      const config = this.readConfig();
      const configStr = JSON.stringify(config);
      // Simple hash for version tracking
      const hash = require("crypto").createHash("md5").update(configStr).digest("hex");
      return hash.substring(0, 8);
    } catch (error) {
      logger.error("Error getting config version:", error);
      return "unknown";
    }
  }

  /**
   * Health check for configuration service
   * @returns {Object} Health status
   */
  isHealthy() {
    try {
      // Check if config file exists
      const exists = fs.existsSync(this.envPath);

      // Try to read config
      if (exists) {
        this.readConfig();
      }

      // Check write permissions
      const canWrite = fs.existsSync(this.configDir);

      return {
        healthy: exists && canWrite,
        configExists: exists,
        configDir: this.configDir,
        writable: canWrite,
        version: this.getConfigVersion(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        configDir: this.configDir,
      };
    }
  }

  /**
   * Reset configuration to defaults (with backup)
   * @returns {Object} Reset result
   */
  resetToDefaults() {
    try {
      // Backup current config
      if (fs.existsSync(this.envPath)) {
        fs.copyFileSync(this.envPath, this.backupPath);
        logger.info("Current config backed up before reset");
      }

      // Write default config
      const defaults = DEFAULT_ENV_VALUES;
      this.writeConfig(defaults);

      logger.info("Configuration reset to defaults");
      return {
        success: true,
        message: "Configuration reset to defaults",
        backupPath: this.backupPath,
      };
    } catch (error) {
      logger.error("Error resetting configuration:", error);
      throw error;
    }
  }

  /**
   * Restore configuration from backup
   * @returns {Object} Restore result
   */
  restoreFromBackup() {
    try {
      if (!fs.existsSync(this.backupPath)) {
        throw new Error("No backup file found");
      }

      fs.copyFileSync(this.backupPath, this.envPath);
      logger.info("Configuration restored from backup");

      return {
        success: true,
        message: "Configuration restored from backup",
        version: this.getConfigVersion(),
      };
    } catch (error) {
      logger.error("Error restoring configuration:", error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new ConfigService();
