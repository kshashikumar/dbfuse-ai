const levels = ["error", "warn", "info", "debug"];

const levelIndex = (process.env.LOG_LEVEL && levels.indexOf(process.env.LOG_LEVEL)) ?? 2; // default info

function format(level, args) {
  const ts = new Date().toISOString();
  return [`[${ts}] [${level.toUpperCase()}]`, ...args];
}

module.exports = {
  error: (...args) => {
    if (levelIndex >= 0) console.error(...format("error", args));
  },
  warn: (...args) => {
    if (levelIndex >= 1) console.warn(...format("warn", args));
  },
  info: (...args) => {
    if (levelIndex >= 2) console.log(...format("info", args));
  },
  debug: (...args) => {
    if (levelIndex >= 3) console.debug(...format("debug", args));
  },
};
