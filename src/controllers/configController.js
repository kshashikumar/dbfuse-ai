const fs = require("fs");
const path = require("path");

const express = require("express");

const router = express.Router();
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
  CONFIG_PORT_RESTART_DELAY_MS,
} = require("../core/env");
const { CONFIG_MESSAGES, ENCODING } = require("../core/constants");
const { SERVER_LOG_MESSAGES } = require("../core/app");
const connectionStore = require("../config/connection-store");

// Resolve config directory consistently across environments
function getConfigDir() {
  const explicit = process.env[ENV_KEYS.CONFIG_DIR];
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  // Default to project root relative to this file (works in Docker and local)
  return path.resolve(__dirname, "../../");
}

// Path to .env file
const ENV_PATH = path.join(getConfigDir(), ".env");

// Helper function to read .env file
function readEnvFile() {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      // Create default .env file if it doesn't exist
      fs.writeFileSync(ENV_PATH, DEFAULT_ENV_FILE_CONTENT, { encoding: ENCODING.UTF8 });
    }

    const envContent = fs.readFileSync(ENV_PATH, ENCODING.UTF8);
    const config = {};

    envContent.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        const [key, ...valueParts] = trimmedLine.split("=");
        if (key && valueParts.length > 0) {
          let value = valueParts.join("=").replace(/^"|"$/g, ""); // Remove quotes

          // Convert specific values to appropriate types
          if (key === ENV_KEYS.PORT) {
            value = parseInt(value) || SERVER_DEFAULT_PORT;
          } else if (key === ENV_KEYS.MCP_ENABLED) {
            value = value === "true";
          }

          config[key.trim()] = value;
        }
      }
    });

    // Overlay with live environment if present (CLI/Docker)
    ENV_OVERLAY_KEYS.forEach((k) => {
      if (process.env[k] != null && process.env[k] !== "") {
        config[k] =
          k === ENV_KEYS.PORT
            ? parseInt(process.env[k]) || config[k] || SERVER_DEFAULT_PORT
            : process.env[k];
      }
    });

    if (typeof config[ENV_KEYS.CONNECTIONS_KEY] === "undefined") {
      config[ENV_KEYS.CONNECTIONS_KEY] = DEFAULT_ENV_VALUES[ENV_KEYS.CONNECTIONS_KEY];
    }

    // Normalize provider casing/naming for UI compatibility
    config.AI_PROVIDER = normalizeProvider(
      config.AI_PROVIDER || inferProviderFromModel(config.AI_MODEL),
    );

    // If AI_API_KEY is empty but provider-specific key is present, surface it for the UI
    if (!config.AI_API_KEY || String(config.AI_API_KEY).trim() === "") {
      const inferred = PROVIDER_API_ENV_KEYS[config.AI_PROVIDER]
        ? process.env[PROVIDER_API_ENV_KEYS[config.AI_PROVIDER]]
        : undefined;
      if (inferred) config.AI_API_KEY = inferred;
    }

    return config;
  } catch (error) {
    logger.error("Error reading .env file:", error);
    return {
      AI_MODEL: DEFAULT_ENV_VALUES[ENV_KEYS.AI_MODEL],
      AI_API_KEY: DEFAULT_ENV_VALUES[ENV_KEYS.AI_API_KEY],
      AI_PROVIDER: DEFAULT_ENV_VALUES[ENV_KEYS.AI_PROVIDER],
      PORT: DEFAULT_ENV_VALUES[ENV_KEYS.PORT],
      DBFUSE_USERNAME: DEFAULT_ENV_VALUES[ENV_KEYS.USERNAME],
      DBFUSE_PASSWORD: DEFAULT_ENV_VALUES[ENV_KEYS.PASSWORD],
      MCP_ENABLED: DEFAULT_ENV_VALUES[ENV_KEYS.MCP_ENABLED] === "true",
      [ENV_KEYS.CONNECTIONS_KEY]: DEFAULT_ENV_VALUES[ENV_KEYS.CONNECTIONS_KEY],
    };
  }
}

