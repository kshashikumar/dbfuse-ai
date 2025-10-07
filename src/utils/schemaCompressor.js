// Compact schema compressor for AI prompts
// Builds a global table catalog (names only) and a compact DSL for selected tables

const DEFAULTS = {
  maxTables: 12,
  tier: 2, // 1: names only, 2: names + type + size + flags
  budgetChars: 4000, // target budget for schema DSL (excluding catalog)
  ttlMs: 2 * 60 * 1000, // cache TTL 2 minutes
  maxCacheEntries: 100,
};

// Simple in-memory LRU with TTL
class LRUCache {
  constructor(limit = DEFAULTS.maxCacheEntries, ttlMs = DEFAULTS.ttlMs) {
    this.map = new Map();
    this.limit = limit;
    this.ttlMs = ttlMs;
  }
  _now() {
    return Date.now();
  }
  get(key) {
    const item = this.map.get(key);
    if (!item) return undefined;
    if (this._now() > item.expires) {
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, item);
    return item.value;
  }
  set(key, value) {
    if (this.map.size >= this.limit) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, { value, expires: this._now() + this.ttlMs });
  }
}

const cache = new LRUCache();

function normalizeName(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function buildTableCatalog(dbMeta) {
  const names = [];
  for (const db of dbMeta || []) {
    for (const t of db?.tables || []) {
      if (t?.name) names.push(String(t.name));
    }
  }
  // dedupe + sort
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function extractCandidateTablesFromPrompt(prompt, tableCatalog) {
  const p = normalizeName(prompt);
  const candidates = new Set();
  // simple token match
  for (const name of tableCatalog) {
    const n = normalizeName(name);
    if (n && p.includes(n)) candidates.add(name);
  }
  // special pattern: "for <table> table"
  const m = /for\s+([a-zA-Z0-9_]+)\s+table/.exec(p);
  if (m && tableCatalog.includes(m[1])) candidates.add(m[1]);
  return Array.from(candidates);
}

function formatColumnTier(col, tier) {
  // Always include name; enrich based on tier
  const name = col.column_name;
  if (tier === 1) return name;
  const type = col.data_type ? String(col.data_type).toUpperCase() : undefined;
  const len = col.length ?? col.data_length ?? null;
  const prec = col.precision ?? null;
  const scale = col.scale ?? null;
  let typeStr = type || "";
  if (prec != null && scale != null) typeStr += `(${prec},${scale})`;
  else if (len != null) typeStr += `(${len})`;
  const flags = [];
  if (col.is_primary_key) flags.push("PK");
  if (col.is_nullable === false) flags.push("NN");
  // Avoid verbose defaults unless tier > 2 (not used yet)
  const flagStr = flags.length ? ` [${flags.join(",")}]` : "";
  return typeStr ? `${name} ${typeStr}${flagStr}` : `${name}${flagStr}`;
}

function buildSchemaDSL(dbMeta, selectedTables, tier = DEFAULTS.tier) {
  const lines = [];
  // We assume single database context in use (databaseName provided separately)
  const selected = new Set(selectedTables || []);
  for (const db of dbMeta || []) {
    for (const t of db?.tables || []) {
      if (!t?.name || !selected.has(t.name)) continue;
      const cols = (t.columns || []).map((c) => formatColumnTier(c, tier)).join(", ");
      // T <name>: col1 TYPE(len) [PK,NN], col2 ...
      lines.push(`T ${t.name}: ${cols}`);
    }
  }
  return lines.join("\n");
}

function estimateSize(str) {
  return (str || "").length;
}

function compressSchemaForPrompt({ dbMeta, prompt, options = {} }) {
  const opt = { ...DEFAULTS, ...options };
  const catalog = buildTableCatalog(dbMeta);
  // Select relevant tables based on prompt tokens
  let selected = extractCandidateTablesFromPrompt(prompt, catalog);
  if (selected.length === 0) {
    // Fallback to top-N (alphabetical) to avoid empty schema
    selected = catalog.slice(0, opt.maxTables);
  } else if (selected.length > opt.maxTables) {
    selected = selected.slice(0, opt.maxTables);
  }

  // Cache key independent of order
  const key = JSON.stringify({ v: 1, selected: [...selected].sort(), tier: opt.tier });
  const cached = cache.get(key);
  if (cached) {
    return {
      catalog,
      schemaDSL: cached.schemaDSL,
      selectedTables: selected,
      tierUsed: cached.tierUsed,
    };
  }

  // Build DSL, and if over budget, downgrade tier then prune tables
  let tierUsed = opt.tier;
  let schemaDSL = buildSchemaDSL(dbMeta, selected, tierUsed);
  let size = estimateSize(schemaDSL);
  if (size > opt.budgetChars) {
    // Try tier 1
    tierUsed = 1;
    schemaDSL = buildSchemaDSL(dbMeta, selected, tierUsed);
    size = estimateSize(schemaDSL);
  }
  if (size > opt.budgetChars) {
    // Trim tables until within budget
    let left = 0;
    let right = selected.length;
    while (left < right && size > opt.budgetChars) {
      right = Math.max(Math.floor((left + right) / 2), left + 1);
      const cut = selected.slice(0, right);
      schemaDSL = buildSchemaDSL(dbMeta, cut, tierUsed);
      size = estimateSize(schemaDSL);
      if (size <= opt.budgetChars || right === left + 1) {
        selected = cut;
        break;
      }
    }
  }

  cache.set(key, { schemaDSL, tierUsed });
  return { catalog, schemaDSL, selectedTables: selected, tierUsed };
}

module.exports = {
  buildTableCatalog,
  buildSchemaDSL,
  compressSchemaForPrompt,
};
