// tests/integration/databases/base-tester.js
// Base class for database integration tests

require("dotenv").config();
const axios = require("axios");

const { SERVER_CONSTANTS, buildLocalhostBaseUrl } = require("../../../src/core/app");
const { DEFAULT_CONFIG, HEADERS } = require("../../../src/core/constants");

/**
 * Base class for database integration testing
 * Provides common functionality for all database test suites
 */
class BaseTester {
  constructor(dbType, config = {}) {
    this.dbType = dbType;
    this.baseURL = buildLocalhostBaseUrl(SERVER_CONSTANTS.DEFAULT_PORT);
    this.passed = 0;
    this.failed = 0;
    this.errors = [];
    this.connectionId = null;
    this.config = config;
  }

  log(message, type = "info") {
    const colors = {
      info: "\x1b[36m",
      success: "\x1b[32m",
      error: "\x1b[31m",
      warning: "\x1b[33m",
    };
    const reset = "\x1b[0m";
    const time = new Date().toLocaleTimeString();
    console.log(`${colors[type]}[${time}] ${message}${reset}`);
  }

  async request(method, endpoint, data = null) {
    try {
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          "Content-Type": HEADERS.CONTENT_TYPE,
          [HEADERS.DB_TYPE]: this.dbType,
        },
        timeout: DEFAULT_CONFIG.CONNECTION_TIMEOUT,
      };

      if (this.connectionId) {
        config.headers[HEADERS.CONNECTION_ID] = this.connectionId;
      }

      // Add basic authentication if credentials are provided in environment
      if (process.env.DBFUSE_USERNAME && process.env.DBFUSE_PASSWORD) {
        const credentials = Buffer.from(
          `${process.env.DBFUSE_USERNAME}:${process.env.DBFUSE_PASSWORD}`,
        ).toString("base64");
        config.headers["Authorization"] = `Basic ${credentials}`;
      }

      if (data) config.data = data;

      this.log(`${method} ${endpoint}`, "info");
      const response = await axios(config);
      this.log(`OK Status: ${response.status}`, "success");
      const envelope = response.data?.envelope;
      const payload = envelope?.data || response.data;
      return { success: true, data: payload, envelope, status: response.status };
    } catch (error) {
      const errorData = error.response?.data;
      const errorMsg =
        typeof errorData === "object" ? JSON.stringify(errorData) : errorData || error.message;
      this.log(`ERR Error: ${error.response?.status || "No Response"} - ${errorMsg}`, "error");
      return {
        success: false,
        error: error.response?.data || error.message,
        status: error.response?.status || 500,
      };
    }
  }

  // Helper methods to handle different API response shapes
  extractRows(payload) {
    if (Array.isArray(payload?.queries)) {
      for (const q of payload.queries) {
        if (Array.isArray(q?.rows)) return q.rows;
        if (Array.isArray(q?.data?.rows)) return q.data.rows;
      }
    }

    const candidates = [
      payload?.rows,
      payload?.data?.rows,
      payload?.result?.rows,
      payload?.results?.[0]?.rows,
      payload?.data?.results?.[0]?.rows,
      Array.isArray(payload) ? payload : null,
      Array.isArray(payload?.data) ? payload.data : null,
    ];

    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return null;
  }

  extractPagination(payload) {
    if (Array.isArray(payload?.queries)) {
      const q0 = payload.queries[0];
      const p =
        q0?.pagination ||
        q0?.meta?.pagination ||
        q0?.data?.pagination ||
        q0?.data?.meta?.pagination;
      if (p) return p;
    }

    const p =
      payload?.pagination ||
      payload?.meta?.pagination ||
      payload?.data?.pagination ||
      payload?.data?.meta?.pagination;
    return p || null;
  }

  extractColumnCount(payload) {
    const rows = this.extractRows(payload);
    if (Array.isArray(rows)) return rows.length;
    if (Array.isArray(payload?.columns)) return payload.columns.length;
    if (Array.isArray(payload?.data?.columns)) return payload.data.columns.length;
    if (Array.isArray(payload?.fields)) return payload.fields.length;
    return null;
  }

  async test(name, testFn) {
    this.log(`\n[TEST] ${name}`, "info");
    this.log("-".repeat(50), "info");
    try {
      await testFn();
      this.passed++;
      this.log(`PASSED: ${name}`, "success");
    } catch (error) {
      this.failed++;
      this.errors.push({ test: name, error: error.message });
      this.log(`FAILED: ${name} - ${error.message}`, "error");
    }
  }

  printResults() {
    const total = this.passed + this.failed;
    const successRate = total > 0 ? ((this.passed / total) * 100).toFixed(1) : 0;

    console.log("\n" + "=".repeat(60));
    console.log("TEST RESULTS");
    console.log("=".repeat(60));
    console.log(`Passed: ${this.passed}`);
    console.log(`Failed: ${this.failed}`);
    console.log(`Total:  ${total}`);
    console.log(`Success Rate: ${successRate}%`);

    if (this.errors.length > 0) {
      console.log("\nFAILED TESTS:");
      this.errors.forEach(({ test, error }, i) => {
        console.log(`  ${i + 1}. ${test}`);
        console.log(`     Error: ${error}`);
      });
    }

    console.log("=".repeat(60));
    process.exit(this.failed > 0 ? 1 : 0);
  }

  // Common test patterns
  async testConnection() {
    await this.test("Database Connection", async () => {
      const result = await this.request("POST", "/api/db/connect", this.config);
      if (!result.success || !result.data.connectionId) {
        throw new Error("Connection failed");
      }
      this.connectionId = result.data.connectionId;
      this.log(`Connected with ID: ${this.connectionId}`, "success");
    });
  }

  async testListDatabases() {
    await this.test("List Databases", async () => {
      const result = await this.request("GET", "/api/db/databases");
      if (!result.success || !Array.isArray(result.data.databases)) {
        throw new Error("Failed to list databases");
      }
      this.log(`Found ${result.data.databases.length} databases`, "info");
    });
  }

  async testListTables(dbName) {
    await this.test("List Tables", async () => {
      const result = await this.request("GET", `/api/db/tables?dbName=${dbName}`);
      if (!result.success || !Array.isArray(result.data.tables)) {
        throw new Error("Failed to list tables");
      }
      this.log(`Found ${result.data.tables.length} tables`, "info");
    });
  }

  async testSimpleQuery(query, dbName) {
    await this.test("Simple SELECT Query", async () => {
      const result = await this.request("POST", "/api/db/query", {
        query,
        dbName,
        page: 1,
        pageSize: 3,
      });
      const rows = this.extractRows(result.data);
      if (!result.success || !Array.isArray(rows)) {
        throw new Error("SELECT query failed");
      }
      this.log(`Query returned ${rows.length} rows`, "info");
    });
  }

  async testPagination(query, dbName) {
    await this.test("Query Pagination", async () => {
      const result = await this.request("POST", "/api/db/query", {
        query,
        dbName,
        page: 1,
        pageSize: 5,
      });
      const pagination = this.extractPagination(result.data);
      const rows = this.extractRows(result.data);
      if (!result.success || !pagination) {
        throw new Error("Pagination failed");
      }
      this.log(
        `Page ${pagination.page ?? pagination.currentPage ?? 1}, ${Array.isArray(rows) ? rows.length : 0} rows`,
        "info",
      );
    });
  }

  async testDisconnect() {
    await this.test("Database Disconnect", async () => {
      const result = await this.request("POST", "/api/db/disconnect");
      if (!result.success) {
        throw new Error("Disconnect failed");
      }
      this.log("Disconnected successfully", "success");
    });
  }
}

module.exports = BaseTester;
