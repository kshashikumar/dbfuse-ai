// queryRangeRoutes.js - Virtual Scrolling Range Query Routes
const express = require("express");
const router = express.Router();

const { connectionManager } = require("../config");
const { getCapabilityModel } = require("../config/create-strategy");
const DatabaseService = require("../services/DatabaseService");
const { buildEnvelope } = require("../utils/responseEnvelope");

/**
 * POST /api/query/range
 * Fetch a specific range of query results for virtual scrolling
 *
 * Body:
 * - connectionId: string (required)
 * - query: string (required) - Base SQL query without LIMIT/OFFSET
 * - offset: number (required) - Starting row index (0-based)
 * - limit: number (required) - Number of rows to fetch (max 1000)
 * - collectionName: string (optional) - For NoSQL databases
 * - filter: object (optional) - For NoSQL databases
 * - options: object (optional) - Additional query options
 */
router.post("/range", async (req, res) => {
  try {
    const {
      connectionId,
      query,
      offset,
      limit,
      collectionName,
      filter,
      options,
      paginationMode,
      cursor,
    } = req.body;

    // Validate required fields
    if (!connectionId) {
      return res.status(400).json({
        error: "connectionId is required",
        code: "MISSING_CONNECTION_ID",
      });
    }

    if (offset === undefined || offset < 0) {
      return res.status(400).json({
        error: "offset must be a non-negative number",
        code: "INVALID_OFFSET",
      });
    }

    if (!limit || limit < 1 || limit > 1000) {
      return res.status(400).json({
        error: "limit must be between 1 and 1000",
        code: "INVALID_LIMIT",
      });
    }

    // For SQL databases, query is required
    // For NoSQL databases, collectionName is required
    if (!query && !collectionName) {
      return res.status(400).json({
        error: "Either query or collectionName must be provided",
        code: "MISSING_QUERY_OR_COLLECTION",
      });
    }

    // DatabaseService is exported as a singleton, use it directly
    const databaseService = DatabaseService;

    // Fetch the range
    const rangeOptions = {
      ...(options || {}),
      paginationMode,
      cursor,
    };

    const result = await databaseService.fetchQueryRange(
      connectionId,
      query,
      offset,
      limit,
      collectionName,
      filter,
      rangeOptions,
    );

    const payload = {
      success: true,
      data: result,
    };

    let capabilities = { type: "unknown", operations: [], features: [], limits: {} };
    try {
      const strategy = connectionManager.getConnection(connectionId);
      if (strategy && typeof strategy.getCapabilities === "function") {
        capabilities = strategy.getCapabilities();
      }
    } catch {
      const info = connectionManager.getConnectionInfo(connectionId);
      const dbType = info?.config?.dbType;
      if (dbType) {
        capabilities = getCapabilityModel(dbType);
      }
    }

    const envelope = buildEnvelope({
      kind: "query",
      payload,
      request: { connectionId },
      meta: { operation: "queryRange", capabilities },
    });

    return res.json({ envelope });
  } catch (error) {
    console.error("Query range error:", error);

    // Handle specific error types
    if (error.message.includes("not initialized")) {
      return res.status(400).json({
        error: "Database connection not found or not initialized",
        code: "CONNECTION_NOT_INITIALIZED",
        message: error.message,
      });
    }

    if (error.message.includes("Invalid range")) {
      return res.status(400).json({
        error: "Invalid range parameters",
        code: "INVALID_RANGE",
        message: error.message,
      });
    }

    // Generic error response
    res.status(500).json({
      error: "Failed to fetch query range",
      code: "QUERY_RANGE_ERROR",
      message: error.message,
    });
  }
});

module.exports = router;
