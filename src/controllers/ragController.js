const { RAGService, QueryOrchestrator, storageManager } = require("../rag");
const { HEADERS, HEADER_VARIANTS, HTTP_STATUS } = require("../core/constants");
const { getHeaderValue } = require("../utils/http");

const BaseController = require("./base/BaseController");

class RAGController extends BaseController {
  constructor() {
    super();
    this.ragService = new RAGService();
    this.orchestrator = new QueryOrchestrator({ ragService: this.ragService });
  }

  async refreshSchema(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const dbName = req.body?.dbName || req.query?.dbName || null;

      const schema = await this.ragService.indexSchema({
        connectionId,
        dbName,
        force: true,
      });

      return this.sendSuccess(res, {
        message: "Schema indexed successfully",
        database: schema?.database || dbName || null,
        tables: Array.isArray(schema?.tables) ? schema.tables.length : 0,
      });
    } catch (error) {
      return this.handleError(res, error, "refreshing RAG schema");
    }
  }

  async getContext(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const query = req.query?.q || req.body?.query || req.body?.prompt;
      if (!query) {
        return this.sendError(res, "query is required", HTTP_STATUS.BAD_REQUEST);
      }

      const dbName = req.body?.dbName || req.query?.dbName || null;
      const limitRaw = req.body?.limit ?? req.query?.limit;
      const minScoreRaw = req.body?.minScore ?? req.query?.minScore;
      const forceRaw = req.body?.force ?? req.query?.force;

      const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
      const minScore = Number.isFinite(Number(minScoreRaw)) ? Number(minScoreRaw) : undefined;
      const force = String(forceRaw).toLowerCase() === "true";

      const context = await this.ragService.retrieveContext({
        connectionId,
        dbName,
        query,
        options: {
          limit,
          minScore,
          force,
        },
      });

      return this.sendSuccess(res, {
        query,
        ...context,
      });
    } catch (error) {
      return this.handleError(res, error, "retrieving RAG context");
    }
  }

  async analyzeQuery(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const prompt = req.body?.prompt || req.body?.query;
      if (!prompt) {
        return this.sendError(res, "prompt is required", HTTP_STATUS.BAD_REQUEST);
      }

      const analysis = this.orchestrator.analyze(prompt);

      return this.sendSuccess(res, {
        prompt,
        ...analysis,
      });
    } catch (error) {
      return this.handleError(res, error, "analyzing query");
    }
  }

  async query(req, res) {
    try {
      const { databaseName: bodyDbName, prompt, model, apiKey } = req.body;
      const dbType = this._getDbType(req);
      const connectionId = this._getConnectionId(req);

      const validation = this.validateRequired(req.body, ["prompt"]);
      if (!validation.valid) {
        return this.sendError(res, validation.error, HTTP_STATUS.BAD_REQUEST);
      }

      if (!dbType) {
        return this.sendError(
          res,
          `Database type (${HEADERS.DB_TYPE}) must be specified in headers`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const options = {
        limit: req.body?.limit,
        minScore: req.body?.minScore,
        force: req.body?.force,
        useRag: req.body?.useRag,
        includeExplanation: req.body?.includeExplanation,
        includeSuggestions: req.body?.includeSuggestions,
      };

      const result = await this.orchestrator.execute({
        connectionId,
        dbType,
        dbName: bodyDbName,
        prompt,
        model,
        apiKey,
        options,
      });

      return this.sendSuccess(res, result);
    } catch (error) {
      return this.handleError(res, error, "executing RAG query");
    }
  }

  async getHistory(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const limitRaw = req.query?.limit ?? req.body?.limit;
      const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 20;

      await storageManager.initialize();
      const historyStore = storageManager.getQueryHistoryStore();
      const history = await historyStore.listRecent(limit);
      return this.sendSuccess(res, { history });
    } catch (error) {
      return this.handleError(res, error, "fetching RAG history");
    }
  }

  async submitFeedback(req, res) {
    try {
      const connectionId = this._getConnectionId(req);
      if (!connectionId) {
        return this.sendError(
          res,
          `${HEADERS.CONNECTION_ID} header is required`,
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const { queryId, feedback, correctedQuery, comments } = req.body || {};
      if (!queryId) {
        return this.sendError(res, "queryId is required", HTTP_STATUS.BAD_REQUEST);
      }

      const payload = {
        feedback,
        comments,
        correctedQuery: correctedQuery || null,
      };

      await storageManager.initialize();
      const historyStore = storageManager.getQueryHistoryStore();
      await historyStore.updateFeedback(queryId, payload, correctedQuery || null);

      return this.sendSuccess(res, { message: "Feedback recorded" });
    } catch (error) {
      return this.handleError(res, error, "recording RAG feedback");
    }
  }

  _getConnectionId(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.CONNECTION_ID);
  }

  _getDbType(req) {
    return getHeaderValue(req.headers, HEADER_VARIANTS.DB_TYPE);
  }
}

const controller = new RAGController();

module.exports = {
  refreshSchema: controller.refreshSchema.bind(controller),
  getContext: controller.getContext.bind(controller),
  analyzeQuery: controller.analyzeQuery.bind(controller),
  query: controller.query.bind(controller),
  getHistory: controller.getHistory.bind(controller),
  submitFeedback: controller.submitFeedback.bind(controller),
};
