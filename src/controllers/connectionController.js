/**
 * @fileoverview Connection controller
 * Handles HTTP endpoints for database connection management
 */

const connectionService = require("../services/ConnectionService");
const { HTTP_STATUS } = require("../core/constants");

const BaseController = require("./base/BaseController");

class ConnectionController extends BaseController {
  /**
   * Get all connections
   */
  async getConnections(req, res) {
    try {
      this.logOperation("getConnections");

      const result = await connectionService.getConnections();
      return this.sendSuccess(res, result);
    } catch (error) {
      // Handle encrypted store errors with specific status code
      if (error.requiresKey) {
        return this.sendResponse(
          res,
          HTTP_STATUS.CONFLICT,
          null,
          error.message ||
            "Encrypted connection store detected. Provide DBFUSE_CONNECTIONS_KEY or delete the store.",
        );
      }
      this.handleError(res, error, "fetching connections");
    }
  }

  /**
   * Add new connection
   */
  async addConnection(req, res) {
    try {
      const input = req.body;
      this.logOperation("addConnection", { dbType: input.dbType });

      const result = await connectionService.addConnection(input);
      return this.sendSuccess(res, result, HTTP_STATUS.CREATED);
    } catch (error) {
      // Handle duplicate connection
      if (error.message.includes("already exists")) {
        return this.sendError(res, error.message, HTTP_STATUS.CONFLICT);
      }
      this.handleError(res, error, "adding connection");
    }
  }

  /**
   * Edit existing connection
   */
  async editConnection(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      this.logOperation("editConnection", { id });

      // Validate inputs
      if (!updates || Object.keys(updates).length === 0) {
        return this.sendError(res, "No update data provided", HTTP_STATUS.BAD_REQUEST);
      }

      const result = await connectionService.editConnection(id, updates);
      return this.sendSuccess(res, result);
    } catch (error) {
      if (error.message === "Connection not found") {
        return this.sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
      }
      if (error.message === "Invalid Connection ID") {
        return this.sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
      }
      this.handleError(res, error, "editing connection");
    }
  }

  /**
   * Delete connection
   */
  async deleteConnection(req, res) {
    try {
      const { id } = req.params;
      this.logOperation("deleteConnection", { id });

      const result = await connectionService.deleteConnection(id);
      return this.sendSuccess(res, result);
    } catch (error) {
      if (error.message === "Connection not found") {
        return this.sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
      }
      if (error.message === "Invalid Connection ID") {
        return this.sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
      }
      this.handleError(res, error, "deleting connection");
    }
  }

  /**
   * Batch save connections
   */
  async saveConnections(req, res) {
    try {
      const list = req.body.connections;
      this.logOperation("saveConnections", { count: list?.length });

      if (!list || !Array.isArray(list)) {
        return this.sendError(
          res,
          "Invalid data provided. Expected an array of connections.",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const result = await connectionService.saveConnections(list);
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "saving connections");
    }
  }

  /**
   * Test connection
   */
  async testConnection(req, res) {
    try {
      const { id } = req.params;
      this.logOperation("testConnection", { id });

      const result = await connectionService.testConnection(id);
      return this.sendSuccess(res, result);
    } catch (error) {
      if (error.message === "Connection not found") {
        return this.sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
      }
      if (error.message === "Invalid Connection ID") {
        return this.sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
      }
      this.handleError(res, error, "testing connection");
    }
  }

  /**
   * Reset connection store
   */
  async resetConnectionStore(req, res) {
    try {
      this.logOperation("resetConnectionStore");

      const result = await connectionService.resetConnectionStore();
      return this.sendSuccess(res, result);
    } catch (error) {
      this.handleError(res, error, "resetting connection store");
    }
  }

  /**
   * Get connection service metrics (for monitoring/agent)
   */
  async getMetrics(req, res) {
    try {
      const metrics = connectionService.getMetrics();
      return this.sendSuccess(res, { metrics });
    } catch (error) {
      this.handleError(res, error, "fetching metrics");
    }
  }
}

// Export controller instance with bound methods
const controller = new ConnectionController();

module.exports = {
  getConnections: controller.getConnections.bind(controller),
  addConnection: controller.addConnection.bind(controller),
  editConnection: controller.editConnection.bind(controller),
  deleteConnection: controller.deleteConnection.bind(controller),
  saveConnections: controller.saveConnections.bind(controller),
  testConnection: controller.testConnection.bind(controller),
  resetConnectionStore: controller.resetConnectionStore.bind(controller),
  getMetrics: controller.getMetrics.bind(controller),
};
