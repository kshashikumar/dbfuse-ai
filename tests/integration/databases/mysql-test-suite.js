// mysql-test-suite.js
// MySQL Strategy Integration Tests

const BaseTester = require("./base-tester");
const { LOCALHOST_HOSTNAME } = require("../../../src/core/app");
const { DB_TYPES, DB_DEFAULTS } = require("../../../src/core/constants");

class MySQLTester extends BaseTester {
  constructor() {
    super(DB_TYPES.MYSQL, {
      username: "root",
      password: "root",
      host: LOCALHOST_HOSTNAME,
      port: String(DB_DEFAULTS.PORT.MYSQL),
      dbType: DB_TYPES.MYSQL,
    });
  }

  async runTests() {
    this.log("��� MySQL Strategy Test Suite", "info");
    this.log("═".repeat(60), "info");
    this.log(`Server: ${this.baseURL}`, "info");
    this.log(`Config: ${this.config.username}@${this.config.host}:${this.config.port}`, "info");
    this.log("═".repeat(60), "info");

    await this.testConnection();
    await this.testListDatabases();

    await this.test("Switch Database", async () => {
      const result = await this.request("POST", "/api/sql/switch-database", {
        dbName: "information_schema",
      });
      if (!result.success) throw new Error("Switch failed");
      this.log("Switched to information_schema", "success");
    });

    await this.testListTables("information_schema");
    await this.testSimpleQuery("SELECT SCHEMA_NAME FROM SCHEMATA LIMIT 3", "information_schema");
    await this.testPagination("SELECT * FROM COLUMNS", "information_schema");
    // await this.testDisconnect(); // Disconnect endpoint not implemented
    this.printResults();
  }
}

if (require.main === module) {
  const tester = new MySQLTester();
  tester.runTests().catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
}

module.exports = MySQLTester;
