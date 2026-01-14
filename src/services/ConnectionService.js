/**
 * @fileoverview Connection service
 * Handles database connection CRUD operations with policy enforcement
 * Provides connection store management and metrics for agent monitoring
 */

const connectionStore = require("../config/connection-store");
const { getPolicy } = require("../utils/policyUtil");
const logger = require("../utils/logger");

/**
 * @typedef {Object} ConnectionMetrics
 * @property {number} totalConnections - Total connections managed
 * @property {number} successfulOperations - Successful operations count
 * @property {number} failedOperations - Failed operations count
 * @property {string} lastOperationTime - ISO timestamp of last operation
 */

class ConnectionService {
  constructor() {
    this.metrics = {
      totalConnections: 0,
      successfulOperations: 0,
      failedOperations: 0,
      lastOperationTime: null,
    };
  }

  /**
   * Update metrics after operation
   * @private
   * @param {boolean} success - Operation success status
   */
  _updateMetrics(success) {
    if (success) {
      this.metrics.successfulOperations++;
    } else {
      this.metrics.failedOperations++;
    }
    this.metrics.lastOperationTime = new Date().toISOString();
  }

  /**
   * Enrich connection with display information
   * @private
   * @param {Object} connection - Connection object
   * @returns {Object} Connection with display fields
   */
  _enrichConnection(connection) {
    const policy = getPolicy(connection.dbType);
    const { databaseDisplay, databaseShort, extras = {} } = policy.display(connection);
    return {
      ...connection,
      databaseDisplay,
      databaseShort,
      ...extras,
    };
  }

