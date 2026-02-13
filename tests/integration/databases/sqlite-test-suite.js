// sqlite-test-suite.js
// SQLite Strategy Integration Tests

const { DB_TYPES } = require("../../../src/core/constants");

const BaseTester = require("./base-tester");

class SQLiteTester extends BaseTester {
  constructor() {
    super(DB_TYPES.SQLITE, {
      database: ":memory:",
      dbType: DB_TYPES.SQLITE,
    });
  }

  async runTests() {
    this.log("[TEST] SQLite Strategy Test Suite", "info");
    this.log("=".repeat(60), "info");
    this.log(`Server: ${this.baseURL}`, "info");
    this.log(`Config: In-memory database`, "info");
    this.log("=".repeat(60), "info");

    await this.testConnection();

    // Create test table
    await this.test("Create Test Table", async () => {
      const result = await this.request("POST", "/api/db/query", {
        query:
          "CREATE TABLE IF NOT EXISTS test_users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
        dbName: ":memory:",
      });
      if (!result.success) throw new Error("Create table failed");
      this.log("Test table created", "success");
    });

    // Insert test data
    await this.test("Insert Test Data", async () => {
      const result = await this.request("POST", "/api/db/query", {
        query:
          "INSERT INTO test_users (name, email) VALUES ('Alice', 'alice@test.com'), ('Bob', 'bob@test.com')",
        dbName: ":memory:",
      });
      if (!result.success) throw new Error("Insert failed");
      this.log("Test data inserted", "success");
    });

    await this.testSimpleQuery("SELECT * FROM test_users", ":memory:");
    await this.testSimpleQuery("SELECT * FROM sqlite_master WHERE type='table'", ":memory:");
    // await this.testDisconnect(); // Disconnect endpoint not implemented
    this.printResults();
  }
}

if (require.main === module) {
  const tester = new SQLiteTester();
  tester.runTests().catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = SQLiteTester;
