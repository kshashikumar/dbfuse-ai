const DEFAULT_SAMPLE_LIMIT = 20;

const limitSample = (items, limit = DEFAULT_SAMPLE_LIMIT) => {
  if (!Array.isArray(items)) return [];
  const size = Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_SAMPLE_LIMIT;
  if (size <= 0) return [];
  return items.slice(0, size);
};

const typeOfValue = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  const type = typeof value;
  if (type === "object") return "object";
  return type;
};

const inferFieldTypes = (records) => {
  const map = {};
  for (const record of records || []) {
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      if (!map[key]) {
        map[key] = typeOfValue(value);
      }
    }
  }
  return map;
};

const buildColumnsFromRecords = (records) =>
  Object.entries(inferFieldTypes(records)).map(([name, dataType]) => ({
    column_name: name,
    data_type: dataType,
  }));

module.exports = {
  buildColumnsFromRecords,
  inferFieldTypes,
  limitSample,
};
