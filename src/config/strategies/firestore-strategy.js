const logger = require("../../utils/logger");
const { buildColumnsFromRecords } = require("../../utils/metadata-sampler");
const { getQueryParts, resolveOperation } = require("../../utils/query-normalizer");

const NoSQLStrategy = require("./base/nosql-strategy");

class FirestoreStrategy extends NoSQLStrategy {
  constructor() {
    super();
    this.client = null;
    this.currentDatabase = null;
    this.connectionConfig = null;
  }

  async connect(config) {
    let Firestore;
    try {
      ({ Firestore } = require("@google-cloud/firestore"));
    } catch {
      throw new Error(
        "Firestore driver not installed. Add '@google-cloud/firestore' to dependencies to enable Firestore support.",
      );
    }

    const projectId =
      config.projectId ||
      config.database ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      undefined;

    const settings = {};
    if (projectId) settings.projectId = projectId;
    if (config.host) {
      settings.host = this.normalizeHost(config.host);
      if (config.port) settings.port = config.port;
      if (config.ssl === false) settings.ssl = false;
    }

    this.client = new Firestore(settings);
    this.connectionConfig = config;
    this.currentDatabase = projectId || "default";
    logger.info("Firestore connection established");
  }

  async disconnect() {
    if (this.client && typeof this.client.terminate === "function") {
      await this.client.terminate();
    }
    this.client = null;
    this.currentDatabase = null;
  }

  async validateConnection() {
    if (!this.client) return false;
    try {
      await this.client.listCollections();
      return true;
    } catch (err) {
      logger.error("Firestore connection validation failed:", err);
      return false;
    }
  }

  async getDatabases() {
    if (!this.client) throw new Error("Firestore connection not initialized");
    const collections = await this.getCollections();
    return [
      {
        name: this.currentDatabase || "default",
        sizeOnDisk: 0,
        tables: collections.map((name) => ({ name })),
        views: [],
      },
    ];
  }

  async switchDatabase(dbName) {
    if (!dbName) return;
    this.currentDatabase = dbName;
  }

  async getCollections() {
    if (!this.client) throw new Error("Firestore connection not initialized");
    const collections = await this.client.listCollections();
    return collections.map((col) => col.id);
  }

  async getCollectionInfo(_dbName, collectionName) {
    if (!this.client) throw new Error("Firestore connection not initialized");
    if (!collectionName) throw new Error("Collection name is required for Firestore.");
    const collection = this.client.collection(collectionName);

    let sampleDocuments = [];
    try {
      const snapshot = await collection.limit(20).get();
      sampleDocuments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      logger.debug("Firestore sample docs failed:", error.message || error);
      sampleDocuments = [];
    }

    const fields = buildColumnsFromRecords(sampleDocuments);

    return {
      db_name: this.currentDatabase || "default",
      table_name: collectionName,
      columns: fields,
      indexes: [],
      foreign_keys: [],
      triggers: [],
      sampleDocuments,
    };
  }

  async getTables(dbName) {
    return this.getCollections(dbName);
  }

  async getTableInfo(dbName, tableName) {
    return this.getCollectionInfo(dbName, tableName);
  }

  async getMultipleTablesInfo(dbName, tableNames) {
    const details = [];
    for (const name of tableNames || []) {
      details.push(await this.getCollectionInfo(dbName, name));
    }
    return details;
  }

