// mssql-test-suite.js
// Microsoft SQL Server Strategy Integration Tests

const { LOCALHOST_HOSTNAME } = require("../../../src/core/app");
const { DB_TYPES, DB_DEFAULTS } = require("../../../src/core/constants");

const BaseTester = require("./base-tester");

class MSSQLTester extends BaseTester {
  constructor() {
    super(DB_TYPES.MSSQL, {
      username: "sa",
      password: "YourStrong@Passw0rd",
      host: LOCALHOST_HOSTNAME,
      port: String(DB_DEFAULTS.PORT.MSSQL),
      dbType: DB_TYPES.MSSQL,
      database: "master",
    });
  }

  async runTests() {
    this.log("[TEST] MSSQL Strategy Test Suite", "info");
    this.log("=".repeat(60), "info");
    this.log(`Server: ${this.baseURL}`, "info");
    this.log(`Config: ${this.config.username}@${this.config.host}:${this.config.port}`, "info");
    this.log("=".repeat(60), "info");

    await this.testConnection();
    await this.testListDatabases();

    await this.test("Switch Database", async () => {
      const result = await this.request("POST", "/api/db/switch-database", { dbName: "master" });
      if (!result.success) throw new Error("Switch failed");
      this.log("Switched to master", "success");
    });

    await this.testListTables("master");
    await this.testSimpleQuery("SELECT name FROM sys.databases", "master");
    await this.testPagination("SELECT * FROM INFORMATION_SCHEMA.COLUMNS", "master");
    // await this.testDisconnect(); // Disconnect endpoint not implemented
    this.printResults();
  }
}

if (require.main === module) {
  const tester = new MSSQLTester();
  tester.runTests().catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = MSSQLTester;
