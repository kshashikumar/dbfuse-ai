// postgres-test-suite.js
// PostgreSQL Strategy Integration Tests

const BaseTester = require("./base-tester");
const { LOCALHOST_HOSTNAME } = require("../../../src/core/app");
const { DB_TYPES, DB_DEFAULTS } = require("../../../src/core/constants");

class PostgreSQLTester extends BaseTester {
  constructor() {
    super(DB_TYPES.POSTGRESQL, {
      username: "root",
      password: "root",
      host: LOCALHOST_HOSTNAME,
      port: String(DB_DEFAULTS.PORT.POSTGRESQL),
      dbType: DB_TYPES.POSTGRESQL,
      database: "mydatabase",
    });
  }

  async runTests() {
    this.log("��� PostgreSQL Strategy Test Suite", "info");
    this.log("═".repeat(60), "info");
    this.log(`Server: ${this.baseURL}`, "info");
    this.log(`Config: ${this.config.username}@${this.config.host}:${this.config.port}`, "info");
    this.log("═".repeat(60), "info");

    await this.testConnection();
    await this.testListDatabases();

    await this.test("Switch Database", async () => {
      const result = await this.request("POST", "/api/sql/switch-database", { dbName: "postgres" });
      if (!result.success) throw new Error("Switch failed");
      this.log("Switched to postgres", "success");
    });

    await this.testListTables("postgres");
    await this.testSimpleQuery("SELECT datname FROM pg_database LIMIT 3", "postgres");
    await this.testPagination("SELECT * FROM information_schema.columns", "postgres");
    // await this.testDisconnect(); // Disconnect endpoint not implemented
    this.printResults();
  }
}

if (require.main === module) {
  const tester = new PostgreSQLTester();
  tester.runTests().catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
}

module.exports = PostgreSQLTester;