  /**
   * Get all connections with display information
   * @returns {Promise<Object>} Connections array with metadata
   */
  async getConnections() {
    try {
      const connections = await connectionStore.readConnections();
      const enriched = connections.map((c) => this._enrichConnection(c));

      this.metrics.totalConnections = enriched.length;
      this._updateMetrics(true);

      return {
        connections: enriched,
        count: enriched.length,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._updateMetrics(false);

      // Handle encrypted store errors
      const needsKey =
        error?.code === "ENCRYPTED_STORE_KEY_REQUIRED" ||
        error?.code === "ENCRYPTED_STORE_DECRYPT_FAILED";

      throw {
        ...error,
        encrypted: needsKey,
        requiresKey: needsKey,
        resolutionOptions: needsKey ? ["provide_key", "reset_store"] : undefined,
      };
    }
  }

  /**
   * Add new connection with validation and deduplication
   * @param {Object} input - Connection input data
   * @returns {Promise<Object>} Added connection with display info
   */
  async addConnection(input) {
    try {
      const policy = getPolicy(input.dbType);

      // Validate connection
      const error = policy.validateOnAdd(input);
      if (error) {
        throw new Error(error);
      }

      let connections = await connectionStore.readConnections();

      // Normalize and check for duplicates
      const normalized = policy.normalizeOnAdd(input);
      const candidate = { ...normalized, dbType: input.dbType };
      const keyNew = policy.dedupeKey(candidate);

      const exists = connections.some((conn) => {
        const p = getPolicy(conn.dbType);
        return p.dedupeKey(conn) === keyNew;
      });

      if (exists) {
        throw new Error("Connection with these details already exists");
      }

      // Generate new ID
      const newId = connections.length > 0 ? Math.max(...connections.map((c) => c.id || 0)) + 1 : 1;

      const connectionToAdd = {
        id: newId,
        ...normalized,
        dbType: input.dbType,
        createdAt: new Date().toISOString(),
        lastUsed: null,
      };

      connections.push(connectionToAdd);
      await connectionStore.writeConnections(connections);

      this.metrics.totalConnections = connections.length;
      this._updateMetrics(true);

      logger.info("Connection added:", { id: newId, dbType: input.dbType });

      return {
        message: "Connection added successfully",
        connection: this._enrichConnection(connectionToAdd),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Edit existing connection
   * @param {number} id - Connection ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated connection with display info
   */
  async editConnection(id, updates) {
    try {
      const idNum = parseInt(id, 10);
      if (isNaN(idNum)) {
        throw new Error("Invalid Connection ID");
      }

      let connections = await connectionStore.readConnections();
      const idx = connections.findIndex((c) => c.id === idNum);

      if (idx === -1) {
        throw new Error("Connection not found");
      }

      const current = connections[idx];
      const policy = getPolicy(current.dbType);
      const normalizedUpdates = policy.normalizeOnEdit(current, updates);

      const next = {
        ...current,
        ...normalizedUpdates,
        id: current.id,
        createdAt: current.createdAt,
        lastUsed: current.lastUsed,
      };

      connections[idx] = next;
      await connectionStore.writeConnections(connections);

      this._updateMetrics(true);
      logger.info("Connection updated:", { id: idNum });

      return {
        message: "Connection updated successfully",
        connection: this._enrichConnection(next),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Delete connection by ID
   * @param {number} id - Connection ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteConnection(id) {
    try {
      const idNum = parseInt(id, 10);
      if (isNaN(idNum)) {
        throw new Error("Invalid Connection ID");
      }

      let connections = await connectionStore.readConnections();
      const initialLength = connections.length;

      connections = connections.filter((c) => c.id !== idNum);

      if (connections.length === initialLength) {
        throw new Error("Connection not found");
      }

      await connectionStore.writeConnections(connections);

      this.metrics.totalConnections = connections.length;
      this._updateMetrics(true);

      logger.info("Connection deleted:", { id: idNum });

      return {
        message: "Connection deleted successfully",
        deletedId: idNum,
        deletedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Batch save connections (import/restore)
   * @param {Array} connectionList - Array of connections
   * @returns {Promise<Object>} Save result with count
   */
  async saveConnections(connectionList) {
    try {
      if (!Array.isArray(connectionList)) {
        throw new Error("Invalid data: expected array of connections");
      }

      const normalized = connectionList
        .map((conn) => {
          const policy = getPolicy(conn.dbType);
          const error = policy.validateOnAdd({ ...conn, databasePath: conn.databasePath });
          if (error) throw new Error(error);
          return policy.normalizeOnSave({ ...conn });
        })
        .map((conn, i) => ({
          id: connectionList[i].id || Date.now() + Math.random(),
          createdAt: connectionList[i].createdAt || new Date().toISOString(),
          lastUsed: connectionList[i].lastUsed ?? null,
          status: connectionList[i].status || "Available",
          ...conn,
        }));

      await connectionStore.writeConnections(normalized);

      this.metrics.totalConnections = normalized.length;
      this._updateMetrics(true);

      logger.info("Batch connections saved:", { count: normalized.length });

      return {
        message: "Connections saved successfully",
        count: normalized.length,
        savedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Test connection and update lastUsed timestamp
   * @param {number} id - Connection ID
   * @returns {Promise<Object>} Connection test result
   */
  async testConnection(id) {
    try {
      const idNum = parseInt(id, 10);
      if (isNaN(idNum)) {
        throw new Error("Invalid Connection ID");
      }

      const connections = await connectionStore.readConnections();
      const connection = connections.find((c) => c.id === idNum);

      if (!connection) {
        throw new Error("Connection not found");
      }

      connection.lastUsed = new Date().toISOString();
      await connectionStore.writeConnections(connections);

      this._updateMetrics(true);

      const enriched = this._enrichConnection(connection);

      return {
        message: "Connection test initiated",
        connection: {
          id: enriched.id,
          host: enriched.host,
          port: enriched.port,
          dbType: enriched.dbType,
          database: enriched.database,
          databaseDisplay: enriched.databaseDisplay,
          databaseShort: enriched.databaseShort,
        },
        testedAt: new Date().toISOString(),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Reset connection store (delete all connections)
   * @returns {Promise<Object>} Reset result
   */
  async resetConnectionStore() {
    try {
      const deleted = await connectionStore.deleteConnectionStore();

      if (deleted) {
        this.metrics.totalConnections = 0;
      }

      this._updateMetrics(true);

      logger.info("Connection store reset");

      return {
        message: deleted
          ? "Deleted saved connections. You can start adding new ones."
          : "Connection store was already empty.",
        deleted,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this._updateMetrics(false);
      throw error;
    }
  }

  /**
   * Get connection service metrics (for agent monitoring)
   * @returns {ConnectionMetrics} Current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalConnections: this.metrics.totalConnections,
      successfulOperations: 0,
      failedOperations: 0,
      lastOperationTime: null,
    };
    logger.debug("Connection service metrics reset");
  }

  /**
   * Health check for connection service
   * @returns {Object} Health status
   */
  isHealthy() {
    try {
      // Try to read connections
      const connections = connectionStore.readConnections();

      return {
        healthy: true,
        connectionCount: Array.isArray(connections) ? connections.length : 0,
        metrics: this.getMetrics(),
        storeAccessible: true,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        storeAccessible: false,
      };
    }
  }
}

// Export singleton instance
module.exports = new ConnectionService();
