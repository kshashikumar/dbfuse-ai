const { WebSocketServer, WebSocket } = require("ws");
const url = require("url");
const chatService = require("./ChatService");
const { connectionManager } = require("../config");
const chatSessionStore = require("./ChatSessionStore");
const logger = require("../utils/logger");
const { decodeCredentials, verifyCredentials, isAuthRequired } = require("../utils/authUtil");

const CHAT_PATH = "/api/chat/ws";
const CHAT_RESPONSE_TIMEOUT_MS = Number(process.env.CHAT_RESPONSE_TIMEOUT_MS) || 45000;

const parseEnvelope = (raw) => {
  if (!raw) return null;
  try {
    const text = raw.toString();
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    logger.warn("Failed to parse chat message:", error?.message || error);
  }
  return null;
};

const isAuthorized = (request, authToken) => {
  if (!isAuthRequired()) {
    return true;
  }

  const headerAuth = request.headers?.authorization;
  const token = authToken || headerAuth;
  if (!token) {
    return false;
  }

  const [username, password] = decodeCredentials(token);
  return verifyCredentials(username, password);
};

const sendEnvelope = (socket, payload) => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
};

const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const withTimeout = (promise, timeoutMs, message) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const initializeChatGateway = (server) => {
  const wss = new WebSocketServer({ server, path: CHAT_PATH });

  wss.on("connection", (socket, request) => {
    const { query } = url.parse(request.url, true);
    const getFirst = (value) => (Array.isArray(value) ? value[0] : value);
    const connectionId = getFirst(query?.connectionId);
    const dbType = getFirst(query?.dbType);
    const dbName = getFirst(query?.dbName);
    const sessionId = getFirst(query?.sessionId);
    const authToken = getFirst(query?.auth);
    const clientInfo = {
      remoteAddress: request?.socket?.remoteAddress,
      userAgent: request?.headers?.["user-agent"],
    };

    if (!isAuthorized(request, authToken)) {
      logger.warn("Chat WS unauthorized", {
        connectionId,
        dbType,
        dbName,
        sessionId,
        ...clientInfo,
      });
      socket.close(4401, "Unauthorized");
      return;
    }

    if (!connectionId || !dbType) {
      logger.warn("Chat WS missing params", {
        connectionId,
        dbType,
        dbName,
        sessionId,
        ...clientInfo,
      });
      socket.close(4400, "connectionId and dbType are required");
      return;
    }

    const session = chatSessionStore.ensureSession({
      sessionId,
      connectionId,
      dbType,
      dbName,
    });

    sendEnvelope(socket, {
      v: 1,
      type: "session_ready",
      payload: {
        sessionId: session.id,
      },
    });

    logger.info("Chat WS connected", {
      connectionId,
      dbType,
      dbName: session.dbName || dbName,
      sessionId: session.id,
      ...clientInfo,
    });

    socket.on("close", (code, reason) => {
      logger.info("Chat WS closed", {
        connectionId,
        sessionId: session.id,
        code,
        reason: reason?.toString?.() || reason,
      });
    });

    socket.on("message", async (raw) => {
      const envelope = parseEnvelope(raw);
      if (!envelope || envelope.v !== 1) {
        logger.warn("Chat WS invalid envelope", {
          connectionId,
          sessionId: session.id,
          rawLength: raw?.length || 0,
        });
        sendEnvelope(socket, {
          v: 1,
          type: "assistant_error",
          payload: { messageId: createMessageId(), error: "Invalid message envelope." },
        });
        return;
      }

      if (envelope.type === "ping") {
        sendEnvelope(socket, { v: 1, type: "pong", payload: { ts: Date.now() } });
        return;
      }

      if (envelope.type !== "user_message") {
        logger.warn("Chat WS unsupported message type", {
          connectionId,
          sessionId: session.id,
          type: envelope.type,
        });
        sendEnvelope(socket, {
          v: 1,
          type: "assistant_error",
          payload: { messageId: createMessageId(), error: "Unsupported message type." },
        });
        return;
      }

      const requestId = envelope.payload?.messageId || createMessageId();
      const startedAt = Date.now();
      logger.info("Chat WS message received", {
        connectionId,
        sessionId: session.id,
        requestId,
        type: envelope.type,
        payloadKeys: envelope.payload ? Object.keys(envelope.payload) : [],
      });
      if (!connectionManager.isConnectionActive(connectionId)) {
        logger.warn("Chat request rejected: inactive connection", {
          requestId,
          connectionId,
          dbType,
          dbName: session?.dbName || dbName,
        });
        sendEnvelope(socket, {
          v: 1,
          type: "assistant_error",
          payload: {
            requestId,
            error: "No active database connection. Please reconnect and retry.",
          },
        });
        return;
      }
      const prompt = envelope.payload?.text;
      const model = envelope.payload?.model;
      const apiKey = envelope.payload?.apiKey;
      const pageSize = envelope.payload?.pageSize;
      const payloadDbName = envelope.payload?.dbName;
      if (payloadDbName) {
        session.dbName = payloadDbName;
      }

      if (!prompt || typeof prompt !== "string") {
        sendEnvelope(socket, {
          v: 1,
          type: "assistant_error",
          payload: { requestId, error: "Prompt is required." },
        });
        return;
      }

      const pendingClarification = session.pendingClarification;
      const effectivePrompt = pendingClarification?.originalPrompt || prompt;
      const clarificationContext = pendingClarification
        ? {
            question: pendingClarification.question,
            answer: prompt,
          }
        : null;

      if (pendingClarification) {
        chatSessionStore.clearPendingClarification(session.id);
      }

      chatSessionStore.addMessage(session.id, {
        id: requestId,
        role: "user",
        content: prompt,
      });

      sendEnvelope(socket, {
        v: 1,
        type: "assistant_thinking",
        payload: { requestId },
      });

      try {
        // Phase 1: Enrich query and emit enriched context
        let enrichedContext = null;
        try {
          logger.info("Starting query enrichment", {
            requestId,
            connectionId,
            dbType,
            dbName: session?.dbName || dbName,
          });

          enrichedContext = await chatService.enrichQuery({
            connectionId,
            dbType,
            dbName: session.dbName || dbName,
            prompt: effectivePrompt,
          });

          sendEnvelope(socket, {
            v: 1,
            type: "query_enriched",
            payload: {
              requestId,
              queryIntent: enrichedContext.queryIntent,
              confidence: enrichedContext.confidence,
              reasoning: enrichedContext.reasoning,
              complexity: enrichedContext.complexity,
              selectedStrategy: enrichedContext.selectedStrategy,
              alternativeStrategies: enrichedContext.alternativeStrategies,
              plannedSteps: enrichedContext.plannedSteps,
              capabilities: enrichedContext.capabilities,
            },
          });

          logger.info("Query enrichment completed", {
            requestId,
            intent: enrichedContext.queryIntent,
            strategy: enrichedContext.selectedStrategy,
          });
        } catch (enrichError) {
          logger.warn("Query enrichment failed, proceeding without enrichment", {
            requestId,
            error: enrichError?.message,
          });
        }

        // Phase 2: Execute query with enriched context
        logger.info("Chat request started", {
          requestId,
          connectionId,
          dbType,
          dbName: session?.dbName || dbName,
          promptLength: String(prompt || "").length,
          enriched: !!enrichedContext,
        });
        const responsePromise = chatService.generateResponse({
          connectionId,
          dbType,
          dbName: session.dbName || dbName,
          prompt: effectivePrompt,
          model,
          apiKey,
          pageSize,
          requestId,
          clarificationContext,
          onStep: (steps) => {
            sendEnvelope(socket, {
              v: 1,
              type: "assistant_steps",
              payload: { requestId, steps },
            });
          },
        });
        const result = await withTimeout(
          responsePromise,
          CHAT_RESPONSE_TIMEOUT_MS,
          "Chat response timed out. Please retry.",
        );
        logger.info("Chat request completed", {
          requestId,
          durationMs: Date.now() - startedAt,
          queryId: result?.queryId || null,
          hasQuery: Boolean(result?.query),
        });

        if (result?.clarificationQuestion) {
          chatSessionStore.setPendingClarification(session.id, {
            originalPrompt: effectivePrompt,
            question: result.clarificationQuestion,
            createdAt: new Date().toISOString(),
          });
          sendEnvelope(socket, {
            v: 1,
            type: "assistant_clarify",
            payload: {
              requestId,
              content: result.clarificationQuestion,
              steps: result.steps || null,
            },
          });
          return;
        }

        const assistantMessageId = createMessageId();
        chatSessionStore.addMessage(session.id, {
          id: assistantMessageId,
          role: "assistant",
          content: result.responseText,
          queryId: result.queryId || null,
          query: result.query || null,
        });

        logger.info("📤 SENDING TO FRONTEND", {
          hasTableData: !!result.tableData,
          tableName: result.tableData?.tableName,
          rowCount: result.tableData?.rows?.length,
        });

        sendEnvelope(socket, {
          v: 1,
          type: "assistant_message",
          payload: {
            messageId: assistantMessageId,
            requestId,
            queryId: result.queryId || null,
            content: result.responseText,
            query: result.query || null,
            steps: result.steps || null,
            tableData: result.tableData || null, // NEW: include table data for results panel
          },
        });
      } catch (error) {
        logger.error("Chat message handling failed:", {
          requestId,
          durationMs: Date.now() - startedAt,
          error: error?.message || error,
          stack: error?.stack,
        });
        sendEnvelope(socket, {
          v: 1,
          type: "assistant_error",
          payload: { requestId, error: error?.message || "Chat request failed." },
        });
      }
    });
  });

  logger.info(`Chat WebSocket gateway listening on ${CHAT_PATH}`);
  return wss;
};

module.exports = {
  initializeChatGateway,
};
