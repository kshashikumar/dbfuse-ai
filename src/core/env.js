const SERVER_DEFAULT_PORT = 5000;

const PORT_RANGE = Object.freeze({
  MIN: 1000,
  MAX: 65535,
});

const ENV_KEYS = Object.freeze({
  PORT: "PORT",
  CONFIG_DIR: "DBFUSE_CONFIG_DIR",
  BODY_SIZE: "BODY_SIZE",
  USERNAME: "DBFUSE_USERNAME",
  PASSWORD: "DBFUSE_PASSWORD",
  AI_MODEL: "AI_MODEL",
  AI_API_KEY: "AI_API_KEY",
  AI_PROVIDER: "AI_PROVIDER",
  MCP_ENABLED: "MCP_ENABLED",
  CONNECTIONS_KEY: "DBFUSE_CONNECTIONS_KEY",
});

const DEFAULT_ENV_VALUES = Object.freeze({
  [ENV_KEYS.AI_MODEL]: "",
  [ENV_KEYS.AI_API_KEY]: "",
  [ENV_KEYS.AI_PROVIDER]: "",
  [ENV_KEYS.PORT]: SERVER_DEFAULT_PORT,
  [ENV_KEYS.USERNAME]: "root",
  [ENV_KEYS.PASSWORD]: "root",
  [ENV_KEYS.MCP_ENABLED]: "false",
  [ENV_KEYS.CONNECTIONS_KEY]: "",
});

const ENV_OVERLAY_KEYS = Object.freeze([
  ENV_KEYS.AI_MODEL,
  ENV_KEYS.AI_API_KEY,
  ENV_KEYS.AI_PROVIDER,
  ENV_KEYS.PORT,
  ENV_KEYS.USERNAME,
  ENV_KEYS.PASSWORD,
  ENV_KEYS.MCP_ENABLED,
  ENV_KEYS.CONNECTIONS_KEY,
]);

const PROVIDER_NORMALIZATION_MAP = Object.freeze({
  openai: "OpenAI",
  gemini: "Gemini",
  google: "Gemini",
  "google-genai": "Gemini",
  anthropic: "Anthropic",
  claude: "Anthropic",
  mistral: "Mistral",
  codestral: "Mistral",
  cohere: "Cohere",
  huggingface: "HuggingFace",
  "hugging-face": "HuggingFace",
  hf: "HuggingFace",
  perplexity: "Perplexity",
  pplx: "Perplexity",
});

const PROVIDER_API_ENV_KEYS = Object.freeze({
  OpenAI: "OPENAI_API_KEY",
  Gemini: "GOOGLE_API_KEY",
  Anthropic: "ANTHROPIC_API_KEY",
  Mistral: "MISTRAL_API_KEY",
  Cohere: "COHERE_API_KEY",
  HuggingFace: "HUGGINGFACE_API_KEY",
  Perplexity: "PPLX_API_KEY",
});

const ENV_WATCH_DEBOUNCE_MS = 150;
const CONFIG_PORT_RESTART_DELAY_MS = 1000;
const ENV_SYNC_EXIT_DELAY_MS = 200;

const DEFAULT_ENV_FILE_CONTENT = `AI_MODEL="${DEFAULT_ENV_VALUES[ENV_KEYS.AI_MODEL]}"
AI_API_KEY="${DEFAULT_ENV_VALUES[ENV_KEYS.AI_API_KEY]}"
AI_PROVIDER="${DEFAULT_ENV_VALUES[ENV_KEYS.AI_PROVIDER]}"
PORT=${DEFAULT_ENV_VALUES[ENV_KEYS.PORT]}
${ENV_KEYS.USERNAME}=${DEFAULT_ENV_VALUES[ENV_KEYS.USERNAME]}
${ENV_KEYS.PASSWORD}=${DEFAULT_ENV_VALUES[ENV_KEYS.PASSWORD]}
${ENV_KEYS.MCP_ENABLED}=${DEFAULT_ENV_VALUES[ENV_KEYS.MCP_ENABLED]}
${ENV_KEYS.CONNECTIONS_KEY}="${DEFAULT_ENV_VALUES[ENV_KEYS.CONNECTIONS_KEY]}"`;

const normalizeProvider = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return PROVIDER_NORMALIZATION_MAP[lower] || trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const inferProviderFromModel = (model) => {
  if (!model || typeof model !== "string") return "";
  const lower = model.toLowerCase();
  if (lower.startsWith("gemini")) return "Gemini";
  if (lower.startsWith("claude")) return "Anthropic";
  if (lower.startsWith("mistral") || lower.startsWith("codestral")) return "Mistral";
  if (lower.startsWith("command")) return "Cohere";
  if (lower.includes("/")) return "HuggingFace";
  if (lower.startsWith("pplx") || lower.includes("sonar")) return "Perplexity";
  return "OpenAI";
};

module.exports = {
  SERVER_DEFAULT_PORT,
  PORT_RANGE,
  ENV_KEYS,
  ENV_OVERLAY_KEYS,
  DEFAULT_ENV_VALUES,
  PROVIDER_NORMALIZATION_MAP,
  PROVIDER_API_ENV_KEYS,
  ENV_WATCH_DEBOUNCE_MS,
  CONFIG_PORT_RESTART_DELAY_MS,
  ENV_SYNC_EXIT_DELAY_MS,
  DEFAULT_ENV_FILE_CONTENT,
  normalizeProvider,
  inferProviderFromModel,
};
