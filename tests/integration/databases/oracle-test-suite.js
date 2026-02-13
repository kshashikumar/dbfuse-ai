// oracle-test-suite.js
// Oracle Database Strategy Integration Tests

const { LOCALHOST_HOSTNAME } = require("../../../src/core/app");
const { DB_TYPES, DB_DEFAULTS } = require("../../../src/core/constants");

const BaseTester = require("./base-tester");

class OracleTester extends BaseTester {
  constructor() {
    super(DB_TYPES.ORACLE, {
      username: "SYSTEM",
      password: "oracle",
      host: LOCALHOST_HOSTNAME,
      port: String(DB_DEFAULTS.PORT.ORACLE),
      dbType: DB_TYPES.ORACLE,
      database: "XEPDB1",
    });
  }

  async runTests() {
    this.log("[TEST] Oracle Strategy Test Suite", "info");
    this.log("=".repeat(60), "info");
    this.log(`Server: ${this.baseURL}`, "info");
    this.log(`Config: ${this.config.username}@${this.config.host}:${this.config.port}`, "info");
    this.log("=".repeat(60), "info");

    await this.testConnection();
    await this.testListDatabases();

    await this.test("Switch Schema", async () => {
      const result = await this.request("POST", "/api/db/switch-database", { dbName: "SYSTEM" });
      if (!result.success) throw new Error("Switch failed");
      this.log("Switched to SYSTEM schema", "success");
    });

    await this.testListTables("SYSTEM");
    await this.testSimpleQuery("SELECT TABLE_NAME FROM USER_TABLES WHERE ROWNUM <= 3", "SYSTEM");
    await this.testPagination("SELECT * FROM ALL_TAB_COLUMNS WHERE ROWNUM <= 100", "SYSTEM");
    // await this.testDisconnect(); // Disconnect endpoint not implemented
    this.printResults();
  }
}

if (require.main === module) {
  const tester = new OracleTester();
  tester.runTests().catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
  });
}

module.exports = OracleTester;
