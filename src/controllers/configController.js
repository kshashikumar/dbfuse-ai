const fs = require("fs");
const path = require("path");

const express = require("express");

const router = express.Router();
const logger = require("../utils/logger");

// Resolve config directory consistently across environments
function getConfigDir() {
  const explicit = process.env.DBFUSE_CONFIG_DIR;
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  // Default to project root relative to this file (works in Docker and local)
  return path.resolve(__dirname, "../../");
}

// Path to .env file
const ENV_PATH = path.join(getConfigDir(), ".env");

// Normalize AI provider naming to UI-expected canonical values
function normalizeProvider(value) {
  if (!value || typeof value !== "string") return "";
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower === "openai") return "OpenAI";
  if (lower === "gemini" || lower === "google" || lower === "google-genai") return "Gemini";
  if (lower === "anthropic" || lower === "claude") return "Anthropic";
  if (lower === "mistral" || lower === "codestral") return "Mistral";
  if (lower === "cohere") return "Cohere";
  if (lower === "huggingface" || lower === "hugging-face" || lower === "hf") return "HuggingFace";
  if (lower === "perplexity" || lower === "pplx") return "Perplexity";
  // Fallback: Title case first letter only
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function inferProviderFromModel(model) {
  if (!model || typeof model !== "string") return "";
  const m = model.toLowerCase();
  if (m.startsWith("gemini")) return "Gemini";
  if (m.startsWith("claude")) return "Anthropic";
  if (m.startsWith("mistral") || m.startsWith("codestral")) return "Mistral";
  if (m.startsWith("command")) return "Cohere";
  if (m.includes("/")) return "HuggingFace";
  if (m.includes("sonar") || m.startsWith("pplx")) return "Perplexity";
  return "OpenAI";
}

// Helper function to read .env file
function readEnvFile() {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      // Create default .env file if it doesn't exist
      const defaultConfig = `AI_MODEL=""
AI_API_KEY=""
AI_PROVIDER=""
PORT=5000
DBFUSE_USERNAME=root
DBFUSE_PASSWORD=root`;
      fs.writeFileSync(ENV_PATH, defaultConfig);
    }

    const envContent = fs.readFileSync(ENV_PATH, "utf8");
    const config = {};

    envContent.split("\n").forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        const [key, ...valueParts] = trimmedLine.split("=");
        if (key && valueParts.length > 0) {
          let value = valueParts.join("=").replace(/^"|"$/g, ""); // Remove quotes

          // Convert specific values to appropriate types
          if (key === "PORT") {
            value = parseInt(value) || 5000;
          }

          config[key.trim()] = value;
        }
      }
    });

    // Overlay with live environment if present (CLI/Docker)
    const overlayKeys = [
      "AI_MODEL",
      "AI_API_KEY",
      "AI_PROVIDER",
      "PORT",
      "DBFUSE_USERNAME",
      "DBFUSE_PASSWORD",
    ];
    overlayKeys.forEach((k) => {
      if (process.env[k] != null && process.env[k] !== "") {
        config[k] = k === "PORT" ? parseInt(process.env[k]) || config[k] || 5000 : process.env[k];
      }
    });

    // Normalize provider casing/naming for UI compatibility
    config.AI_PROVIDER = normalizeProvider(
      config.AI_PROVIDER || inferProviderFromModel(config.AI_MODEL),
    );

    // If AI_API_KEY is empty but provider-specific key is present, surface it for the UI
    if (!config.AI_API_KEY || String(config.AI_API_KEY).trim() === "") {
      const providerToKey = {
        OpenAI: process.env.OPENAI_API_KEY,
        Gemini: process.env.GOOGLE_API_KEY,
        Anthropic: process.env.ANTHROPIC_API_KEY,
        Mistral: process.env.MISTRAL_API_KEY,
        Cohere: process.env.COHERE_API_KEY,
        HuggingFace: process.env.HUGGINGFACE_API_KEY,
        Perplexity: process.env.PPLX_API_KEY,
      };
      const inferred = providerToKey[config.AI_PROVIDER];
      if (inferred) config.AI_API_KEY = inferred;
    }

    return config;
  } catch (error) {
    logger.error("Error reading .env file:", error);
    return {
      AI_MODEL: "",
      AI_API_KEY: "",
      AI_PROVIDER: "",
      PORT: 5000,
      DBFUSE_USERNAME: "root",
      DBFUSE_PASSWORD: "root",
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

    fs.writeFileSync(ENV_PATH, envContent);
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
    res.status(500).json({ error: "Failed to load configuration" });
  }
};

const updateConfig = async (req, res) => {
  try {
    const config = req.body;
    const currentPort = parseInt(process.env.PORT) || 5000;
    const newPort = parseInt(config.PORT) || 5000;
    const portChanged = currentPort !== newPort;

    // Validate required fields
    if (!config.DBFUSE_USERNAME || !config.DBFUSE_USERNAME.trim()) {
      return res.status(400).json({ error: "Database username is required" });
    }

    if (config.PORT && (config.PORT < 1000 || config.PORT > 65535)) {
      return res.status(400).json({ error: "Port must be between 1000 and 65535" });
    }

    // Write to .env file (normalized)
    const success = writeEnvFile(config);
    if (!success) {
      return res.status(500).json({ error: "Failed to save configuration" });
    }

    // Update process.env for immediate effect
    updateProcessEnv(config);

    // Also export provider-specific key if AI_API_KEY is provided and provider is known
    if (config.AI_API_KEY) {
      const provider = normalizeProvider(config.AI_PROVIDER);
      const map = {
        OpenAI: "OPENAI_API_KEY",
        Gemini: "GOOGLE_API_KEY",
        Anthropic: "ANTHROPIC_API_KEY",
        Mistral: "MISTRAL_API_KEY",
        Cohere: "COHERE_API_KEY",
        HuggingFace: "HUGGINGFACE_API_KEY",
        Perplexity: "PPLX_API_KEY",
      };
      const varName = map[provider];
      if (varName) process.env[varName] = config.AI_API_KEY;
    }

    // Send response first
    if (portChanged) {
      res.json({
        message: "Configuration saved successfully. Server will restart to apply port changes...",
        requiresRestart: true,
        newPort: newPort,
      });

      // Schedule server restart after response is sent
      setTimeout(() => {
        logger.info(`Port changed from ${currentPort} to ${newPort}. Restarting server...`);
        process.exit(0); // Exit process - nodemon will restart it
      }, 1000);
    } else {
      res.json({
        message: "Configuration saved successfully",
        requiresRestart: false,
      });
    }
  } catch (error) {
    logger.error("Error saving config:", error);
    res.status(500).json({ error: "Failed to save configuration" });
  }
};

module.exports = {
  readConfig,
  updateConfig,
};
