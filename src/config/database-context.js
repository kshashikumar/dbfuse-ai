// config/database-context.js (Updated for singleton pattern)
const logger = require("../utils/logger");

const connectionStore = require("./connection-store");
const { createStrategy, supportedDbTypes } = require("./create-strategy");

class DatabaseContext {
  constructor() {
    this.strategy = null;
    this.currentDbType = null;
    this.isConnected = false;
  }

  async setStrategy(dbType) {
    if (!dbType) {
      throw new Error("Database type is required");
    }

    if (!supportedDbTypes.includes(dbType)) {
      throw new Error(
        `Unsupported database type: ${dbType}. Supported types: ${supportedDbTypes.join(", ")}`,
      );
    }

    if (this.strategy && this.currentDbType === dbType) {
      return;
    }

    if (this.strategy && this.isConnected) {
      try {
        this.strategy.disconnect();
      } catch (error) {
        logger.warn("Error disconnecting previous strategy:", error.message || error);
      }
    }

    this.strategy = await createStrategy(dbType);
    this.currentDbType = dbType;
    this.isConnected = false;
  }

  async connect(config) {
    await this.setStrategy(config.dbType);

    if (!this.isConnected) {
      await this.strategy.connect(config);
      this.isConnected = true;
    }

    return this.strategy;
  }

  async switchDatabase(dbName) {
    if (!this.strategy || !this.isConnected) {
      throw new Error("No active database connection. Call connect first.");
    }
    await this.strategy.switchDatabase(dbName);
  }

  async executeQuery(query, options = {}) {
    if (!this.strategy || !this.isConnected) {
      throw new Error("No active database connection. Call connect first.");
    }
    return await this.strategy.executeQuery(query, options);
  }

  async disconnect() {
    if (this.strategy && this.isConnected) {
      await this.strategy.disconnect();
      this.isConnected = false;
    }
  }

  async validateConnection() {
    if (!this.strategy || !this.isConnected) {
      return false;
    }

    try {
      const isValid = await this.strategy.validateConnection();
      if (!isValid) {
        this.isConnected = false;
      }
      return isValid;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  getStrategy() {
    if (!this.strategy || !this.isConnected) {
      throw new Error("No active database connection. Call connect first.");
    }
    return this.strategy;
  }

  isConnectionActive() {
    return this.strategy && this.isConnected;
  }

  getCurrentDbType() {
    return this.currentDbType;
  }

  // Existing methods that delegate to strategy
  async getConnections() {
    try {
      const connections = await connectionStore.readConnections();
      const withoutSecrets = connections.map((conn) => ({
        id: conn.id,
        username: conn.username,
        host: conn.host,
        port: conn.port,
        dbType: conn.dbType,
        database: conn.database,
        socketPath: conn.socketPath,
        status: conn.status || "Available",
      }));
      logger.debug("Loaded connections from store:", withoutSecrets);
      return withoutSecrets;
    } catch (err) {
      logger.error("Error fetching connections:", err);
      return [];
    }
  }

  async saveConnections(connections) {
    try {
      await connectionStore.writeConnections(connections);
      logger.info("Connections saved to file:", connections);
    } catch (err) {
      logger.error("Error saving connections to file:", err);
      throw err;
    }
  }

  async getDatabases() {
    return await this.getStrategy().getDatabases();
  }

  async getTables(dbName) {
    return await this.getStrategy().getTables(dbName);
  }

  async getTableInfo(dbName, tableName) {
    return await this.getStrategy().getTableInfo(dbName, tableName);
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    return await this.getStrategy().getMultipleTablesInfo(dbName, tableNames);
  }
}

// Export singleton instance
module.exports = new DatabaseContext();
