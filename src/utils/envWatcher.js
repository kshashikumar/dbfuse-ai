const fs = require("fs");
const path = require("path");

const {
  ENV_KEYS,
  ENV_OVERLAY_KEYS,
  PROVIDER_API_ENV_KEYS,
  ENV_WATCH_DEBOUNCE_MS,
  normalizeProvider,
} = require("../core/env");
const { ENCODING } = require("../core/constants");

const logger = require("./logger");

const ENV_FILENAME = ".env";

function resolveConfigDir() {
  const configuredDir = (process.env[ENV_KEYS.CONFIG_DIR] || "").trim();
  if (configuredDir) return configuredDir;
  return path.resolve(__dirname, "../"); // project root relative to src
}

function resolveEnvPath() {
  return path.join(resolveConfigDir(), ENV_FILENAME);
}

function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return null;
  }
  return fs.readFileSync(envPath, ENCODING.UTF8);
}

function parseDotenv(content) {
  const out = {};
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!key || !rest.length) return;
    let val = rest.join("=");
    val = val.replace(/^"|"$/g, "");
    out[key] = val;
  });
  return out;
}

let debounceTimer = null;

function applyEnv(overrides, opts) {
  const { onPortChange } = opts || {};
  let portChanged = false;

  ENV_OVERLAY_KEYS.forEach((k) => {
    if (overrides[k] !== undefined) {
      if (k === ENV_KEYS.PORT) {
        const newPort = Number(overrides[k]);
        if (!Number.isNaN(newPort)) {
          if (String(process.env[ENV_KEYS.PORT] || "") !== String(newPort)) portChanged = true;
          process.env[ENV_KEYS.PORT] = String(newPort);
        }
      } else {
        process.env[k] = overrides[k];
      }
    }
  });

  // Keep provider name canonical
  if (process.env.AI_PROVIDER) {
    process.env.AI_PROVIDER = normalizeProvider(process.env.AI_PROVIDER);
  }

  // Provider-specific key mirror (optional convenience)
  const varName = PROVIDER_API_ENV_KEYS[process.env.AI_PROVIDER];
  if (varName && process.env.AI_API_KEY) {
    process.env[varName] = process.env.AI_API_KEY;
  }

  if (portChanged && typeof onPortChange === "function") {
    onPortChange();
  }
}

function loadAndApply(envPath, opts) {
  try {
    const content = readEnvFile(envPath);
    if (!content) return;
    const parsed = parseDotenv(content);
    applyEnv(parsed, opts);
    logger.info("Applied .env changes from:", envPath);
  } catch (e) {
    logger.warn("Failed to apply .env:", e?.message || e);
  }
}

function scheduleReload(envPath, opts) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadAndApply(envPath, opts), ENV_WATCH_DEBOUNCE_MS);
}

function startEnvWatcher(envPath, opts) {
  try {
    fs.watch(path.dirname(envPath), (event, filename) => {
      if (!filename || filename !== ENV_FILENAME) return;
      scheduleReload(envPath, opts);
    });
    logger.info("Watching .env for changes at:", envPath);
  } catch (e) {
    logger.warn("envWatcher: fs.watch not active:", e?.message || e);
  }
}

function startEnvSync(opts) {
  const envPath = resolveEnvPath();
  if (!fs.existsSync(envPath)) {
    logger.info("No .env file found at %s. Watcher will stay idle until it exists.", envPath);
  } else {
    loadAndApply(envPath, opts);
  }
  startEnvWatcher(envPath, opts);
}

module.exports = { startEnvSync };