// Helper function to write .env file
function writeEnvFile(config) {
  try {
    // Ensure provider is canonicalized before writing
    if (config && typeof config.AI_PROVIDER !== "undefined") {
      config.AI_PROVIDER = normalizeProvider(config.AI_PROVIDER);
    }
    const envContent = Object.entries(config)
      .map(([key, value]) => {
        // Quote values that contain spaces or special characters
        const needsQuotes =
          typeof value === "string" && (value.includes(" ") || value.includes("="));
        return `${key}=${needsQuotes ? `"${value}"` : value}`;
      })
      .join("\n");

    fs.writeFileSync(ENV_PATH, envContent, { encoding: ENCODING.UTF8 });
    return true;
  } catch (error) {
    logger.error("Error writing .env file:", error);
    return false;
  }
}

// Helper function to update process.env
function updateProcessEnv(config) {
  Object.entries(config).forEach(([key, value]) => {
    process.env[key] = value;
  });
}

const readConfig = async (req, res) => {
  try {
    const config = readEnvFile();
    res.json(config);
  } catch (error) {
    logger.error("Error getting config:", error);
    res.status(500).json({ error: CONFIG_MESSAGES.LOAD_ERROR });
  }
};

const updateConfig = async (req, res) => {
  try {
    const config = req.body;
    const currentPort = parseInt(process.env[ENV_KEYS.PORT]) || SERVER_DEFAULT_PORT;
    const newPort = parseInt(config[ENV_KEYS.PORT]) || SERVER_DEFAULT_PORT;
    const currentMcp = process.env[ENV_KEYS.MCP_ENABLED] === "true";
    const newMcp = config[ENV_KEYS.MCP_ENABLED] === true || config[ENV_KEYS.MCP_ENABLED] === "true";
    const currentConnectionsKey = process.env[ENV_KEYS.CONNECTIONS_KEY] || "";
    const newConnectionsKey = config[ENV_KEYS.CONNECTIONS_KEY] || "";
    const keyRemoved = Boolean(currentConnectionsKey && !newConnectionsKey);

    const portChanged = currentPort !== newPort;
    const mcpChanged = currentMcp !== newMcp;
    const requiresRestart = portChanged || mcpChanged;

    // Validate required fields
    if (!config[ENV_KEYS.USERNAME] || !config[ENV_KEYS.USERNAME].trim()) {
      return res.status(400).json({ error: CONFIG_MESSAGES.USERNAME_REQUIRED });
    }

    if (
      config[ENV_KEYS.PORT] &&
      (config[ENV_KEYS.PORT] < PORT_RANGE.MIN || config[ENV_KEYS.PORT] > PORT_RANGE.MAX)
    ) {
      return res.status(400).json({ error: CONFIG_MESSAGES.PORT_RANGE_INVALID });
    }

    // Write to .env file (normalized)
    const success = writeEnvFile(config);
    if (!success) {
      return res.status(500).json({ error: CONFIG_MESSAGES.SAVE_ERROR });
    }

    // Update process.env for immediate effect
    updateProcessEnv(config);

    let connectionsCleared = false;
    if (keyRemoved) {
      try {
        connectionsCleared = await connectionStore.deleteConnectionStore();
        if (connectionsCleared) {
          logger.warn("Connection store deleted because encryption key was removed");
        }
      } catch (deleteError) {
        logger.error("Failed to delete connection store after key removal: %o", deleteError);
      }
    }

    // Also export provider-specific key if AI_API_KEY is provided and provider is known
    if (config.AI_API_KEY) {
      const provider = normalizeProvider(config.AI_PROVIDER);
      const varName = PROVIDER_API_ENV_KEYS[provider];
      if (varName) process.env[varName] = config.AI_API_KEY;
    }

    // Send response first
    if (requiresRestart) {
      res.json({
        message: portChanged
          ? CONFIG_MESSAGES.SAVE_SUCCESS_PORT_CHANGE
          : "Configuration saved. Restarting to apply changes...",
        requiresRestart: true,
        newPort: newPort,
        connectionsCleared,
      });

      // Schedule server restart after response is sent
      setTimeout(() => {
        logger.info(SERVER_LOG_MESSAGES.PORT_CHANGE_RESTART(currentPort, newPort));
        process.exit(0); // Exit process - nodemon will restart it
      }, CONFIG_PORT_RESTART_DELAY_MS);
    } else {
      res.json({
        message: CONFIG_MESSAGES.SAVE_SUCCESS,
        requiresRestart: false,
        connectionsCleared,
      });
    }
  } catch (error) {
    logger.error("Error saving config:", error);
    res.status(500).json({ error: CONFIG_MESSAGES.SAVE_ERROR });
  }
};

module.exports = {
  readConfig,
  updateConfig,
};
