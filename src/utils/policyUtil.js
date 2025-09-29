// policyUtil.js
const path = require("path");

/* ---------------------- Small helpers ---------------------- */
const splitAnyPath = (p) => (p || "").split(/[\\/]+/).filter(Boolean);
const shortTail = (p, n = 2) => {
  const parts = splitAnyPath(p);
  if (parts.length <= n) return p || "";
  return `…${path.sep}${parts.slice(-n).join(path.sep)}`;
};
const normalizeAbsPath = (p) => {
  if (!p) return "";
  const norm = path.normalize(p);
  return path.isAbsolute(norm) ? norm : path.resolve(norm);
};

/* ---------------------- Default SQL policy ---------------------- */
const DefaultPolicy = {
  validateOnAdd(input) {
    const required = ["username", "host", "port", "dbType"];
    const missing = required.filter((f) => !input[f]);
    return missing.length ? `Missing required fields: ${missing.join(", ")}` : null;
  },
  normalizeOnAdd(input) {
    return {
      username: input.username,
      password: input.password,
      host: input.host,
      port: parseInt(input.port, 10),
      dbType: input.dbType,
      database: input.database || "",
      socketPath: input.socketPath || "",
      ssl: !!input.ssl,
      connectionTimeout: parseInt(input.connectionTimeout, 10) || 60000,
      poolSize: parseInt(input.poolSize, 10) || 10,
      status: "Available",
    };
  },
  normalizeOnEdit(current, updates) {
    return {
      username: updates.username ?? current.username,
      password: updates.password ?? current.password,
      host: updates.host ?? current.host,
      port: updates.port ? parseInt(updates.port, 10) : current.port,
      database: typeof updates.database === "string" ? updates.database : current.database,
      socketPath: updates.socketPath ?? current.socketPath,
      ssl: updates.hasOwnProperty("ssl") ? !!updates.ssl : current.ssl,
      connectionTimeout: updates.connectionTimeout
        ? parseInt(updates.connectionTimeout, 10)
        : current.connectionTimeout,
      poolSize: updates.poolSize ? parseInt(updates.poolSize, 10) : current.poolSize,
    };
  },
  normalizeOnSave(conn) {
    return {
      ...conn,
      port: parseInt(conn.port, 10) || conn.port,
      connectionTimeout: parseInt(conn.connectionTimeout, 10) || 60000,
      poolSize: parseInt(conn.poolSize, 10) || 10,
      ssl: !!conn.ssl,
    };
  },
  dedupeKey(c) {
    return ["host", "port", "database", "username", "dbType"]
      .map((k) => String(c[k] ?? ""))
      .join("|");
  },
  display(conn) {
    const db = conn.database || "";
    return { databaseDisplay: db, databaseShort: db, extras: {} };
  },
};

/* ---------------------- Engine-specific policies ---------------------- */

// mysql2
const MySQLPolicy = {
  ...DefaultPolicy,
  dedupeKey: (c) => `mysql2|${c.host}|${c.port}|${c.database}|${c.username}`,
  display: (c) => ({
    databaseDisplay: c.database || "",
    databaseShort: c.database || "",
    extras: {},
  }),
};

// pg (PostgreSQL)
const PostgresPolicy = {
  ...DefaultPolicy,
  dedupeKey: (c) => `pg|${c.host}|${c.port}|${c.database}|${c.username}`,
  display: (c) => ({
    databaseDisplay: c.database || "postgres",
    databaseShort: c.database || "postgres",
    extras: {},
  }),
};

// mssql (SQL Server)
const MSSQLPolicy = {
  ...DefaultPolicy,
  dedupeKey: (c) => `mssql|${c.host}|${c.port}|${c.database}|${c.username}`,
  display: (c) => ({
    databaseDisplay: c.database || "master",
    databaseShort: c.database || "master",
    extras: {},
  }),
};

// oracledb (Oracle)
const OraclePolicy = {
  ...DefaultPolicy,
  dedupeKey: (c) => `oracledb|${c.host}|${c.port}|${c.database}|${c.username}`,
  display: (c) => ({
    databaseDisplay: c.database || "",
    databaseShort: c.database || "",
    extras: {},
  }),
};

// sqlite3 (file-backed)
const SqlitePolicy = {
  validateOnAdd(input) {
    const hasPath = !!(input.databasePath || input.database);
    return hasPath ? null : "For sqlite3, 'database' (file path) is required.";
  },
  normalizeOnAdd(input) {
    const dbPath = normalizeAbsPath(input.databasePath || input.database);
    return {
      username: input.username || "",
      password: input.password || "",
      host: "",
      port: 0,
      dbType: input.dbType,
      database: dbPath,
      socketPath: input.socketPath || "",
      ssl: false,
      connectionTimeout: parseInt(input.connectionTimeout, 10) || 60000,
      poolSize: parseInt(input.poolSize, 10) || 1,
      status: "Available",
    };
  },
  normalizeOnEdit(current, updates) {
    const incoming = updates.databasePath || updates.database;
    const nextDb = incoming ? normalizeAbsPath(incoming) : current.database;
    return {
      username: updates.username ?? (current.username || ""),
      password: updates.password ?? (current.password || ""),
      host: "",
      port: 0,
      database: nextDb,
      socketPath: updates.socketPath ?? current.socketPath,
      ssl: false,
      connectionTimeout: updates.connectionTimeout
        ? parseInt(updates.connectionTimeout, 10)
        : current.connectionTimeout,
      poolSize: updates.poolSize ? parseInt(updates.poolSize, 10) : current.poolSize || 1,
    };
  },
  normalizeOnSave(conn) {
    const dbPath = normalizeAbsPath(conn.databasePath || conn.database);
    return {
      ...conn,
      username: conn.username || "",
      password: conn.password || "",
      host: "",
      port: 0,
      database: dbPath,
      poolSize: parseInt(conn.poolSize, 10) || 1,
      ssl: false,
    };
  },
  dedupeKey(c) {
    return `sqlite3|${normalizeAbsPath(c.database || c.databasePath || "")}`;
  },
  display(conn) {
    const full = conn.database || "";
    return {
      databaseDisplay: path.basename(full) || "",
      databaseShort: shortTail(full, 2),
      extras: { databasePath: full },
    };
  },
};

/* ---------------------- Registry & export ---------------------- */
const DB_POLICIES = new Map([
  ["mysql2", MySQLPolicy],
  ["pg", PostgresPolicy],
  ["mssql", MSSQLPolicy],
  ["oracledb", OraclePolicy],
  ["sqlite3", SqlitePolicy],
  ["default", DefaultPolicy],
]);

const getPolicy = (dbType) =>
  DB_POLICIES.get(String(dbType || "").toLowerCase()) || DB_POLICIES.get("default");

module.exports = {
  getPolicy,
  DB_POLICIES,
  // helpers exported in case you need them elsewhere
  normalizeAbsPath,
  shortTail,
};
