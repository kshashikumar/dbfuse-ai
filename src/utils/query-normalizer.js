const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const getQueryParts = (query) => {
  const raw = isPlainObject(query) ? query : {};
  const payload = isPlainObject(raw.payload) ? raw.payload : {};
  return { raw, payload };
};

const resolveMode = (raw = {}, payload = {}) => {
  return raw.mode || payload.mode || raw.type || payload.type || null;
};

const resolveOperation = (
  raw = {},
  payload = {},
  { defaultOperation = "query", commandFallback = false, coerceNonString = true } = {},
) => {
  const candidate =
    raw.operation ||
    raw.action ||
    raw.command ||
    raw.op ||
    payload.operation ||
    payload.action ||
    payload.command ||
    payload.op;

  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.toLowerCase();
  }

  if (commandFallback) {
    const commandValue =
      raw.commandPayload || payload.commandPayload || raw.command || payload.command;
    if (isPlainObject(commandValue)) {
      return "command";
    }
  }

  if (
    coerceNonString &&
    candidate !== undefined &&
    candidate !== null &&
    typeof candidate !== "object"
  ) {
    return String(candidate).toLowerCase();
  }

  if (defaultOperation === null || defaultOperation === undefined || defaultOperation === "") {
    return null;
  }

  return String(defaultOperation).toLowerCase();
};

module.exports = {
  getQueryParts,
  resolveMode,
  resolveOperation,
};
