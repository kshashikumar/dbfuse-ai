const fs = require("fs");
const path = require("path");
const logger = require("./logger");

function getEnvPath() {
  const dir =
    process.env.DBFUSE_CONFIG_DIR && process.env.DBFUSE_CONFIG_DIR.trim()
      ? process.env.DBFUSE_CONFIG_DIR.trim()
      : path.resolve(__dirname, "../"); // project root relative to src
  return path.join(dir, ".env");
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
  return v.charAt(0).toUpperCase() + v.slice(1);
}

let lastApplied = {};
let debounceTimer = null;

function applyEnv(overrides, opts) {
  const { onPortChange } = opts || {};
  const overlayKeys = [
    "AI_MODEL",
    "AI_API_KEY",
    "AI_PROVIDER",
    "PORT",
    "DBFUSE_USERNAME",
    "DBFUSE_PASSWORD",
  ];
  let portChanged = false;

  overlayKeys.forEach((k) => {
    if (overrides[k] !== undefined) {
      if (k === "PORT") {
        const newPort = Number(overrides[k]);
        if (!Number.isNaN(newPort)) {
          if (String(process.env.PORT || "") !== String(newPort)) portChanged = true;
          process.env.PORT = String(newPort);
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
  const map = {
    OpenAI: "OPENAI_API_KEY",
    Gemini: "GOOGLE_API_KEY",
    Anthropic: "ANTHROPIC_API_KEY",
    Mistral: "MISTRAL_API_KEY",
    Cohere: "COHERE_API_KEY",
    HuggingFace: "HUGGINGFACE_API_KEY",
    Perplexity: "PPLX_API_KEY",
  };
  const varName = map[process.env.AI_PROVIDER];
  if (varName && process.env.AI_API_KEY) {
    process.env[varName] = process.env.AI_API_KEY;
  }

  // Track snapshot
  lastApplied = overlayKeys.reduce((acc, k) => ({ ...acc, [k]: process.env[k] }), {});

  if (portChanged && typeof onPortChange === "function") {
    onPortChange();
  }
}

function loadAndApply(opts) {
  try {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    const parsed = parseDotenv(content);
    applyEnv(parsed, opts);
    logger.info("Applied .env changes from:", envPath);
  } catch (e) {
    logger.warn("Failed to apply .env:", e?.message || e);
  }
}

function startEnvSync(opts) {
  const envPath = getEnvPath();
  // Initial sync (if file exists)
  if (fs.existsSync(envPath)) {
    loadAndApply(opts);
  }
  // Watch for changes
  try {
    fs.watch(path.dirname(envPath), (event, filename) => {
      if (!filename || filename !== ".env") return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadAndApply(opts), 150);
    });
    logger.info("Watching .env for changes at:", envPath);
  } catch (e) {
    logger.warn("envWatcher: fs.watch not active:", e?.message || e);
  }
}

module.exports = { startEnvSync };
