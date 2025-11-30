const levels = ["error", "warn", "info", "debug"];

const levelIndex = (process.env.LOG_LEVEL && levels.indexOf(process.env.LOG_LEVEL)) ?? 2; // default info
const isMcpEnabled = process.env.MCP_ENABLED === "true";

function format(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level.toUpperCase()}]`, ...args];
}

// When MCP is enabled, we MUST NOT write to stdout, as it is used for JSON-RPC transport.
// We redirect everything to stderr.
const logFn = isMcpEnabled ? console.error : console.log;
const errorFn = console.error;

module.exports = {
  error: (...args) => {
    if (levelIndex >= 0) errorFn(...format("error", args));
  },
  warn: (...args) => {
    if (levelIndex >= 1) errorFn(...format("warn", args));
  },
  info: (...args) => {
    if (levelIndex >= 2) logFn(...format("info", args));
  },
  debug: (...args) => {
    if (levelIndex >= 3) logFn(...format("debug", args));
  },
};
