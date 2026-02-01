const crypto = require("crypto");

class ChatSessionStore {
  constructor() {
    this.sessions = new Map();
  }

  createSession({ connectionId, dbType, dbName } = {}) {
    const id = this._createId();
    const session = {
      id,
      connectionId,
      dbType,
      dbName,
      createdAt: new Date().toISOString(),
      messages: [],
      feedback: [],
      pendingClarification: null,
      lastContext: null,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId) {
    if (!sessionId) return null;
    return this.sessions.get(sessionId) || null;
  }

  ensureSession({ sessionId, connectionId, dbType, dbName } = {}) {
    const existing = this.getSession(sessionId);
    if (existing) {
      if (connectionId) existing.connectionId = connectionId;
      if (dbType) existing.dbType = dbType;
      if (dbName) existing.dbName = dbName;
      return existing;
    }
    return this.createSession({ connectionId, dbType, dbName });
  }

  addMessage(sessionId, message) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.messages.push({
      ...message,
      createdAt: message.createdAt || new Date().toISOString(),
    });
    return message;
  }

  listMessages(sessionId, limit = 50) {
    const session = this.getSession(sessionId);
    if (!session) return [];
    if (!Number.isFinite(limit) || limit <= 0) {
      return session.messages.slice();
    }
    return session.messages.slice(-limit);
  }

  addFeedback(sessionId, feedback) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const entry = {
      ...feedback,
      createdAt: feedback.createdAt || new Date().toISOString(),
    };
    session.feedback.push(entry);
    return entry;
  }

  setPendingClarification(sessionId, payload) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.pendingClarification = payload;
    return payload;
  }

  clearPendingClarification(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.pendingClarification = null;
    return true;
  }

  setLastContext(sessionId, context) {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.lastContext = context;
    return context;
  }

  _createId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }
}

module.exports = new ChatSessionStore();