  async _executeQueryImpl(query, options = {}) {
    if (!this.client) throw new Error("Firestore connection not initialized");
    const normalized = this._normalizeQuery(query, options);
    const operation = normalized.operation;

    switch (operation) {
      case "get": {
        const docRef = this._resolveDocRef(normalized);
        const snap = await docRef.get();
        return { documents: snap.exists ? [{ id: snap.id, ...snap.data() }] : [] };
      }
      case "set": {
        const docRef = this._resolveDocRef(normalized);
        if (!normalized.document) throw new Error("Firestore document is required.");
        await docRef.set(normalized.document, normalized.merge ? { merge: true } : undefined);
        return { written: true, id: docRef.id };
      }
      case "create": {
        const docRef = this._resolveDocRef(normalized);
        if (!normalized.document) throw new Error("Firestore document is required.");
        await docRef.create(normalized.document);
        return { created: true, id: docRef.id };
      }
      case "add": {
        if (!normalized.collection) throw new Error("Firestore collection is required.");
        if (!normalized.document) throw new Error("Firestore document is required.");
        const ref = await this.client.collection(normalized.collection).add(normalized.document);
        return { created: true, id: ref.id };
      }
      case "update": {
        const docRef = this._resolveDocRef(normalized);
        if (!normalized.document) throw new Error("Firestore update document is required.");
        await docRef.update(normalized.document);
        return { updated: true, id: docRef.id };
      }
      case "delete": {
        const docRef = this._resolveDocRef(normalized);
        await docRef.delete();
        return { deleted: true, id: docRef.id };
      }
      case "transaction": {
        const actions = normalized.actions || [];
        if (!Array.isArray(actions) || actions.length === 0) {
          throw new Error("Firestore transaction requires actions array.");
        }
        const documents = [];
        let writes = 0;
        await this.client.runTransaction(async (tx) => {
          for (const action of actions) {
            const op = String(action.operation || action.op || action.action || "").toLowerCase();
            const docRef = this._resolveDocRef(action);
            if (op === "get") {
              const snap = await tx.get(docRef);
              if (snap.exists) {
                documents.push({ id: snap.id, ...snap.data() });
              }
              continue;
            }
            if (!action.document && op !== "delete") {
              throw new Error(`Firestore transaction '${op}' requires document.`);
            }
            if (op === "set") {
              tx.set(docRef, action.document, action.merge ? { merge: true } : undefined);
              writes++;
              continue;
            }
            if (op === "create") {
              tx.create(docRef, action.document);
              writes++;
              continue;
            }
            if (op === "update") {
              tx.update(docRef, action.document);
              writes++;
              continue;
            }
            if (op === "delete") {
              tx.delete(docRef);
              writes++;
              continue;
            }
            throw new Error(`Unsupported Firestore transaction action: ${op}`);
          }
        });
        return { documents, writes };
      }
      case "batch": {
        const actions = normalized.actions || [];
        if (!Array.isArray(actions) || actions.length === 0) {
          throw new Error("Firestore batch requires actions array.");
        }
        const batch = this.client.batch();
        let writes = 0;
        for (const action of actions) {
          const op = String(action.operation || action.op || action.action || "").toLowerCase();
          const docRef = this._resolveDocRef(action);
          if (!action.document && op !== "delete") {
            throw new Error(`Firestore batch '${op}' requires document.`);
          }
          if (op === "set") {
            batch.set(docRef, action.document, action.merge ? { merge: true } : undefined);
            writes++;
            continue;
          }
          if (op === "create") {
            batch.create(docRef, action.document);
            writes++;
            continue;
          }
          if (op === "update") {
            batch.update(docRef, action.document);
            writes++;
            continue;
          }
          if (op === "delete") {
            batch.delete(docRef);
            writes++;
            continue;
          }
          throw new Error(`Unsupported Firestore batch action: ${op}`);
        }
        await batch.commit();
        return { writes };
      }
      case "query": {
        if (!normalized.collection) throw new Error("Firestore collection is required.");
        let ref = normalized.collectionGroup
          ? this.client.collectionGroup(normalized.collection)
          : this.client.collection(normalized.collection);

        for (const filter of normalized.filters) {
          ref = ref.where(filter.field, filter.op, filter.value);
        }

        for (const order of normalized.orderBy) {
          ref = ref.orderBy(order.field, order.direction);
        }

        if (normalized.limit) {
          ref = ref.limit(normalized.limit);
        }

        if (normalized.startAfter?.length) {
          ref = ref.startAfter(...normalized.startAfter);
        }
        if (normalized.startAt?.length) {
          ref = ref.startAt(...normalized.startAt);
        }
        if (normalized.endBefore?.length) {
          ref = ref.endBefore(...normalized.endBefore);
        }
        if (normalized.endAt?.length) {
          ref = ref.endAt(...normalized.endAt);
        }

        const snapshot = await ref.get();
        const documents = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return { documents, totalRows: snapshot.size };
      }
      default:
        throw new Error(`Unsupported Firestore operation: ${operation}`);
    }
  }

