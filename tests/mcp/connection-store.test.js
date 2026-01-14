const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const connectionStore = require("../../src/config/connection-store");
const { MCP_CONSTANTS } = require("../../src/core/constants");

async function withTemporaryConfigDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbfuse-mcp-"));
  const previous = process.env.DBFUSE_CONFIG_DIR;
  process.env.DBFUSE_CONFIG_DIR = tempDir;

  try {
    await callback(tempDir);
  } finally {
    if (previous) {
      process.env.DBFUSE_CONFIG_DIR = previous;
    } else {
      delete process.env.DBFUSE_CONFIG_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function run() {
  await withTemporaryConfigDir(async (workingDir) => {
    const seedConnections = [
      {
        id: 42,
        username: "tester",
        password: "secret",
        host: "localhost",
        port: 3306,
        dbType: "mysql2",
        database: "sample",
        socketPath: "",
        status: "Available",
      },
      {
        id: 7,
        username: "postgres",
        password: "hidden",
        host: "localhost",
        port: 5432,
        dbType: "pg",
        database: "postgres",
        socketPath: "",
        status: "Available",
      },
    ];

    await connectionStore.writeConnections(seedConnections);

    const storedPath = connectionStore.resolveConnectionsPath();
    assert.ok(
      storedPath.startsWith(path.resolve(workingDir)),
      `Connections should be written inside custom config dir. Received ${storedPath}`,
    );

    const connections = await connectionStore.readConnections();
    assert.strictEqual(connections.length, 2, "Expected two connections in store");
    assert.strictEqual(connections[0].password, "secret", "Secrets should be preserved in store");

    const hidden = await connectionStore.readConnections({ hideSecrets: true });
    assert.strictEqual(hidden[0].password, "***", "Hidden secrets should be masked");

    const prefixedId = `${MCP_CONSTANTS.STORED_CONNECTION_PREFIX}${connections[0].id}`;
    const resolvedViaPrefix = connectionStore.findConnection(connections, prefixedId);
    assert.ok(resolvedViaPrefix, "Should resolve stored connection by MCP prefixed id");
    assert.strictEqual(resolvedViaPrefix.id, connections[0].id);

    const resolvedNumeric = connectionStore.findConnection(connections, "7");
    assert.ok(resolvedNumeric, "Should resolve connection by numeric string id");
    assert.strictEqual(resolvedNumeric.id, 7);

    const signature = connectionStore.buildConnectionSignature(connections[1]);
    const resolvedSignature = connectionStore.findConnection(connections, signature);
    assert.ok(resolvedSignature, "Should resolve connection by signature");
    assert.strictEqual(resolvedSignature.id, 7);
  });

  console.log("✅ MCP connection-store tests completed successfully");
}

run().catch((error) => {
  console.error("❌ MCP connection-store tests failed", error);
  process.exit(1);
});
