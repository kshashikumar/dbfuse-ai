const chatSessionStore = require("../chat/ChatSessionStore");
const { HEADERS, HEADER_VARIANTS, HTTP_STATUS } = require("../core/constants");
const { getHeaderValue } = require("../utils/http");

const BaseController = require("./base/BaseController");

class ChatController extends BaseController {
  _getConnectionId(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.CONNECTION_ID);
  }

  _getDbType(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.DB_TYPE);
  }

  async createSession(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbType = this._getDbType(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }
      if (!dbType) {
        return this.sendError(
          res,
          `${HEADERS.DB_TYPE} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const dbName = req.body?.dbName || null;
      const session = chatSessionStore.createSession({ connectionId, dbType, dbName });
      return this.sendSuccess(res, { sessionId: session.id, createdAt: session.createdAt });
    } catch (error) {
      return this.handleError(res, error, "creating chat session");
    }
  }

  async getHistory(req, res) {
    try {
      const sessionId = req.query?.sessionId || req.body?.sessionId;
      if (!sessionId) {
        return this.sendError(res, "sessionId is required", HTTP_STATUS.BAD_REQUEST);
      }
      const limitRaw = req.query?.limit ?? req.body?.limit;
      const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50;
      const messages = chatSessionStore.listMessages(sessionId, limit);
      return this.sendSuccess(res, { sessionId, messages });
    } catch (error) {
      return this.handleError(res, error, "fetching chat history");
    }
  }

  async submitFeedback(req, res) {
    try {
      const { sessionId, messageId, feedback, comments } = req.body || {};
      if (!sessionId || !messageId) {
        return this.sendError(res, "sessionId and messageId are required", HTTP_STATUS.BAD_REQUEST);
      }

      const entry = chatSessionStore.addFeedback(sessionId, {
        messageId,
        feedback: feedback || null,
        comments: comments || null,
      });

      if (!entry) {
        return this.sendError(res, "session not found", HTTP_STATUS.NOT_FOUND);
      }

      return this.sendSuccess(res, { message: "Feedback recorded" });
    } catch (error) {
      return this.handleError(res, error, "recording chat feedback");
    }
  }

  async enrichQuery(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      const dbType = this._getDbType(req);

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }
      if (!dbType) {
        return this.sendError(
          res,
          `${HEADERS.DB_TYPE} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const { dbName, prompt, options } = req.body || {};

      if (!prompt) {
        return this.sendError(res, "prompt is required", HTTP_STATUS.BAD_REQUEST);
      }

      const chatService = require("../chat/ChatService");

      const enrichedContext = await chatService.enrichQuery({
        connectionId,
        dbType,
        dbName: dbName || null,
        prompt,
        options: options || {},
      });

      return this.sendSuccess(res, {
        queryIntent: enrichedContext.queryIntent,
        confidence: enrichedContext.confidence,
        reasoning: enrichedContext.reasoning,
        complexity: enrichedContext.complexity,
        selectedStrategy: enrichedContext.selectedStrategy,
        alternativeStrategies: enrichedContext.alternativeStrategies,
        plannedSteps: enrichedContext.plannedSteps,
        availableEntities: enrichedContext.availableEntities,
        relevantEntities: enrichedContext.relevantEntities,
        capabilities: enrichedContext.capabilities,
        phase: enrichedContext.phase,
        timestamp: enrichedContext.timestamp,
      });
    } catch (error) {
      // Fallback to minimal context on error
      return this.sendSuccess(res, {
        queryIntent: "complex_query",
        confidence: 0.5,
        reasoning: "Enrichment failed, using minimal context",
        complexity: "medium",
        selectedStrategy: "RAGEnhancedStrategy",
        alternativeStrategies: [],
        plannedSteps: [],
        availableEntities: [],
        relevantEntities: [],
        capabilities: { type: "sql", operations: [], features: [] },
        phase: "fallback",
        timestamp: new Date().toISOString(),
        error: error?.message || "Unknown error",
      });
    }
  }
}

const controller = new ChatController();

module.exports = {
  createSession: controller.createSession.bind(controller),
  getHistory: controller.getHistory.bind(controller),
  submitFeedback: controller.submitFeedback.bind(controller),
  enrichQuery: controller.enrichQuery.bind(controller),
};
