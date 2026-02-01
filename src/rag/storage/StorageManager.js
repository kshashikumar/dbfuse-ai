const fs = require("fs");
const path = require("path");

const sqlite3 = require("sqlite3").verbose();

const logger = require("../../utils/logger");

const GraphStore = require("./GraphStore");
const QueryHistoryStore = require("./QueryHistoryStore");
const VectorStore = require("./VectorStore");

class StorageManager {
  constructor() {
    this.storageRoot = path.join(process.cwd(), ".dbfuse-ai", "rag");
    this.dbPath = path.join(this.storageRoot, "rag.sqlite");
    this.db = null;
    this.graphStore = null;
    this.vectorStore = null;
    this.queryHistoryStore = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this._ensureDir();
    await this._openDatabase();
    await this._runMigrations();

    const helpers = {
      run: this._run.bind(this),
      get: this._get.bind(this),
      all: this._all.bind(this),
    };

    this.graphStore = new GraphStore(this.db, helpers);
    this.vectorStore = new VectorStore(this.db, helpers);
    this.queryHistoryStore = new QueryHistoryStore(this.db, helpers);
    this.initialized = true;

    logger.info(`RAG storage initialized at ${this.dbPath}`);
  }

  getGraphStore() {
    if (!this.initialized) {
      throw new Error("RAG storage not initialized");
    }
    return this.graphStore;
  }

  getVectorStore() {
    if (!this.initialized) {
      throw new Error("RAG storage not initialized");
    }
    return this.vectorStore;
  }

  getQueryHistoryStore() {
    if (!this.initialized) {
      throw new Error("RAG storage not initialized");
    }
    return this.queryHistoryStore;
  }

  _ensureDir() {
    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
  }

  async _openDatabase() {
    if (this.db) {
      return;
    }

    await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(
        this.dbPath,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          this.db = db;
          resolve();
        },
      );
    });
  }

  async _runMigrations() {
    await this._run("PRAGMA foreign_keys = ON");

    await this._run(
      `CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )`,
    );

    await this._run(
      `CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        metadata TEXT,
        weight REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
      )`,
    );

    await this._run(
      `CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        vector TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
      )`,
    );

    await this._run(
      `CREATE TABLE IF NOT EXISTS query_history (
        id TEXT PRIMARY KEY,
        nl_query TEXT NOT NULL,
        generated_query TEXT NOT NULL,
        strategy TEXT,
        success INTEGER DEFAULT 1,
        execution_time INTEGER,
        feedback TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )`,
    );

    await this._run("CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)");
    await this._run("CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name)");
    await this._run("CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id)");
    await this._run("CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id)");
    await this._run("CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship)");
    await this._run("CREATE INDEX IF NOT EXISTS idx_history_nl ON query_history(nl_query)");
  }

  _run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(err) {
        if (err) {
          reject(err);
          return;
        }
        resolve(this);
      });
    });
  }

  _get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(row);
      });
    });
  }

  _all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }
}

module.exports = new StorageManager();
