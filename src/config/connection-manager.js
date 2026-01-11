// connection-manager.js
const { CONNECTION_STATES, ERROR_MESSAGES, DEFAULT_CONFIG } = require("../core/constants");
const logger = require("../utils/logger");

/**
 * Singleton ConnectionManager for managing database connections
 * Provides metrics, health checks, and agent hooks
 */
class ConnectionManager {
  constructor() {
    if (ConnectionManager.instance) {
      return ConnectionManager.instance;
    }

    this.connections = new Map();
    this.activeConnections = new Map();
    this.connectionStates = new Map();
    this.lastActivity = new Map();
    // Runtime-only map to hold full configs (including secrets) for reconnect via dbController
    this.connectionConfigs = new Map();

    // Metrics tracking
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      failedConnections: 0,
      switchOperations: 0,
      totalConnectionTime: 0,
      connectionErrors: [],
    };

    // Agent hooks for monitoring and control
    this.hooks = {
      "connection.created": [],
      "connection.closed": [],
      "connection.switched": [],
      "connection.error": [],
    };

    // Circuit breaker state
    this.circuitBreaker = {
      state: "closed", // closed, open, half-open
      failures: 0,
      threshold: 5,
      timeout: 60000, // 1 minute
      lastFailure: null,
    };

    ConnectionManager.instance = this;
  }

  // Agent hook registration
  registerHook(event, handler) {
    if (!this.hooks[event]) {
      throw new Error(`Unknown hook event: ${event}`);
    }
    if (typeof handler !== "function") {
      throw new Error("Hook handler must be a function");
    }
    this.hooks[event].push(handler);
    return () => {
      // Return unsubscribe function
      const index = this.hooks[event].indexOf(handler);
      if (index > -1) this.hooks[event].splice(index, 1);
    };
  }

  async executeHooks(event, context) {
    const handlers = this.hooks[event] || [];
    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (error) {
        logger.warn(`Hook handler failed for ${event}: ${error.message}`);
      }
    }
  }

  // Circuit breaker management
  recordFailure() {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.state = "open";
      logger.warn(`Circuit breaker opened after ${this.circuitBreaker.failures} failures`);
      setTimeout(() => {
        this.circuitBreaker.state = "half-open";
        logger.info("Circuit breaker entering half-open state");
      }, this.circuitBreaker.timeout);
    }
  }

  recordSuccess() {
    if (this.circuitBreaker.state === "half-open") {
      this.circuitBreaker.state = "closed";
      this.circuitBreaker.failures = 0;
      logger.info("Circuit breaker closed after successful connection");
    }
  }

  checkCircuitBreaker() {
    if (this.circuitBreaker.state === "open") {
      throw new Error("Circuit breaker is open - too many connection failures");
    }
  }

  // Connection lifecycle management
  async createConnection(connectionId, strategy, config) {
    this.checkCircuitBreaker();
    const startTime = Date.now();

    try {
      this.setConnectionState(connectionId, CONNECTION_STATES.CONNECTING);

      await strategy.connect(config);

      const connectionTime = Date.now() - startTime;
      this.metrics.totalConnectionTime += connectionTime;
      this.metrics.totalConnections++;
      this.metrics.activeConnections++;

      this.connections.set(connectionId, {
        strategy,
        config: { ...config, password: "***" }, // Hide password in memory
        createdAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        connectionTime,
      });
      // Store full config separately for runtime use (not persisted)
      this.connectionConfigs.set(connectionId, { ...config });

      this.activeConnections.set(connectionId, strategy);
      this.setConnectionState(connectionId, CONNECTION_STATES.CONNECTED);
      this.updateLastActivity(connectionId);

      this.recordSuccess();
      await this.executeHooks("connection.created", { connectionId, config, connectionTime });

      return connectionId;
    } catch (error) {
      this.setConnectionState(connectionId, CONNECTION_STATES.ERROR);
      this.metrics.failedConnections++;
      this.metrics.connectionErrors.push({
        connectionId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 100 errors
      if (this.metrics.connectionErrors.length > 100) {
        this.metrics.connectionErrors.shift();
      }

      this.recordFailure();
      await this.executeHooks("connection.error", { connectionId, error });
      throw error;
    }
  }

  // Register an already-connected strategy without invoking connect again
  registerExistingConnection(connectionId, strategy, config) {
    this.connections.set(connectionId, {
      strategy,
      config: { ...config, password: "***" },
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
    });
    // Store full config separately for runtime use (not persisted)
    this.connectionConfigs.set(connectionId, { ...config });

    this.activeConnections.set(connectionId, strategy);
    this.setConnectionState(connectionId, CONNECTION_STATES.CONNECTED);
    this.updateLastActivity(connectionId);
    return connectionId;
  }

  async closeConnection(connectionId) {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      try {
        await connection.disconnect();
        this.metrics.activeConnections--;

        await this.executeHooks("connection.closed", { connectionId });
      } catch (error) {
        logger.warn(`Error closing connection ${connectionId}: ${error.message}`);
      }

      this.activeConnections.delete(connectionId);
      this.connections.delete(connectionId);
      this.connectionConfigs.delete(connectionId);
      this.connectionStates.delete(connectionId);
      this.lastActivity.delete(connectionId);
    }
  }

  async closeAllConnections() {
    const connectionIds = Array.from(this.activeConnections.keys());
    await Promise.all(connectionIds.map((id) => this.closeConnection(id)));
  }

  // Connection state management
  setConnectionState(connectionId, state) {
    this.connectionStates.set(connectionId, {
      state,
      timestamp: new Date().toISOString(),
    });
  }

  getConnectionState(connectionId) {
    return this.connectionStates.get(connectionId)?.state || CONNECTION_STATES.DISCONNECTED;
  }

  updateLastActivity(connectionId) {
    this.lastActivity.set(connectionId, new Date().toISOString());
  }

  // Connection retrieval and validation
  getConnection(connectionId) {
    const strategy = this.activeConnections.get(connectionId);
    if (!strategy) {
      throw new Error(ERROR_MESSAGES.NO_ACTIVE_CONNECTION);
    }

    this.updateLastActivity(connectionId);
    return strategy;
  }

  async validateConnection(connectionId) {
    const strategy = this.activeConnections.get(connectionId);
    if (!strategy) {
      this.setConnectionState(connectionId, CONNECTION_STATES.DISCONNECTED);
      return false;
    }

    try {
      const isValid = await strategy.validateConnection();
      this.setConnectionState(
        connectionId,
        isValid ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.ERROR,
      );
      return isValid;
    } catch (error) {
      this.setConnectionState(connectionId, CONNECTION_STATES.ERROR);
      return false;
    }
  }

  // Database switching with connection management
  async switchDatabase(connectionId, dbName) {
    const strategy = this.getConnection(connectionId);

    try {
      this.setConnectionState(connectionId, CONNECTION_STATES.SWITCHING);
      await strategy.switchDatabase(dbName);

      // Update connection info
      const connectionInfo = this.connections.get(connectionId);
      if (connectionInfo) {
        connectionInfo.currentDatabase = dbName;
        connectionInfo.lastUsed = new Date().toISOString();
      }

      this.setConnectionState(connectionId, CONNECTION_STATES.CONNECTED);
      this.updateLastActivity(connectionId);
      this.metrics.switchOperations++;

      await this.executeHooks("connection.switched", { connectionId, dbName });

      return true;
    } catch (error) {
      this.setConnectionState(connectionId, CONNECTION_STATES.ERROR);
      await this.executeHooks("connection.error", { connectionId, error, operation: "switch" });
      throw new Error(ERROR_MESSAGES.DATABASE_SWITCH_FAILED(dbName));
    }
  }

  // Connection monitoring and cleanup
  async healthCheck() {
    const results = new Map();

    for (const [connectionId, strategy] of this.activeConnections) {
      try {
        const health = await strategy.getConnectionHealth();
        results.set(connectionId, health);
      } catch (error) {
        results.set(connectionId, {
          status: "unhealthy",
          error: error.message,
          lastCheck: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  async cleanupIdleConnections(maxIdleTime = DEFAULT_CONFIG.IDLE_TIMEOUT) {
    const now = Date.now();
    const connectionsToClose = [];

    for (const [connectionId, lastActivity] of this.lastActivity) {
      const idleTime = now - new Date(lastActivity).getTime();
      if (idleTime > maxIdleTime) {
        connectionsToClose.push(connectionId);
      }
    }

    for (const connectionId of connectionsToClose) {
      logger.info(`Closing idle connection: ${connectionId}`);
      await this.closeConnection(connectionId);
    }

    return connectionsToClose.length;
  }

  // Connection information
  getConnectionInfo(connectionId) {
    const connection = this.connections.get(connectionId);
    const state = this.getConnectionState(connectionId);
    const lastActivity = this.lastActivity.get(connectionId);

    if (!connection) {
      return null;
    }

    return {
      id: connectionId,
      config: connection.config,
      state,
      createdAt: connection.createdAt,
      lastUsed: connection.lastUsed,
      lastActivity,
      currentDatabase: connection.currentDatabase,
    };
  }

  getAllConnectionsInfo() {
    return Array.from(this.connections.keys()).map((id) => this.getConnectionInfo(id));
  }

  getActiveConnectionCount() {
    return this.activeConnections.size;
  }

  // Utility methods
  generateConnectionId(config) {
    const { host, port, username, dbType, database } = config;
    return `${dbType}_${username}@${host}:${port}/${database || "default"}_${Date.now()}`;
  }

  isConnectionActive(connectionId) {
    return (
      this.activeConnections.has(connectionId) &&
      this.getConnectionState(connectionId) === CONNECTION_STATES.CONNECTED
    );
  }

  // Runtime config access (do not expose password beyond server)
  getConnectionConfig(connectionId) {
    return this.connectionConfigs.get(connectionId) || null;
  }

  // Metrics and health checks
  getMetrics() {
    return {
      ...this.metrics,
      activeConnections: this.activeConnections.size,
      avgConnectionTime:
        this.metrics.totalConnections > 0
          ? Math.round(this.metrics.totalConnectionTime / this.metrics.totalConnections)
          : 0,
      recentErrors: this.metrics.connectionErrors.slice(-10),
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
        lastFailure: this.circuitBreaker.lastFailure,
      },
    };
  }

  isHealthy() {
    return {
      healthy: this.circuitBreaker.state !== "open",
      activeConnections: this.activeConnections.size,
      circuitBreakerState: this.circuitBreaker.state,
      failureRate:
        this.metrics.totalConnections > 0
          ? (this.metrics.failedConnections / this.metrics.totalConnections) * 100
          : 0,
      timestamp: new Date().toISOString(),
    };
  }

  resetMetrics() {
    this.metrics = {
      totalConnections: 0,
      activeConnections: this.activeConnections.size,
      failedConnections: 0,
      switchOperations: 0,
      totalConnectionTime: 0,
      connectionErrors: [],
    };
  }
}

// Export singleton instance
module.exports = new ConnectionManager();