  _resolveDocRef(normalized) {
    if (normalized.documentPath) {
      return this.client.doc(normalized.documentPath);
    }
    if (!normalized.collection) {
      throw new Error("Firestore collection is required.");
    }
    if (!normalized.id) {
      throw new Error("Firestore document id is required.");
    }
    return this.client.collection(normalized.collection).doc(normalized.id);
  }

  _normalizeQuery(query, options = {}) {
    if (typeof query === "string") {
      return { operation: "get", documentPath: query };
    }
    const { raw, payload } = getQueryParts(query);
    const operation = resolveOperation(raw, payload, { defaultOperation: "query" });

    return {
      operation,
      collection: raw.collection || payload.collection,
      documentPath: raw.documentPath || payload.documentPath,
      id: raw.id || payload.id || raw.documentId || payload.documentId,
      document: raw.document || payload.document,
      merge: raw.merge ?? payload.merge,
      actions: this._normalizeActions(
        raw.actions || payload.actions || raw.operations || payload.operations,
      ),
      filters: this._normalizeFilters(raw.filters || payload.filters),
      orderBy: this._normalizeOrderBy(raw.orderBy || payload.orderBy),
      limit: raw.limit || payload.limit || options?.pageSize,
      startAfter: this._normalizeCursor(raw.startAfter || payload.startAfter),
      startAt: this._normalizeCursor(raw.startAt || payload.startAt),
      endBefore: this._normalizeCursor(raw.endBefore || payload.endBefore),
      endAt: this._normalizeCursor(raw.endAt || payload.endAt),
      collectionGroup: Boolean(raw.collectionGroup || payload.collectionGroup),
    };
  }

  _normalizeActions(actions) {
    if (!actions) return [];
    if (!Array.isArray(actions)) return [];
    return actions
      .map((action) => {
        if (!action || typeof action !== "object") return null;
        return {
          operation: action.operation || action.op || action.action,
          collection: action.collection,
          documentPath: action.documentPath,
          id: action.id || action.documentId,
          document: action.document,
          merge: action.merge,
        };
      })
      .filter(Boolean);
  }

  _normalizeFilters(filters) {
    if (!filters) return [];
    if (Array.isArray(filters)) {
      return filters
        .map((filter) => {
          if (Array.isArray(filter) && filter.length >= 3) {
            return { field: filter[0], op: filter[1], value: filter[2] };
          }
          if (filter && typeof filter === "object") {
            return { field: filter.field, op: filter.op || filter.operator, value: filter.value };
          }
          return null;
        })
        .filter(Boolean);
    }
    return [];
  }

  _normalizeOrderBy(orderBy) {
    if (!orderBy) return [];
    if (Array.isArray(orderBy)) {
      return orderBy
        .map((entry) => {
          if (Array.isArray(entry) && entry.length >= 1) {
            return { field: entry[0], direction: entry[1] || "asc" };
          }
          if (entry && typeof entry === "object") {
            return { field: entry.field, direction: entry.direction || "asc" };
          }
          if (typeof entry === "string") {
            return { field: entry, direction: "asc" };
          }
          return null;
        })
        .filter(Boolean);
    }
    if (typeof orderBy === "string") {
      return [{ field: orderBy, direction: "asc" }];
    }
    return [];
  }

  _normalizeCursor(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
  }
}

module.exports = FirestoreStrategy;
