const { getQueryParts, resolveMode, resolveOperation } = require("./query-normalizer");

const inferOperationType = (query) => {
  if (typeof query === "string") return "query";
  if (!query || typeof query !== "object") return "query";

  const { raw, payload } = getQueryParts(query);
  const mode = String(resolveMode(raw, payload) || "").toLowerCase();
  if (mode === "command") return "command";
  if (mode === "crud") return "crud";
  if (mode === "query") return "query";

  const op = resolveOperation(raw, payload, { defaultOperation: "" });
  const normalized = op ? String(op).toLowerCase() : "";

  if (!normalized) return "query";
  if (normalized.includes("index")) return "indexes";
  if (normalized === "explain") return "explain";
  if (normalized === "command") return "command";

  const crudPrefixes = [
    "insert",
    "update",
    "delete",
    "replace",
    "upsert",
    "create",
    "set",
    "add",
    "put",
    "patch",
    "batch",
  ];
  if (normalized === "del" || normalized === "remove") return "crud";
  if (crudPrefixes.some((prefix) => normalized.startsWith(prefix))) return "crud";

  return "query";
};

const resolveOperationName = (query) => {
  if (!query || typeof query !== "object") return "";
  const { raw, payload } = getQueryParts(query);
  const op = resolveOperation(raw, payload, { defaultOperation: "" });
  return op ? String(op).toLowerCase() : "";
};

module.exports = {
  inferOperationType,
  resolveOperationName,
};
